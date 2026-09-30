package types

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
)

// AllowedPageSizes defines allowed page sizes
var AllowedPageSizes = []int{10, 20, 50, 100}

// PaginationParams contains pagination parameters from request
type PaginationParams struct {
	Page     int `form:"page" binding:"min=1"`
	PageSize int `form:"pageSize" binding:"min=10,max=100"`
}

// PaginatedResponse contains data with pagination metadata
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Pagination struct {
		Page       int `json:"page"`
		PageSize   int `json:"pageSize"`
		Total      int `json:"total"`
		TotalPages int `json:"totalPages"`
	} `json:"pagination"`
}

// PaginationHelper provides utilities for working with pagination
type PaginationHelper struct {
	Page     int
	PageSize int
	Offset   int
}

// NewPaginationHelper creates a new PaginationHelper instance
func NewPaginationHelper(page, pageSize int) *PaginationHelper {
	if page < 1 {
		page = 1
	}

	// Set default page size if not specified
	if pageSize == 0 {
		pageSize = 20
	}

	// Check if page size is allowed
	validSize := false
	for _, size := range AllowedPageSizes {
		if pageSize == size {
			validSize = true
			break
		}
	}
	if !validSize {
		// If size is not allowed, use the nearest smaller one or 10
		for i := len(AllowedPageSizes) - 1; i >= 0; i-- {
			if AllowedPageSizes[i] <= pageSize {
				pageSize = AllowedPageSizes[i]
				break
			}
		}
		if pageSize == 0 {
			pageSize = 10
		}
	}

	return &PaginationHelper{
		Page:     page,
		PageSize: pageSize,
		Offset:   (page - 1) * pageSize,
	}
}

// BuildResponse creates a standardized response with pagination
func (p *PaginationHelper) BuildResponse(data interface{}, total int) PaginatedResponse {
	totalPages := (total + p.PageSize - 1) / p.PageSize

	return PaginatedResponse{
		Data: data,
		Pagination: struct {
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			Total      int `json:"total"`
			TotalPages int `json:"totalPages"`
		}{
			Page:       p.Page,
			PageSize:   p.PageSize,
			Total:      total,
			TotalPages: totalPages,
		},
	}
}

// ParsePaginationParams extracts pagination parameters from gin.Context
func ParsePaginationParams(c *gin.Context) *PaginationHelper {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))

	return NewPaginationHelper(page, pageSize)
}

// ValidatePageSize checks if page size is allowed
func ValidatePageSize(pageSize int) error {
	for _, size := range AllowedPageSizes {
		if pageSize == size {
			return nil
		}
	}
	return fmt.Errorf("pageSize must be one of: %v", AllowedPageSizes)
}
