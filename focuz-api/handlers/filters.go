package handlers

import (
	"encoding/json"
	"focuz-api/repository"
	"focuz-api/types"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type FiltersHandler struct {
	repo       *repository.FiltersRepository
	spacesRepo *repository.SpacesRepository
}

func NewFiltersHandler(repo *repository.FiltersRepository, spacesRepo *repository.SpacesRepository) *FiltersHandler {
	return &FiltersHandler{repo: repo, spacesRepo: spacesRepo}
}

func (h *FiltersHandler) Create(c *gin.Context) {
	var req struct {
		SpaceID  int             `json:"spaceId" binding:"required"`
		ParentID *int            `json:"parentId"`
		Name     string          `json:"name" binding:"required"`
		Params   json.RawMessage `json:"params" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	// Validate JSON shape syntactically: ensure it's valid JSON object/array/string/number; basic parse already done by RawMessage
	var tmp interface{}
	if err := json.Unmarshal(req.Params, &tmp); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "params must be valid JSON"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, req.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	if !h.parentInSpace(req.ParentID, req.SpaceID) {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Parent filter must be in the same space"))
		return
	}

	filter, err := h.repo.CreateFilter(userID, req.SpaceID, req.Name, req.ParentID, req.Params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(filter))
}

func (h *FiltersHandler) Update(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	// Fetch to check permissions
	existing, err := h.repo.GetByID(id)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Filter not found"))
		return
	}

	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, existing.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	// Folders are personal: only their author sees and changes them.
	if roleID == 0 || existing.UserID != userID {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}

	var req struct {
		Name     *string          `json:"name"`
		ParentID *int             `json:"parentId"`
		Params   *json.RawMessage `json:"params"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	if req.Params != nil {
		var tmp interface{}
		if err := json.Unmarshal(*req.Params, &tmp); err != nil {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "params must be valid JSON"))
			return
		}
	}

	if req.ParentID != nil && (*req.ParentID == id || !h.parentInSpace(req.ParentID, existing.SpaceID)) {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "Parent filter must be another filter in the same space"))
		return
	}

	if err := h.repo.UpdateFilter(id, req.Name, req.ParentID, req.Params); err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Filter updated successfully"}))
}

func (h *FiltersHandler) Delete(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	existing, err := h.repo.GetByID(id)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Filter not found"))
		return
	}
	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, existing.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	// Folders are personal: only their author sees and changes them.
	if roleID == 0 || existing.UserID != userID {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}
	if err := h.repo.SetDeleted(id, true); err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Filter deleted successfully"}))
}

func (h *FiltersHandler) Restore(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	existing, err := h.repo.GetByID(id)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Filter not found"))
		return
	}
	userID := c.GetInt("userId")
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, existing.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	// Folders are personal: only their author sees and changes them.
	if roleID == 0 || existing.UserID != userID {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "No access to the space"))
		return
	}
	if err := h.repo.SetDeleted(id, false); err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Filter restored successfully"}))
}

func (h *FiltersHandler) List(c *gin.Context) {
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

	pagination := types.ParsePaginationParams(c)
	items, total, err := h.repo.List(spaceID, userID, pagination.Page, pagination.PageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	response := pagination.BuildResponse(items, total)
	c.JSON(http.StatusOK, types.NewSuccessResponse(response))
}

// parentInSpace reports whether an optional parent filter id refers to a filter of the same space.
func (h *FiltersHandler) parentInSpace(parentID *int, spaceID int) bool {
	if parentID == nil {
		return true
	}
	parent, err := h.repo.GetByID(*parentID)
	return err == nil && parent != nil && parent.SpaceID == spaceID
}
