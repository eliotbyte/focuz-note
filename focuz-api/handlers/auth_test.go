package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
)

func (s *E2ETestSuite) Test01_RegisterOwner() {
	body := `{"username":"owner","password":"ownerpass"}`
	resp, err := http.Post(s.baseURL+"/register", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)
}

func (s *E2ETestSuite) Test02_RegisterOwnerConflict() {
	body := `{"username":"owner","password":"ownerpass"}`
	resp, err := http.Post(s.baseURL+"/register", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusConflict, resp.StatusCode)
}

func (s *E2ETestSuite) Test03_LoginOwnerInvalid() {
	body := `{"username":"owner","password":"invalid"}`
	resp, err := http.Post(s.baseURL+"/login", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusUnauthorized, resp.StatusCode)
}

func (s *E2ETestSuite) Test04_LoginOwnerValid() {
	body := `{"username":"owner","password":"ownerpass"}`
	resp, err := http.Post(s.baseURL+"/login", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	var data map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)
	if data["success"] != nil && data["success"].(bool) {
		tokenData := data["data"].(map[string]interface{})
		s.ownerToken = tokenData["token"].(string)
		s.NotEmpty(s.ownerToken)
	} else {
		s.Fail("Login failed")
	}
}

func (s *E2ETestSuite) Test05_RegisterGuest() {
	body := `{"username":"guest","password":"guestpass"}`
	resp, err := http.Post(s.baseURL+"/register", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)
}

func (s *E2ETestSuite) Test06_LoginGuest() {
	body := `{"username":"guest","password":"guestpass"}`
	resp, err := http.Post(s.baseURL+"/login", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	var data map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)
	if data["success"] != nil && data["success"].(bool) {
		tokenData := data["data"].(map[string]interface{})
		s.guestToken = tokenData["token"].(string)
		s.NotEmpty(s.guestToken)
	} else {
		s.Fail("Login failed")
	}
}

func (s *E2ETestSuite) Test07_VerifyGuestUserExists() {
	// Verify that guest user was created and can login
	body := `{"username":"guest","password":"guestpass"}`
	resp, err := http.Post(s.baseURL+"/login", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	var data map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)
	s.True(data["success"].(bool), "Guest login should succeed")

	tokenData := data["data"].(map[string]interface{})
	s.NotNil(tokenData["token"], "Token should be present")

	// Verify user data is present
	if tokenData["user"] != nil {
		userData := tokenData["user"].(map[string]interface{})
		s.NotNil(userData["id"], "User ID should be present")
		s.Equal("guest", userData["username"], "Username should be 'guest'")

		// Store the actual guest user ID for use in other tests
		guestUserID := int(userData["id"].(float64))
		s.True(guestUserID > 0, "Guest user ID should be positive")
		s.Equal(2, guestUserID, "Guest user should have ID 2 (owner has ID 1)")
	}
}
