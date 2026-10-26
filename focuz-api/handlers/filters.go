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
	filter, err := h.createFolder(c.GetInt("userId"), req.SpaceID, req.Name, req.ParentID, req.Params)
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(filter))
}

// PATCH /filters/:id { name?, parentId?, params? }: a field left out stays; parentId null moves the
// folder to the top level.
func (h *FiltersHandler) Update(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	var edit folderEdit
	if err := c.ShouldBindJSON(&edit); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	if _, err := h.updateFolder(c.GetInt("userId"), id, edit); err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": "Filter updated successfully"}))
}

func (h *FiltersHandler) Delete(c *gin.Context) { h.setDeleted(c, true, "Filter deleted successfully") }

func (h *FiltersHandler) Restore(c *gin.Context) {
	h.setDeleted(c, false, "Filter restored successfully")
}

func (h *FiltersHandler) setDeleted(c *gin.Context, deleted bool, message string) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	if err := h.setFolderDeleted(c.GetInt("userId"), id, deleted); err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"message": message}))
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
