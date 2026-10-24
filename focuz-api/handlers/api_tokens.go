package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"focuz-api/pkg/apitoken"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
)

type APITokensHandler struct {
	repo *repository.APITokensRepository
}

func NewAPITokensHandler(repo *repository.APITokensRepository) *APITokensHandler {
	return &APITokensHandler{repo: repo}
}

// sessionOnly refuses API tokens: a token must not be able to make more tokens.
func sessionOnly(c *gin.Context) bool {
	if c.GetString(scopeKey) != "" {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "Sign in to manage API tokens"))
		return false
	}
	return true
}

// GET /me/api-tokens
func (h *APITokensHandler) List(c *gin.Context) {
	if !sessionOnly(c) {
		return
	}
	tokens, err := h.repo.List(c.GetInt("userId"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(tokens))
}

// POST /me/api-tokens { name, scope: "read" | "write" } — the secret is returned only once.
func (h *APITokensHandler) Create(c *gin.Context) {
	if !sessionOnly(c) {
		return
	}
	var req struct {
		Name  string `json:"name" binding:"required,max=100"`
		Scope string `json:"scope" binding:"required,oneof=read write"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Name (up to 100 characters) and scope (read or write) are required"))
		return
	}
	raw, err := apitoken.Generate()
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	token, err := h.repo.Create(c.GetInt("userId"), strings.TrimSpace(req.Name), req.Scope, apitoken.DisplayPrefix(raw), apitoken.Hash(raw))
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(gin.H{"token": raw, "info": token}))
}

// DELETE /me/api-tokens/:id
func (h *APITokensHandler) Revoke(c *gin.Context) {
	if !sessionOnly(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	if err := h.repo.Revoke(c.GetInt("userId"), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "Token not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"success": true}))
}
