package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestIDMiddleware ensures that each request has a stable X-Request-ID.
// If the client provides one, it is propagated; otherwise a new UUIDv4 is generated.
// The value is set to the response header and available in the gin context under key "requestId".
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqID := c.GetHeader("X-Request-ID")
		if reqID == "" {
			reqID = uuid.NewString()
		}
		c.Writer.Header().Set("X-Request-ID", reqID)
		c.Set("requestId", reqID)
		c.Next()
	}
}
