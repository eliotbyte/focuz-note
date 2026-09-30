package handlers

import (
	"errors"
	"focuz-api/pkg/access"
	"focuz-api/pkg/authtoken"
	"focuz-api/pkg/appenv"
	"focuz-api/repository"
	"focuz-api/types"
	"net/http"
	"strconv"
	"strings"
	"time"

	"focuz-api/models"

	"log/slog"

	"github.com/gin-gonic/gin"
)

type NotesHandler struct {
	repo       *repository.NotesRepository
	spacesRepo *repository.SpacesRepository
}

func NewNotesHandler(repo *repository.NotesRepository, spacesRepo *repository.SpacesRepository) *NotesHandler {
	return &NotesHandler{repo: repo, spacesRepo: spacesRepo}
}

func AuthMiddleware(tokens *authtoken.Tokens) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, types.NewErrorResponse(types.ErrorCodeUnauthorized, "Authorization header required"))
			c.Abort()
			return
		}
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, types.NewErrorResponse(types.ErrorCodeUnauthorized, "Invalid authorization header"))
			c.Abort()
			return
		}
		userID, err := tokens.Verify(parts[1])
		if errors.Is(err, authtoken.ErrInvalid) {
			c.JSON(http.StatusUnauthorized, types.NewErrorResponse(types.ErrorCodeInvalidToken, "Invalid token"))
			c.Abort()
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
			c.Abort()
			return
		}

		// Structured logging with PII guard: do not log userId in production
		if !appenv.IsProduction() {
			slog.Info("auth request", "path", c.Request.URL.Path, "userId", userID)
		} else {
			slog.Info("auth request", "path", c.Request.URL.Path)
		}

		c.Set("userId", userID)
		c.Next()
	}
}

func (h *NotesHandler) CreateNote(c *gin.Context) {
	var req struct {
		Text     string    `json:"text" binding:"required"`
		Date     time.Time `json:"date" binding:"required"`
		SpaceID  int       `json:"spaceId" binding:"required"`
		Tags     []string  `json:"tags"`
		ParentID *int      `json:"parentId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, req.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if !access.CanWrite(roleID) {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "You can only read this space"))
		return
	}

	if req.ParentID != nil {
		// Replies must stay inside the space: a foreign parent would link spaces together.
		parent, perr := h.repo.GetNoteByID(*req.ParentID)
		if perr != nil || parent == nil || parent.SpaceID != req.SpaceID {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Parent note must be in the same space"))
			return
		}
	}

	dateStr := req.Date.Format(time.RFC3339)
	note, err := h.repo.CreateNote(userID, req.Text, req.Tags, req.ParentID, &dateStr, req.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}

	c.JSON(http.StatusCreated, types.NewSuccessResponse(note))
}

func (h *NotesHandler) DeleteNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	note, err := h.repo.GetNoteByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if note == nil {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Note not found"))
		return
	}
	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}
	if !access.CanDeleteNote(roleID, note.UserID, userID) {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "You can delete only your own notes here"))
		return
	}
	if err := h.repo.UpdateNoteDeleted(id, true); err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Note deleted successfully"}))
}

func (h *NotesHandler) RestoreNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	note, err := h.repo.GetNoteByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if note == nil {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Note not found"))
		return
	}
	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}
	if !access.CanDeleteNote(roleID, note.UserID, userID) {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "You can restore only your own notes here"))
		return
	}
	if err := h.repo.UpdateNoteDeleted(id, false); err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Note restored successfully"}))
}

func (h *NotesHandler) GetNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	note, err := h.repo.GetNoteByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if note == nil {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Note not found"))
		return
	}
	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	c.JSON(http.StatusOK, types.NewSuccessResponse(note))
}

func (h *NotesHandler) GetNotes(c *gin.Context) {
	userID := c.GetInt("userId")
	spaceIDParam := c.Query("spaceId")
	if spaceIDParam == "" {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "spaceId is required"))
		return
	}
	spaceID, err := strconv.Atoi(spaceIDParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid spaceId"))
		return
	}
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	// Use standardized pagination
	pagination := types.ParsePaginationParams(c)

	tags := c.QueryArray("tags")
	notReplyParam := c.Query("notReply")
	notReply := false
	if strings.ToLower(notReplyParam) == "true" {
		notReply = true
	}
	// Note search is client-side (local-first). Server-side word search was removed for portability.
	if strings.TrimSpace(c.Query("search")) != "" {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "search is not supported on this endpoint; use client-side search"))
		return
	}
	parentIDParam := c.Query("parentId")
	var parentID *int
	if parentIDParam != "" {
		tmp, err := strconv.Atoi(parentIDParam)
		if err == nil {
			parentID = &tmp
		}
	}

	// Parse date filters
	var dateFrom *time.Time
	if dateFromStr := c.Query("dateFrom"); dateFromStr != "" {
		if parsed, err := time.Parse("2006-01-02", dateFromStr); err == nil {
			dateFrom = &parsed
		}
	}
	var dateTo *time.Time
	if dateToStr := c.Query("dateTo"); dateToStr != "" {
		if parsed, err := time.Parse("2006-01-02", dateToStr); err == nil {
			dateTo = &parsed
		}
	}

	sortParam := c.Query("sort")
	sortField := "created_at"
	sortOrder := "DESC"
	if sortParam != "" {
		parts := strings.Split(sortParam, ",")
		if len(parts) == 2 {
			field := strings.ToLower(strings.TrimSpace(parts[0]))
			order := strings.ToUpper(strings.TrimSpace(parts[1]))

			// Normalize supported fields to DB column names
			switch field {
			case "createdat", "created_at":
				sortField = "created_at"
			case "modifiedat", "modified_at":
				sortField = "modified_at"
			}

			if order == "ASC" || order == "DESC" {
				sortOrder = order
			}
		}
	}

	filters := models.NoteFilters{
		Tags:      tags,
		NotReply:  notReply,
		Page:      pagination.Page,
		PageSize:  pagination.PageSize,
		ParentID:  parentID,
		SortField: sortField,
		SortOrder: sortOrder,
		DateFrom:  dateFrom,
		DateTo:    dateTo,
	}
	notes, total, err := h.repo.GetNotes(userID, spaceID, filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}

	// Use standardized response with pagination
	response := pagination.BuildResponse(notes, total)
	c.JSON(http.StatusOK, types.NewSuccessResponse(response))
}

func (h *NotesHandler) GetTagAutocomplete(c *gin.Context) {
	text := c.Query("text")
	spaceID, err := strconv.Atoi(c.Query("spaceId"))
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

	tags, err := h.repo.GetTagAutocomplete(text, spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}

	c.JSON(http.StatusOK, types.NewSuccessResponse(tags))
}
