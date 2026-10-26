package handlers

import (
	"focuz-api/repository"
	"focuz-api/types"
	"net/http"
	"strconv"

	"focuz-api/pkg/notify"

	"github.com/gin-gonic/gin"
)

type SpacesHandler struct {
	spacesRepo *repository.SpacesRepository
	rolesRepo  *repository.RolesRepository
	notifier   notify.Notifier
	nRepo      *repository.NotificationsRepository
}

func NewSpacesHandler(spacesRepo *repository.SpacesRepository, rolesRepo *repository.RolesRepository) *SpacesHandler {
	return &SpacesHandler{spacesRepo: spacesRepo, rolesRepo: rolesRepo}
}

// WithNotifier sets a notifier for the handler. It is optional.
func (h *SpacesHandler) WithNotifier(n notify.Notifier) *SpacesHandler {
	h.notifier = n
	return h
}

// WithNotificationsRepo sets the notifications repository.
func (h *SpacesHandler) WithNotificationsRepo(nr *repository.NotificationsRepository) *SpacesHandler {
	h.nRepo = nr
	return h
}

func (h *SpacesHandler) CreateSpace(c *gin.Context) {
	var req struct {
		Name     string `json:"name" binding:"required"`
		Personal bool   `json:"personal"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	// The current user owns the new space.
	space, err := createSpace(h.spacesRepo, c.GetInt("userId"), req.Name, req.Personal)
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(space))
}

func (h *SpacesHandler) RestoreSpace(c *gin.Context) {
	spaceID, err := strconv.Atoi(c.Param("spaceId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid space ID"))
		return
	}
	if err := restoreSpace(h.spacesRepo, c.GetInt("userId"), spaceID); err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Space restored successfully"}))
}

func (h *SpacesHandler) GetAccessibleSpaces(c *gin.Context) {
	userID := c.GetInt("userId")

	// Use standardized pagination
	pagination := types.ParsePaginationParams(c)

	spaces, total, err := h.spacesRepo.GetSpacesForUserPaginated(userID, pagination.Offset, pagination.PageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}

	// Use standardized response with pagination
	response := pagination.BuildResponse(spaces, total)
	c.JSON(http.StatusOK, types.NewSuccessResponse(response))
}
