package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
)

func (s *E2ETestSuite) Test08_CreateSpace() {
	reqBody := `{"name":"Test Space"}`
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces", bytes.NewBuffer([]byte(reqBody)))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	var spaceResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&spaceResp)
	if spaceResp["success"] != nil && spaceResp["success"].(bool) {
		spaceData := spaceResp["data"].(map[string]interface{})
		id := int(spaceData["id"].(float64))
		s.createdSpaceID = id
		s.True(s.createdSpaceID > 0)
	} else {
		s.Fail("Space creation failed")
	}
}

func (s *E2ETestSuite) Test09_InviteGuest() {
	// First ensure guest user is created and logged in
	// This test should run after Test05_RegisterGuest and Test06_LoginGuest

	// Invite guest user by username instead of userID
	reqBody := map[string]string{"username": "guest"}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/invite", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test10_GuestCannotEditSpace() {
	reqBody := `{"name":"New Name"}`
	req, _ := http.NewRequest("PATCH", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID), bytes.NewBuffer([]byte(reqBody)))
	req.Header.Set("Authorization", "Bearer "+s.guestToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	// The invitation is not accepted yet: to them the space does not exist.
	s.Equal(http.StatusNotFound, resp.StatusCode)
}

func (s *E2ETestSuite) Test11_GetAccessibleSpaces() {
	req, _ := http.NewRequest("GET", s.baseURL+"/spaces", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))

	// Handle paginated response structure
	data := response["data"].(map[string]interface{})
	spaces := data["data"].([]interface{})
	s.True(len(spaces) >= 1)

	found := false
	for _, sp := range spaces {
		space := sp.(map[string]interface{})
		if int(space["id"].(float64)) == s.createdSpaceID {
			found = true
			s.Contains(space, "name")
			s.Contains(space, "ownerId")
			s.Contains(space, "createdAt")
			s.Contains(space, "modifiedAt")
			break
		}
	}
	s.True(found)
}

func (s *E2ETestSuite) Test12_CreateParticipantAndInvite() {
	body := `{"username":"participant","password":"partpass"}`
	resp, err := http.Post(s.baseURL+"/register", "application/json", bytes.NewBuffer([]byte(body)))
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	reqBody := map[string]string{"username": "participant"}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/invite", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp2, err2 := client.Do(req)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusOK, resp2.StatusCode)
}

func (s *E2ETestSuite) Test13_RemoveUser_GuestCantRemove() {
	req, _ := http.NewRequest(
		"DELETE",
		s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/users/3",
		nil,
	)
	req.Header.Set("Authorization", "Bearer "+s.guestToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusNotFound, resp.StatusCode) // not a member (invitation pending)
}

func (s *E2ETestSuite) Test14_RemoveUser_ParticipantNotFound() {
	req, _ := http.NewRequest(
		"DELETE",
		s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/users/9999",
		nil,
	)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusNotFound, resp.StatusCode)
}

func (s *E2ETestSuite) Test15_RemoveUser_CannotRemoveOwner() {
	req, _ := http.NewRequest(
		"DELETE",
		s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/users/1",
		nil,
	)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	// User 1 is the owner themself: the owner can't leave (delete the space instead).
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test16_RemoveUser_Success() {
	// Ensure guest is an active member (not pending) before removal
	accReq, _ := http.NewRequest(
		"POST",
		s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/invitations/accept",
		nil,
	)
	accReq.Header.Set("Authorization", "Bearer "+s.guestToken)
	accResp, err := (&http.Client{}).Do(accReq)
	s.NoError(err)
	defer accResp.Body.Close()
	// Accept may be idempotent if already accepted; allow 200
	s.Equal(http.StatusOK, accResp.StatusCode)

	req, _ := http.NewRequest(
		"DELETE",
		s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/users/3",
		nil,
	)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test17_GetUsersInSpace_Success() {
	req, _ := http.NewRequest("GET", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/users", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))

	users := response["data"].([]interface{})
	s.True(len(users) >= 1)

	found := false
	for _, u := range users {
		user := u.(map[string]interface{})
		if int(user["user_id"].(float64)) == 1 { // owner
			found = true
			s.Contains(user, "username")
			s.Equal("owner", user["role"])
			s.NotContains(user, "email")
			break
		}
	}
	s.True(found)
}

func (s *E2ETestSuite) Test18_GetUsersInSpace_ForbiddenForNonMember() {
	req, _ := http.NewRequest("GET", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/users", nil)
	req.Header.Set("Authorization", "Bearer "+s.guestToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusNotFound, resp.StatusCode) // removed in Test16: no longer a member
}
