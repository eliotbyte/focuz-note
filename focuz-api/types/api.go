package types

// APIResponse represents a standardized API response
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError   `json:"error,omitempty"`
}

// APIError represents an error in the API response
type APIError struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Details map[string]interface{} `json:"details,omitempty"`
}

// NewSuccessResponse creates a new successful API response
func NewSuccessResponse(data interface{}) *APIResponse {
	return &APIResponse{
		Success: true,
		Data:    data,
	}
}

// NewErrorResponse creates a new error API response
func NewErrorResponse(code, message string) *APIResponse {
	return &APIResponse{
		Success: false,
		Error: &APIError{
			Code:    code,
			Message: message,
		},
	}
}

// NewErrorResponseWithDetails creates a new error API response with additional details
func NewErrorResponseWithDetails(code, message string, details map[string]interface{}) *APIResponse {
	return &APIResponse{
		Success: false,
		Error: &APIError{
			Code:    code,
			Message: message,
			Details: details,
		},
	}
}

// Common error codes
const (
	ErrorCodeValidation     = "VALIDATION_ERROR"
	ErrorCodeUnauthorized   = "UNAUTHORIZED"
	ErrorCodeForbidden      = "FORBIDDEN"
	ErrorCodeNotFound       = "NOT_FOUND"
	ErrorCodeConflict       = "CONFLICT"
	ErrorCodeInternal       = "INTERNAL_ERROR"
	ErrorCodeInvalidToken   = "INVALID_TOKEN"
	ErrorCodeInvalidRequest = "INVALID_REQUEST"
)
