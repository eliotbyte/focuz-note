package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"
)

func (s *E2ETestSuite) Test23_CreateNote() {
	reqBody := map[string]interface{}{
		"text":     "My first note",
		"tags":     []string{"personal", "important"},
		"parentId": nil,
		"date":     time.Now().Format(time.RFC3339),
		"spaceId":  s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)

	req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	var noteResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&noteResp)
	if noteResp["success"] != nil && noteResp["success"].(bool) {
		noteData := noteResp["data"].(map[string]interface{})
		s.createdNoteID = int(noteData["id"].(float64))
		s.True(s.createdNoteID > 0)
	} else {
		s.Fail("Note creation failed")
	}
}

func (s *E2ETestSuite) Test24_CreateNoteReply() {
	reqBody := map[string]interface{}{
		"text":     "Reply to note",
		"tags":     []string{"reply"},
		"parentId": s.createdNoteID,
		"date":     time.Now().Format(time.RFC3339),
		"spaceId":  s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)
}

func (s *E2ETestSuite) Test25_CreateNoteAsGuest() {
	// Re-invite guest to the space since they might have been removed in previous tests
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

	// Attempt to create note as guest BEFORE accepting -> should be forbidden (pending)
	reqBody2 := map[string]interface{}{
		"text":    "Guest notebook note",
		"tags":    []string{"guest", "notebook"},
		"date":    time.Now().Format(time.RFC3339),
		"spaceId": s.createdSpaceID,
	}
	jsonBody2, _ := json.Marshal(reqBody2)
	req2, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody2))
	req2.Header.Set("Authorization", "Bearer "+s.guestToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := (&http.Client{}).Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusForbidden, resp2.StatusCode)

	// Accept invitation
	reqAcc, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/invitations/accept", nil)
	reqAcc.Header.Set("Authorization", "Bearer "+s.guestToken)
	respAcc, errAcc := (&http.Client{}).Do(reqAcc)
	s.NoError(errAcc)
	defer respAcc.Body.Close()
	s.Equal(http.StatusOK, respAcc.StatusCode)

	// Now create note as guest -> should succeed
	req3, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody2))
	req3.Header.Set("Authorization", "Bearer "+s.guestToken)
	req3.Header.Set("Content-Type", "application/json")
	resp3, err3 := (&http.Client{}).Do(req3)
	s.NoError(err3)
	defer resp3.Body.Close()
	s.Equal(http.StatusCreated, resp3.StatusCode)
}

func (s *E2ETestSuite) Test26B_DeclineInvitationPreventsAccess() {
	// Re-inviting an active member is refused (it used to silently demote them), so remove the
	// guest first.
	guestID := 0
	_, members := s.call("GET", "/spaces/"+strconv.Itoa(s.createdSpaceID)+"/members", s.ownerToken, nil)
	for _, m := range members["data"].([]any) {
		if mm := m.(map[string]any); mm["username"] == "guest" {
			guestID = int(mm["user_id"].(float64))
		}
	}
	s.Require().NotZero(guestID)
	reqDel, _ := http.NewRequest("DELETE", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/users/"+strconv.Itoa(guestID), nil)
	reqDel.Header.Set("Authorization", "Bearer "+s.ownerToken)
	respDel, errDel := (&http.Client{}).Do(reqDel)
	s.NoError(errDel)
	respDel.Body.Close()
	s.Equal(http.StatusOK, respDel.StatusCode)

	// Invite guest again
	reqBody := map[string]string{"username": "guest"}
	b, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/invite", bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	// Decline invitation
	reqDec, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/invitations/decline", nil)
	reqDec.Header.Set("Authorization", "Bearer "+s.guestToken)
	respDec, errDec := (&http.Client{}).Do(reqDec)
	s.NoError(errDec)
	defer respDec.Body.Close()
	s.Equal(http.StatusOK, respDec.StatusCode)

	// Attempt to create note after decline -> still forbidden
	reqNote := map[string]interface{}{
		"text":    "should fail",
		"tags":    []string{"guest"},
		"date":    time.Now().Format(time.RFC3339),
		"spaceId": s.createdSpaceID,
	}
	bn, _ := json.Marshal(reqNote)
	reqN, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(bn))
	reqN.Header.Set("Authorization", "Bearer "+s.guestToken)
	reqN.Header.Set("Content-Type", "application/json")
	respN, errN := (&http.Client{}).Do(reqN)
	s.NoError(errN)
	defer respN.Body.Close()
	s.Equal(http.StatusForbidden, respN.StatusCode)
}

func (s *E2ETestSuite) Test27_EditNote() {
	reqBody := map[string]interface{}{
		"text":    "Edited note text",
		"tags":    []string{"important"},
		"spaceId": s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("PATCH", s.baseURL+"/notes/"+strconv.Itoa(s.createdNoteID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	// Endpoint may not exist; ensure it's 404 as before
	s.Equal(http.StatusNotFound, resp.StatusCode)
}

func (s *E2ETestSuite) Test28_GetSingleNote() {
	req, _ := http.NewRequest("GET", s.baseURL+"/notes/"+strconv.Itoa(s.createdNoteID), nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test29_GetAllNotes() {
	req, _ := http.NewRequest("GET", s.baseURL+"/notes?spaceId="+strconv.Itoa(s.createdSpaceID), nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	body, _ := io.ReadAll(resp.Body)
	s.Contains(string(body), "My first note")
}

func (s *E2ETestSuite) Test30_GetAllNotesWithFilters() {
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&tags=important&tags=!reply&notReply=true"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test31_GetNotesWithDateFilters() {
	// Test filtering by date range
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&dateFrom=2024-01-01&dateTo=2024-12-31"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test32_GetNotesWithTagExclusions() {
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&tags=!archived&tags=!draft"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test33_GetNotesWithMixedTagFilters() {
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&tags=important&tags=!archived"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test34_GetNotesWithSorting() {
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&sort=modifiedat,ASC"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test35_GetNotesWithSearchAndFilters() {
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&search=meeting&tags=!archived&notReply=true"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	// Server-side word search was removed (local-first client search).
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test36_GetNotesWithParentFilter() {
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&parentId=0"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test37_GetNotesWithComplexFilters() {
	url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + "&tags=important&tags=!archived&dateFrom=2024-01-01&dateTo=2024-12-31&search=note&sort=modifiedat,ASC&notReply=true&page=1&pageSize=20"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	// Server-side word search was removed (local-first client search).
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test65_TagFiltering_StrictIncludeAndExclude() {
	// Create notes with controlled tags
	create := func(text string, tags []string) int {
		reqBody := map[string]interface{}{
			"text":    text,
			"tags":    tags,
			"date":    time.Now().Format(time.RFC3339),
			"spaceId": s.createdSpaceID,
		}
		b, _ := json.Marshal(reqBody)
		req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(b))
		req.Header.Set("Authorization", "Bearer "+s.ownerToken)
		req.Header.Set("Content-Type", "application/json")
		resp, err := (&http.Client{}).Do(req)
		s.NoError(err)
		defer resp.Body.Close()
		s.Equal(http.StatusCreated, resp.StatusCode)
		var respJson map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&respJson)
		data := respJson["data"].(map[string]interface{})
		return int(data["id"].(float64))
	}

	_ = create("note A", []string{"task", "code"})
	_ = create("note B", []string{"task", "code", "archive"})
	_ = create("note C", []string{"task"})
	_ = create("note D", []string{"code", "draft"})

	// Helper to GET and unpack notes list
	getNotes := func(query string) []map[string]interface{} {
		url := s.baseURL + "/notes?spaceId=" + strconv.Itoa(s.createdSpaceID) + query
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+s.ownerToken)
		resp, err := (&http.Client{}).Do(req)
		s.NoError(err)
		defer resp.Body.Close()
		s.Equal(http.StatusOK, resp.StatusCode)
		var body map[string]interface{}
		b, _ := io.ReadAll(resp.Body)
		json.Unmarshal(b, &body)
		// unwrap standardized response { success, data }
		data := body["data"].(map[string]interface{})
		items := data["data"].([]interface{})
		var notes []map[string]interface{}
		for _, it := range items {
			notes = append(notes, it.(map[string]interface{}))
		}
		return notes
	}

	// 1) Two positive AND two negative: task,code,!archive,!draft -> only note A
	res1 := getNotes("&tags=task&tags=code&tags=!archive&tags=!draft")
	if s.Equal(1, len(res1)) {
		s.Equal("note A", res1[0]["text"].(string))
	}

	// 2) Only two positive: task,code -> notes A and B (both have task+code)
	res2 := getNotes("&tags=task&tags=code")
	// order not guaranteed; collect texts
	texts2 := map[string]bool{}
	for _, n := range res2 {
		texts2[n["text"].(string)] = true
	}
	s.True(texts2["note A"])
	s.True(texts2["note B"])

	// 3) Only one positive: task -> notes A, B, C
	res3 := getNotes("&tags=task")
	texts3 := map[string]bool{}
	for _, n := range res3 {
		texts3[n["text"].(string)] = true
	}
	s.True(texts3["note A"])
	s.True(texts3["note B"])
	s.True(texts3["note C"])

	// 4) Only one negative: !draft -> exclude note D, keep A,B,C
	res4 := getNotes("&tags=!draft")
	texts4 := map[string]bool{}
	for _, n := range res4 {
		texts4[n["text"].(string)] = true
	}
	s.True(texts4["note A"])
	s.True(texts4["note B"])
	s.True(texts4["note C"])
	s.False(texts4["note D"])
}

func (s *E2ETestSuite) Test93_CreateFilterWithComplexParams() {
	params := map[string]interface{}{
		"tags":     []string{"important", "!archived"},
		"notReply": true,
		"search":   "meeting",
		"dateFrom": "2024-01-01",
		"dateTo":   "2024-12-31",
		"sort":     "modifiedat,ASC",
		"page":     1,
		"pageSize": 50,
	}
	body := map[string]interface{}{
		"spaceId": s.createdSpaceID,
		"name":    "Complex",
		"params":  params,
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", s.baseURL+"/filters", bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)
}
