package handlers

import (
	"encoding/json"
	"errors"
	"focuz-api/models"
	"focuz-api/pkg/access"
	"focuz-api/repository"
	"focuz-api/types"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type ActivitiesHandler struct {
	activitiesRepo    *repository.ActivitiesRepository
	spacesRepo        *repository.SpacesRepository
	notesRepo         *repository.NotesRepository
	activityTypesRepo *repository.ActivityTypesRepository
}

func NewActivitiesHandler(
	ar *repository.ActivitiesRepository,
	sr *repository.SpacesRepository,
	nr *repository.NotesRepository,
	atr *repository.ActivityTypesRepository,
) *ActivitiesHandler {
	return &ActivitiesHandler{
		activitiesRepo:    ar,
		spacesRepo:        sr,
		notesRepo:         nr,
		activityTypesRepo: atr,
	}
}

func (h *ActivitiesHandler) CreateActivity(c *gin.Context) {
	var req struct {
		TypeID int    `json:"typeId" binding:"required"`
		Value  string `json:"value" binding:"required"`
		NoteID *int   `json:"note_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	activityType, err := h.activityTypesRepo.GetActivityTypeByID(req.TypeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if activityType == nil || activityType.IsDeleted {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid or deleted activity type"))
		return
	}
	userID := c.GetInt("userId")

	var spaceID int
	if req.NoteID != nil {
		note, nerr := h.notesRepo.GetNoteByID(*req.NoteID)
		if nerr != nil || note == nil || note.IsDeleted {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid note"))
			return
		}
		spaceID = note.SpaceID
	} else {
		// If no note is specified, get space ID from activity type
		spaceID = activityType.SpaceID
	}

	roleID, rerr := h.spacesRepo.GetUserRoleIDInSpace(userID, spaceID)
	if rerr != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, rerr))
		return
	}
	if !access.CanEditNote(roleID) {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "You can only read this space"))
		return
	}

	if !typeUsableInSpace(activityType, spaceID) {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Activity type does not belong to this space"))
		return
	}

	checkedValue, err := h.validateActivityValue(activityType, req.Value)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}

	created, err := h.activitiesRepo.CreateActivity(userID, req.TypeID, checkedValue, req.NoteID)
	if err != nil {
		if strings.Contains(err.Error(), "activity with this type already exists for the given note") {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeConflict, err.Error()))
		} else {
			c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		}
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(created))
}

func (h *ActivitiesHandler) DeleteActivity(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("activityId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid activity ID"))
		return
	}
	activity, err := h.activitiesRepo.GetActivityByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if activity == nil || activity.IsDeleted {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Activity not found"))
		return
	}
	userID := c.GetInt("userId")
	if !h.authorizeActivity(c, activity, userID) {
		return
	}
	err = h.activitiesRepo.SetActivityDeleted(id, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Activity deleted successfully"}))
}

func (h *ActivitiesHandler) RestoreActivity(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("activityId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid activity ID"))
		return
	}
	activity, err := h.activitiesRepo.GetActivityByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if activity == nil || !activity.IsDeleted {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Activity not found"))
		return
	}
	userID := c.GetInt("userId")
	if !h.authorizeActivity(c, activity, userID) {
		return
	}
	err = h.activitiesRepo.SetActivityDeleted(id, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Activity restored successfully"}))
}

func (h *ActivitiesHandler) UpdateActivity(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("activityId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid activity ID"))
		return
	}
	activity, err := h.activitiesRepo.GetActivityByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if activity == nil || activity.IsDeleted {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Activity not found"))
		return
	}
	var req struct {
		Value  string `json:"value" binding:"required"`
		NoteID *int   `json:"note_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	userID := c.GetInt("userId")
	if !h.authorizeActivity(c, activity, userID) {
		return
	}
	activityType, err := h.activityTypesRepo.GetActivityTypeByID(activity.TypeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if activityType == nil || activityType.IsDeleted {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid or deleted activity type"))
		return
	}
	if req.NoteID != nil {
		// Re-attaching to another note requires access to that note's space too.
		target, nerr := h.notesRepo.GetNoteByID(*req.NoteID)
		if nerr != nil || target == nil || target.IsDeleted {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid note"))
			return
		}
		roleID, rerr := h.spacesRepo.GetUserRoleIDInSpace(userID, target.SpaceID)
		if rerr != nil {
			c.JSON(http.StatusInternalServerError, types.InternalError(c, rerr))
			return
		}
		if !access.CanEditNote(roleID) || !typeUsableInSpace(activityType, target.SpaceID) {
			c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the target note"))
			return
		}
	}
	checkedValue, err := h.validateActivityValue(activityType, req.Value)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	err = h.activitiesRepo.UpdateActivity(id, checkedValue, req.NoteID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Activity updated successfully"}))
}

// authorizeActivity allows changing an activity attached to a note in a space the user may edit
// notes in, or to a note-less activity the user created. It writes the error response otherwise.
func (h *ActivitiesHandler) authorizeActivity(c *gin.Context, activity *models.Activity, userID int) bool {
	spaceID, err := h.getSpaceIDForActivity(activity)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, err.Error()))
		return false
	}
	if spaceID == 0 {
		if activity.UserID != userID {
			c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to this activity"))
			return false
		}
		return true
	}
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return false
	}
	if !access.CanEditNote(roleID) {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to this activity"))
		return false
	}
	return true
}

// typeUsableInSpace: built-in types everywhere, custom types only in their own space.
func typeUsableInSpace(t *models.ActivityType, spaceID int) bool {
	return t.IsDefault || t.SpaceID == spaceID
}

func (h *ActivitiesHandler) getSpaceIDForActivity(activity *models.Activity) (int, error) {
	if activity.NoteID == nil {
		return 0, nil
	}
	note, err := h.notesRepo.GetNoteByID(*activity.NoteID)
	if err != nil || note == nil || note.IsDeleted {
		return 0, errors.New("invalid note")
	}
	return note.SpaceID, nil
}

func (h *ActivitiesHandler) validateActivityValue(t *models.ActivityType, raw string) ([]byte, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New("empty value")
	}
	switch t.ValueType {
	case "integer":
		v, err := strconv.Atoi(raw)
		if err != nil {
			return nil, errors.New("value must be integer")
		}
		if t.MinValue != nil && float64(v) < *t.MinValue {
			return nil, errors.New("value is out of range")
		}
		if t.MaxValue != nil && float64(v) > *t.MaxValue {
			return nil, errors.New("value is out of range")
		}
		m := map[string]any{"data": v}
		return json.Marshal(m)
	case "float":
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return nil, errors.New("value must be float")
		}
		if t.MinValue != nil && f < *t.MinValue {
			return nil, errors.New("value is out of range")
		}
		if t.MaxValue != nil && f > *t.MaxValue {
			return nil, errors.New("value is out of range")
		}
		m := map[string]any{"data": f}
		return json.Marshal(m)
	case "boolean":
		b, err := strconv.ParseBool(raw)
		if err != nil {
			return nil, errors.New("value must be boolean")
		}
		m := map[string]any{"data": b}
		return json.Marshal(m)
	case "text":
		m := map[string]any{"data": raw}
		return json.Marshal(m)
	case "time":
		_, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return nil, errors.New("value must be valid RFC3339 time")
		}
		m := map[string]any{"data": raw}
		return json.Marshal(m)
	default:
		return nil, errors.New("unsupported value type")
	}
}

// NEW
func (h *ActivitiesHandler) GetActivitiesAnalysis(c *gin.Context) {
	spaceIDStr := c.Query("spaceId")
	typeIDStr := c.Query("typeId")
	periodIDStr := c.Query("periodId")
	if spaceIDStr == "" || typeIDStr == "" || periodIDStr == "" {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "spaceId, typeId and periodId are required"))
		return
	}
	spaceID, err := strconv.Atoi(spaceIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid spaceId"))
		return
	}
	typeID, err := strconv.Atoi(typeIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid typeId"))
		return
	}
	periodID, err := strconv.Atoi(periodIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid periodId"))
		return
	}

	periodType := types.GetPeriodTypeByID(periodID)
	if periodType == nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "invalid period type"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, spaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to this space"))
		return
	}
	at, err := h.activityTypesRepo.GetActivityTypeByID(typeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if at == nil || at.IsDeleted {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid activity type"))
		return
	}
	startDateStr := c.Query("startDate")
	var startDate *time.Time
	if startDateStr != "" {
		t, e := time.Parse(time.RFC3339, startDateStr)
		if e == nil {
			startDate = &t
		} else {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid startDate"))
			return
		}
	}
	endDateStr := c.Query("endDate")
	var endDate *time.Time
	if endDateStr != "" {
		t, e := time.Parse(time.RFC3339, endDateStr)
		if e == nil {
			endDate = &t
		} else {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid endDate"))
			return
		}
	}
	tags := c.QueryArray("tags")

	results, err := h.activitiesRepo.GetActivitiesAnalysis(
		spaceID,
		startDate,
		endDate,
		tags,
		at,
		periodID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(results))
}
