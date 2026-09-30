package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

func (s *E2ETestSuite) Test200_Sync_PullEmptyThenAfterCreate() {
	// initial pull (no changes since epoch)
	req, _ := http.NewRequest("GET", s.baseURL+"/sync?since="+urlQuery("1970-01-01T00:00:00Z"), nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
	var body map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	s.True(body["success"].(bool))

	// create a note
	payload := map[string]any{
		"text":    "sync note",
		"tags":    []string{"sync"},
		"date":    time.Now().Format(time.RFC3339),
		"spaceId": s.createdSpaceID,
	}
	b, _ := json.Marshal(payload)
	req2, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(b))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err := (&http.Client{}).Do(req2)
	s.NoError(err)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)

	// pull since recent timestamp
	since := time.Now().Add(-1 * time.Minute).Format(time.RFC3339)
	req3, _ := http.NewRequest("GET", s.baseURL+"/sync?since="+urlQuery(since)+"&spaceId="+itoa(s.createdSpaceID), nil)
	req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp3, err := (&http.Client{}).Do(req3)
	s.NoError(err)
	defer resp3.Body.Close()
	s.Equal(http.StatusOK, resp3.StatusCode)
	var pull map[string]any
	_ = json.NewDecoder(resp3.Body).Decode(&pull)
	s.True(pull["success"].(bool))
	data := pull["data"].(map[string]any)
	notes := data["notes"].([]any)
	s.True(len(notes) >= 1)
}

func (s *E2ETestSuite) Test201_Sync_PushCreateAndMapping() {
	now := time.Now().Format(time.RFC3339)
	payload := map[string]any{
		"notes": []map[string]any{
			{
				"clientId":    "tmp-1",
				"space_id":    s.createdSpaceID,
				"text":        "client created",
				"tags":        []string{"sync"},
				"created_at":  now,
				"modified_at": now,
			},
		},
		"tags": []any{}, "filters": []any{}, "charts": []any{}, "activities": []any{},
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", s.baseURL+"/sync", bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	s.True(body["success"].(bool))
	mappings := body["data"].(map[string]any)["mappings"].([]any)
	s.True(len(mappings) >= 1)
}

func (s *E2ETestSuite) Test202_Sync_PullIncludesActivityTypesAndAttachments() {
	// just call pull and assert presence of arrays
	since := time.Now().Add(-1 * time.Hour).Format(time.RFC3339)
	req, _ := http.NewRequest("GET", s.baseURL+"/sync?since="+urlQuery(since)+"&spaceId="+itoa(s.createdSpaceID), nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	s.True(body["success"].(bool))
	data := body["data"].(map[string]any)
	_, ok1 := data["activityTypes"]
	s.True(ok1)
	// attachments are nested under notes; ensure notes[0] has attachments array key present (maybe empty)
	notes := data["notes"].([]any)
	if len(notes) > 0 {
		first := notes[0].(map[string]any)
		_, hasAttachments := first["attachments"]
		s.True(hasAttachments)
	}
}

// helpers
func urlQuery(s string) string { return s }
func itoa(n int) string        { return strconv.Itoa(n) }
