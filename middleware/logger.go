package middleware

import (
	"encoding/json"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// LoggerMiddleware writes JSON-structured access logs for each HTTP request.
// It replaces Gin's default logger with a compact, machine-parsable format suitable
// for centralized log aggregation. Sensitive data must not be logged here.
func LoggerMiddleware() gin.HandlerFunc {
	hostname, _ := os.Hostname()
	return gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		latencyMs := float64(param.Latency) / float64(time.Millisecond)
		entry := struct {
			Timestamp string  `json:"ts"`
			Level     string  `json:"level"`
			Hostname  string  `json:"host"`
			ClientIP  string  `json:"ip"`
			Method    string  `json:"method"`
			Path      string  `json:"path"`
			Proto     string  `json:"proto"`
			Status    int     `json:"status"`
			LatencyMs float64 `json:"latencyMs"`
			UserAgent string  `json:"ua"`
			BodySize  int     `json:"size"`
			Error     string  `json:"error,omitempty"`
		}{
			Timestamp: param.TimeStamp.UTC().Format(time.RFC3339Nano),
			Level:     "info",
			Hostname:  hostname,
			ClientIP:  param.ClientIP,
			Method:    param.Method,
			// URL path only: gin's param.Path includes the query string, and /ws?token=... would
			// put bearer tokens into the logs.
			Path:      param.Request.URL.Path,
			Proto:     param.Request.Proto,
			Status:    param.StatusCode,
			LatencyMs: latencyMs,
			UserAgent: param.Request.UserAgent(),
			BodySize:  param.BodySize,
			Error:     param.ErrorMessage,
		}
		b, _ := json.Marshal(entry)
		return string(b) + "\n"
	})
}
