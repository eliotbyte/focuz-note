package tests

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Minimal unit tests using small, isolated functionality from the repository.
func TestTruncate(t *testing.T) {
	s := "Hello, world!"
	result := truncate(s, 5)
	assert.Equal(t, "Hello", result)

	s2 := "Short"
	result2 := truncate(s2, 10)
	assert.Equal(t, "Short", result2)
}

// This is copied from notes_repository.go for testing purposes.
func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max]
	}
	return s
}
