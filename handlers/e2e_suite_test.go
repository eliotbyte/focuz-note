package handlers

import (
	"os"
	"testing"

	"github.com/stretchr/testify/suite"
)

type E2ETestSuite struct {
	suite.Suite
	baseURL        string
	ownerToken     string
	guestToken     string
	createdSpaceID int
	createdNoteID  int
}

func (s *E2ETestSuite) SetupSuite() {
	// Use test API container name when running in Docker, localhost otherwise
	if u := os.Getenv("API_URL"); u != "" {
		s.baseURL = u
	} else if os.Getenv("CI") != "" || os.Getenv("DOCKER") != "" {
		s.baseURL = "http://test-api:8080"
	} else {
		s.baseURL = "http://localhost:8080"
	}
}

func TestE2ETestSuite(t *testing.T) {
	suite.Run(t, new(E2ETestSuite))
}
