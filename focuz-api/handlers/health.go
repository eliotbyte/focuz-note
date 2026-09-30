package handlers

import (
	"net/http"
	"time"

	"focuz-api/pkg/appenv"
	"focuz-api/pkg/buildinfo"

	"github.com/gin-gonic/gin"
)

// HealthCheck returns a simple health status for uptime monitoring and load balancers.
// It is intentionally lightweight and unauthenticated.
func HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":      "ok",
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
		"version":     buildinfo.Version,
		"environment": string(appenv.Current()),
	})
}
