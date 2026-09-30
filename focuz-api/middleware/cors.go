package middleware

import (
	"net/http"
	"os"
	"strings"

	"focuz-api/pkg/appenv"

	"github.com/gin-gonic/gin"
)

// CORSMiddleware configures CORS headers.
//   - In non-production environments, it allows any origin ("*") for convenience.
//   - In production (APP_ENV=production or Gin release mode), it reflects the incoming Origin
//     only if it is present in the comma-separated ALLOWED_ORIGINS env var.
//     Optionally sets Access-Control-Allow-Credentials when ALLOW_CREDENTIALS=true.
func CORSMiddleware() gin.HandlerFunc {
	isProd := appenv.IsProduction() || gin.Mode() == gin.ReleaseMode

	allowedOriginsEnv := os.Getenv("ALLOWED_ORIGINS")
	var allowedOrigins map[string]struct{}
	if allowedOriginsEnv != "" {
		allowedOrigins = make(map[string]struct{})
		for _, o := range strings.Split(allowedOriginsEnv, ",") {
			origin := strings.TrimSpace(o)
			if origin != "" {
				allowedOrigins[origin] = struct{}{}
			}
		}
	}

	allowCredentials := strings.EqualFold(os.Getenv("ALLOW_CREDENTIALS"), "true")
	allowedMethods := "GET, POST, PUT, PATCH, DELETE, OPTIONS"
	allowedHeaders := "Origin, Content-Type, Authorization"

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Advise caches that the response varies based on Origin
		c.Header("Vary", "Origin")

		if !isProd {
			// Development: permit any origin
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", allowedMethods)
			c.Header("Access-Control-Allow-Headers", allowedHeaders)
			if c.Request.Method == http.MethodOptions {
				c.AbortWithStatus(http.StatusNoContent)
				return
			}
			c.Next()
			return
		}

		// Production: reflect only allowed origins
		if origin != "" {
			if allowedOrigins != nil {
				// "*" lets any web app (e.g. one hosted elsewhere, pointed at this server by the user)
				// call the API. Safe here because auth is a bearer token, never a cookie.
				_, any := allowedOrigins["*"]
				if _, ok := allowedOrigins[origin]; ok || (any && !allowCredentials) {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Access-Control-Allow-Methods", allowedMethods)
					c.Header("Access-Control-Allow-Headers", allowedHeaders)
					if allowCredentials {
						c.Header("Access-Control-Allow-Credentials", "true")
					}
				}
			}
		}

		if c.Request.Method == http.MethodOptions {
			// Preflight: return 204. If origin not allowed, headers above will be absent
			// and the browser will block the request.
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
