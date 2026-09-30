package appenv

import (
	"os"
	"strings"
)

// Env represents the application runtime environment.
// Supported values are strictly "production" and "test".
type Env string

const (
	Production Env = "production"
	Test       Env = "test"
)

// Current returns the effective runtime environment from APP_ENV.
// Unknown or empty values default to Production (safe-by-default).
func Current() Env {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	switch raw {
	case string(Test):
		return Test
	case string(Production), "":
		return Production
	default:
		// Safe-by-default: unknown env behaves as production.
		return Production
	}
}

func IsProduction() bool { return Current() == Production }
func IsTest() bool       { return Current() == Test }

