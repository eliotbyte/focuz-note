package handlers

import (
	"errors"
	"focuz-api/pkg/access"
	"net/http"
	"strconv"
	"strings"
	"time"

	"focuz-api/pkg/events"
	"focuz-api/pkg/notify"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
)

type SyncHandler struct {
	syncRepo    *repository.SyncRepository
	spacesRepo  *repository.SpacesRepository
	tagsRepo    *repository.TagsRepository
	filtersRepo *repository.FiltersRepository
	notifier    notify.Notifier
	sharing     *repository.SharingRepository

	// Limits are intentionally large by default, but still enforced as a contract
	// to avoid unbounded memory/CPU on the server.
	maxBodyBytes  int64
	maxBatchItems int
}

func NewSyncHandler(syncRepo *repository.SyncRepository, spacesRepo *repository.SpacesRepository, tagsRepo *repository.TagsRepository, filtersRepo *repository.FiltersRepository) *SyncHandler {
	return &SyncHandler{
		syncRepo:    syncRepo,
		spacesRepo:  spacesRepo,
		tagsRepo:    tagsRepo,
		filtersRepo: filtersRepo,
		// Defaults: "big enough" but bounded.
		maxBodyBytes:  25 * 1024 * 1024, // 25 MiB
		maxBatchItems: 10000,
	}
}

func (h *SyncHandler) WithNotifier(n notify.Notifier) *SyncHandler {
	h.notifier = n
	return h
}

// WithSharing adds memberships, members and public links to every pull and lets pushes wake
// the other members of a shared space.
func (h *SyncHandler) WithSharing(r *repository.SharingRepository) *SyncHandler {
	h.sharing = r
	return h
}

func (h *SyncHandler) WithLimits(maxBodyBytes int64, maxBatchItems int) *SyncHandler {
	if maxBodyBytes > 0 {
		h.maxBodyBytes = maxBodyBytes
	}
	if maxBatchItems > 0 {
		h.maxBatchItems = maxBatchItems
	}
	return h
}

// GET /sync?since=RFC3339[&spaceId=]
func (h *SyncHandler) Pull(c *gin.Context) {
	sinceStr := c.Query("since")
	if sinceStr == "" {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "since is required (RFC3339)"))
		return
	}
	since, err := time.Parse(time.RFC3339, sinceStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "since must be RFC3339"))
		return
	}
	userID := c.GetInt("userId")
	spaceIDParam := c.Query("spaceId")
	var spaceIDs []int
	if spaceIDParam != "" {
		id, err := strconv.Atoi(spaceIDParam)
		if err != nil {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid spaceId"))
			return
		}
		roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
			return
		}
		if roleID == 0 {
			c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
			return
		}
		spaceIDs = []int{id}
	} else {
		spaces, err := h.spacesRepo.GetSpacesForUser(userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
			return
		}
		for _, s := range spaces {
			spaceIDs = append(spaceIDs, s.ID)
		}
	}
	changes, err := h.syncRepo.GetChangesSince(userID, spaceIDs, since)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if h.sharing != nil {
		if err := h.addSpaceState(userID, changes); err != nil {
			c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
			return
		}
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(changes))
}

// POST /sync
func (h *SyncHandler) Push(c *gin.Context) {
	// Limit request body size before decoding JSON to prevent unbounded memory usage.
	if h.maxBodyBytes > 0 {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, h.maxBodyBytes)
	}

	var req types.SyncPushRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) || strings.Contains(strings.ToLower(err.Error()), "request body too large") {
			c.JSON(http.StatusRequestEntityTooLarge, types.NewErrorResponseWithDetails(
				types.ErrorCodeValidation,
				"sync request body exceeds the limit",
				map[string]interface{}{"maxBodyBytes": h.maxBodyBytes},
			))
			return
		}
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}

	// Enforce a maximum number of items in the batch (including nested note changes).
	total, breakdown := countSyncPushItems(req)
	if h.maxBatchItems > 0 && total > h.maxBatchItems {
		breakdown["total"] = total
		breakdown["maxBatchItems"] = h.maxBatchItems
		c.JSON(http.StatusRequestEntityTooLarge, types.NewErrorResponseWithDetails(
			types.ErrorCodeValidation,
			"sync batch exceeds the limit",
			map[string]interface{}{"counts": breakdown},
		))
		return
	}

	userID := c.GetInt("userId")
	res, err := h.syncRepo.ApplyChanges(userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(res))
	if h.notifier != nil && res.Applied > 0 {
		notified := map[int]bool{userID: true}
		h.notifier.NotifyUser(userID, events.SyncPushed{Type: "SyncPushed"})
		if h.sharing != nil && len(res.TouchedSpaces) > 0 {
			if ids, err := h.sharing.MemberIDs(res.TouchedSpaces); err == nil {
				for _, id := range ids {
					if !notified[id] {
						notified[id] = true
						h.notifier.NotifyUser(id, events.SyncPushed{Type: "SyncPushed"})
					}
				}
			}
		}
	}
}

// addSpaceState fills the parts of a pull that are always sent in full.
func (h *SyncHandler) addSpaceState(userID int, resp *types.SyncPullResponse) error {
	memberships, err := h.sharing.Memberships(userID)
	if err != nil {
		return err
	}
	ids := make([]int, 0, len(memberships))
	for i := range memberships {
		memberships[i].Role = access.Name(memberships[i].RoleID)
		ids = append(ids, memberships[i].SpaceID)
	}
	members, err := h.sharing.Members(ids)
	if err != nil {
		return err
	}
	for i := range members {
		members[i].Role = access.Name(members[i].RoleID)
	}
	shares, err := h.sharing.Shares(ids)
	if err != nil {
		return err
	}
	resp.Memberships, resp.Members, resp.Shares = memberships, members, shares
	return nil
}

func countSyncPushItems(req types.SyncPushRequest) (int, map[string]int) {
	counts := map[string]int{
		"notes":      len(req.Notes),
		"tags":       len(req.Tags),
		"filters":    len(req.Filters),
		"charts":     len(req.Charts),
		"activities": len(req.Activities),
	}

	noteAttachments := 0
	noteActivities := 0
	noteCharts := 0
	for _, n := range req.Notes {
		noteAttachments += len(n.Attachments)
		noteActivities += len(n.Activities)
		noteCharts += len(n.Charts)
	}
	counts["noteAttachments"] = noteAttachments
	counts["noteActivities"] = noteActivities
	counts["noteCharts"] = noteCharts

	total := 0
	for _, v := range counts {
		total += v
	}
	return total, counts
}

// GET /spaces/:spaceId/tags
func (h *SyncHandler) GetTagsBySpace(c *gin.Context) {
	spaceID, err := strconv.Atoi(c.Param("spaceId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid spaceId"))
		return
	}
	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}
	tags, err := h.tagsRepo.GetTagsBySpace(spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(tags))
}

// GET /spaces/:spaceId/filters
func (h *SyncHandler) GetFiltersBySpace(c *gin.Context) {
	spaceID, err := strconv.Atoi(c.Param("spaceId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid spaceId"))
		return
	}
	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}
	// Reuse filters repo list with default pagination
	items, total, err := h.filtersRepo.List(spaceID, userID, 1, 1000)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	_ = total
	c.JSON(http.StatusOK, types.NewSuccessResponse(items))
}
