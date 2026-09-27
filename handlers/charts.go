package handlers

import (
	"focuz-api/models"
	"focuz-api/repository"
	"focuz-api/types"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type ChartsHandler struct {
	chartsRepo        *repository.ChartsRepository
	spacesRepo        *repository.SpacesRepository
	notesRepo         *repository.NotesRepository
	activityTypesRepo *repository.ActivityTypesRepository
}

func NewChartsHandler(
	cr *repository.ChartsRepository,
	sr *repository.SpacesRepository,
	atr *repository.ActivityTypesRepository,
	nr *repository.NotesRepository,
) *ChartsHandler {
	return &ChartsHandler{
		chartsRepo:        cr,
		spacesRepo:        sr,
		notesRepo:         nr,
		activityTypesRepo: atr,
	}
}

func (h *ChartsHandler) GetChartTypes(c *gin.Context) {
	c.JSON(http.StatusOK, types.NewSuccessResponse(types.ChartTypes))
}

func (h *ChartsHandler) GetPeriodTypes(c *gin.Context) {
	c.JSON(http.StatusOK, types.NewSuccessResponse(types.PeriodTypes))
}

func (h *ChartsHandler) CreateChart(c *gin.Context) {
	var req struct {
		SpaceID        int     `json:"spaceId" binding:"required"`
		KindID         int     `json:"kindId" binding:"required"`
		ActivityTypeID int     `json:"activityTypeId" binding:"required"`
		PeriodID       int     `json:"periodId" binding:"required"`
		Name           string  `json:"name" binding:"required"`
		Description    *string `json:"description"`
		NoteID         *int    `json:"noteId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}

	chartType := types.GetChartTypeByID(req.KindID)
	if chartType == nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid chart kind"))
		return
	}

	periodType := types.GetPeriodTypeByID(req.PeriodID)
	if periodType == nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid period"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, req.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	activityType, err := h.activityTypesRepo.GetActivityTypeByID(req.ActivityTypeID)
	if err != nil || activityType == nil || activityType.IsDeleted || !typeUsableInSpace(activityType, req.SpaceID) {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid activity type"))
		return
	}

	if req.NoteID != nil {
		note, nerr := h.notesRepo.GetNoteByID(*req.NoteID)
		if nerr != nil || note == nil || note.IsDeleted || note.SpaceID != req.SpaceID {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid note for this space"))
			return
		}
	}

	chart, err := h.chartsRepo.CreateChart(userID, req.SpaceID, req.KindID, req.ActivityTypeID, req.PeriodID, req.Name, req.Description, req.NoteID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}

	c.JSON(http.StatusCreated, types.NewSuccessResponse(chart))
}

func (h *ChartsHandler) DeleteChart(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}

	chart, err := h.chartsRepo.GetChartByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if chart == nil || chart.IsDeleted {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Chart not found"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, chart.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	if err := h.chartsRepo.UpdateChartDeleted(id, true); err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}

	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Chart deleted successfully"}))
}

func (h *ChartsHandler) RestoreChart(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}

	chart, err := h.chartsRepo.GetChartByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if chart == nil || !chart.IsDeleted {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Chart not found"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, chart.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	if err := h.chartsRepo.UpdateChartDeleted(id, false); err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}

	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Chart restored successfully"}))
}

func (h *ChartsHandler) UpdateChart(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}

	chart, err := h.chartsRepo.GetChartByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if chart == nil || chart.IsDeleted {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Chart not found"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, chart.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	var req struct {
		KindID         *int    `json:"kindId"`
		ActivityTypeID *int    `json:"activityTypeId"`
		PeriodID       *int    `json:"periodId"`
		Name           *string `json:"name"`
		Description    *string `json:"description"`
		NoteID         *int    `json:"noteId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}

	if req.KindID != nil {
		chartType := types.GetChartTypeByID(*req.KindID)
		if chartType == nil {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid chart kind"))
			return
		}
	}

	if req.PeriodID != nil {
		periodType := types.GetPeriodTypeByID(*req.PeriodID)
		if periodType == nil {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid period"))
			return
		}
	}

	if req.ActivityTypeID != nil {
		activityType, err := h.activityTypesRepo.GetActivityTypeByID(*req.ActivityTypeID)
		if err != nil || activityType == nil || activityType.IsDeleted || !typeUsableInSpace(activityType, chart.SpaceID) {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid activity type"))
			return
		}
	}

	if req.NoteID != nil {
		if *req.NoteID == 0 {
			// explicit nulling via 0 not supported; require proper null handling by omitting or sending null
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid noteId"))
			return
		}
		note, nerr := h.notesRepo.GetNoteByID(*req.NoteID)
		if nerr != nil || note == nil || note.IsDeleted || note.SpaceID != chart.SpaceID {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Invalid note for this space"))
			return
		}
	}

	// Merge current values with updates
	kindID := chart.KindID
	if req.KindID != nil {
		kindID = *req.KindID
	}
	activityTypeID := chart.ActivityTypeID
	if req.ActivityTypeID != nil {
		activityTypeID = *req.ActivityTypeID
	}
	periodID := chart.PeriodID
	if req.PeriodID != nil {
		periodID = *req.PeriodID
	}
	name := chart.Name
	if req.Name != nil {
		name = *req.Name
	}
	description := chart.Description
	if req.Description != nil {
		description = req.Description
	}
	noteID := chart.NoteID
	if req.NoteID != nil {
		noteID = req.NoteID
	}

	err = h.chartsRepo.UpdateChart(id, kindID, activityTypeID, periodID, name, description, noteID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}

	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Chart updated successfully"}))
}

func (h *ChartsHandler) GetCharts(c *gin.Context) {
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
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	// Use standardized pagination
	pagination := types.ParsePaginationParams(c)

	filters := models.ChartFilters{
		Page:     pagination.Page,
		PageSize: pagination.PageSize,
	}

	charts, total, err := h.chartsRepo.GetCharts(spaceID, filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}

	// Use standardized response with pagination
	response := pagination.BuildResponse(charts, total)
	c.JSON(http.StatusOK, types.NewSuccessResponse(response))
}

func (h *ChartsHandler) GetChartData(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}

	chart, err := h.chartsRepo.GetChartByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if chart == nil || chart.IsDeleted {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Chart not found"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, chart.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	data, err := h.chartsRepo.GetChartData(chart)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, err.Error()))
		return
	}

	c.JSON(http.StatusOK, types.NewSuccessResponse(data))
}
