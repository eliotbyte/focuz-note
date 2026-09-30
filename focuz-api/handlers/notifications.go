package handlers

import (
	"encoding/json"
	"focuz-api/repository"
	"focuz-api/types"
	"net/http"

	"github.com/gin-gonic/gin"
)

type NotificationsHandler struct {
	repo *repository.NotificationsRepository
}

func NewNotificationsHandler(repo *repository.NotificationsRepository) *NotificationsHandler {
	return &NotificationsHandler{repo: repo}
}

func (h *NotificationsHandler) ListUnread(c *gin.Context) {
	userID := c.GetInt("userId")
	notifs, err := h.repo.ListUnread(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	// Marshal payload back to JSON
	type APIItem struct {
		ID      int             `json:"id"`
		Type    string          `json:"type"`
		Sticky  bool            `json:"sticky"`
		Payload json.RawMessage `json:"payload"`
	}
	items := make([]APIItem, 0, len(notifs))
	for _, n := range notifs {
		items = append(items, APIItem{ID: n.ID, Type: n.Type, Sticky: n.Sticky, Payload: json.RawMessage(n.Payload)})
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(items))
}

func (h *NotificationsHandler) MarkRead(c *gin.Context) {
	userID := c.GetInt("userId")
	var req struct {
		IDs []int `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "ids required"))
		return
	}
	if err := h.repo.MarkRead(userID, req.IDs); err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Notifications marked read"}))
}
