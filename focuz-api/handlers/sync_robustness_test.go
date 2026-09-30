package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (s *E2ETestSuite) syncPush(payload map[string]any) (int, map[string]any) {
	for _, k := range []string{"notes", "tags", "filters", "charts", "activities"} {
		if _, ok := payload[k]; !ok {
			payload[k] = []any{}
		}
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", s.baseURL+"/sync", bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	s.Require().NoError(err)
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	data, _ := body["data"].(map[string]any)
	return resp.StatusCode, data
}

func (s *E2ETestSuite) pullNotes(since time.Time) []map[string]any {
	req, _ := http.NewRequest("GET", s.baseURL+"/sync?since="+since.UTC().Format(time.RFC3339)+"&spaceId="+itoa(s.createdSpaceID), nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp, err := (&http.Client{}).Do(req)
	s.Require().NoError(err)
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	out := []map[string]any{}
	notes, _ := body["data"].(map[string]any)["notes"].([]any)
	for _, n := range notes {
		out = append(out, n.(map[string]any))
	}
	return out
}

func mappingFor(data map[string]any, clientID string) int {
	ms, _ := data["mappings"].([]any)
	for _, m := range ms {
		mm := m.(map[string]any)
		if mm["clientId"] == clientID {
			return int(mm["serverId"].(float64))
		}
	}
	return 0
}

func versionFor(data map[string]any, resource string, id int) string {
	vs, _ := data["versions"].([]any)
	for _, v := range vs {
		vm := v.(map[string]any)
		if vm["resource"] == resource && int(vm["id"].(float64)) == id {
			return vm["modified_at"].(string)
		}
	}
	return ""
}

// A retried push (lost response) must not duplicate the note.
func (s *E2ETestSuite) Test203_Sync_CreateIsIdempotentByClientId() {
	clientID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	note := map[string]any{"clientId": clientID, "space_id": s.createdSpaceID, "text": "idempotent " + clientID, "tags": []string{}, "created_at": now, "modified_at": now}
	code1, d1 := s.syncPush(map[string]any{"notes": []any{note}})
	code2, d2 := s.syncPush(map[string]any{"notes": []any{note}})
	s.Equal(http.StatusOK, code1)
	s.Equal(http.StatusOK, code2)
	id1, id2 := mappingFor(d1, clientID), mappingFor(d2, clientID)
	s.NotZero(id1)
	s.Equal(id1, id2)

	count := 0
	for _, n := range s.pullNotes(time.Now().Add(-time.Hour)) {
		if n["text"] == "idempotent "+clientID {
			count++
		}
	}
	s.Equal(1, count)
}

// If one item of a push fails, nothing of that push is persisted (no half-applied batches).
func (s *E2ETestSuite) Test204_Sync_PushIsAtomic() {
	clientID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	good := map[string]any{"clientId": clientID, "space_id": s.createdSpaceID, "text": "atomic " + clientID, "tags": []string{}, "created_at": now, "modified_at": now}
	// Second note fails inside the transaction (tag longer than the tag.name column).
	bad := map[string]any{"clientId": uuid.NewString(), "space_id": s.createdSpaceID, "text": "bad", "tags": []string{strings.Repeat("x", 300)}, "created_at": now, "modified_at": now}
	code, _ := s.syncPush(map[string]any{"notes": []any{good, bad}})
	s.Equal(http.StatusInternalServerError, code)
	for _, n := range s.pullNotes(time.Now().Add(-time.Hour)) {
		s.NotEqual("atomic "+clientID, n["text"])
	}
}

// A reply whose parent is unknown to the server must not break the push.
func (s *E2ETestSuite) Test205_Sync_UnknownParentIsDropped() {
	clientID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	note := map[string]any{"clientId": clientID, "space_id": s.createdSpaceID, "text": "orphan", "tags": []string{}, "parent_id": 99999999, "created_at": now, "modified_at": now}
	code, d := s.syncPush(map[string]any{"notes": []any{note}})
	s.Equal(http.StatusOK, code)
	id := mappingFor(d, clientID)
	s.NotZero(id)
	for _, n := range s.pullNotes(time.Now().Add(-time.Hour)) {
		if int(n["id"].(float64)) == id {
			s.Nil(n["parent_id"])
		}
	}
}

// Conflicts are decided by the base version, not by comparing client and server clocks.
func (s *E2ETestSuite) Test206_Sync_BaseVersionConflicts() {
	clientID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	_, d := s.syncPush(map[string]any{"notes": []any{map[string]any{"clientId": clientID, "space_id": s.createdSpaceID, "text": "v1", "tags": []string{}, "created_at": now, "modified_at": now}}})
	id := mappingFor(d, clientID)
	base := versionFor(d, "note", id)
	s.Require().NotEmpty(base)

	// Client clock is an hour behind: the old LWW rule would reject this edit.
	skewed := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	code, d2 := s.syncPush(map[string]any{"notes": []any{map[string]any{"id": id, "space_id": s.createdSpaceID, "text": "v2", "tags": []string{}, "created_at": now, "modified_at": skewed, "base_modified_at": base}}})
	s.Equal(http.StatusOK, code)
	s.Empty(d2["conflicts"])
	base2 := versionFor(d2, "note", id)
	s.NotEmpty(base2)

	// Another device still holding the first version must get a conflict, even with a newer clock.
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	_, d3 := s.syncPush(map[string]any{"notes": []any{map[string]any{"id": id, "space_id": s.createdSpaceID, "text": "stale edit", "tags": []string{}, "created_at": now, "modified_at": future, "base_modified_at": base}}})
	conflicts, _ := d3["conflicts"].([]any)
	s.Len(conflicts, 1)
	for _, n := range s.pullNotes(time.Now().Add(-time.Hour)) {
		if int(n["id"].(float64)) == id {
			s.Equal("v2", n["text"])
		}
	}
}

// Attachments can be downloaded through the API without a presigned MinIO URL.
func (s *E2ETestSuite) Test207_Attachments_ContentEndpoint() {
	clientID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	_, d := s.syncPush(map[string]any{"notes": []any{map[string]any{"clientId": clientID, "space_id": s.createdSpaceID, "text": "with file", "tags": []string{}, "created_at": now, "modified_at": now}}})
	noteID := mappingFor(d, clientID)

	// 1x1 lossless WebP
	webp := []byte("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00")
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", "pixel.webp")
	_, _ = fw.Write(webp)
	_ = w.WriteField("note_id", fmt.Sprint(noteID))
	_ = w.WriteField("client_id", uuid.NewString())
	_ = w.Close()
	req, _ := http.NewRequest("POST", s.baseURL+"/upload", &buf)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := (&http.Client{}).Do(req)
	s.Require().NoError(err)
	var up map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&up)
	resp.Body.Close()
	s.Require().Equal(http.StatusCreated, resp.StatusCode, up)
	attID := up["data"].(map[string]any)["attachment_id"].(string)

	req2, _ := http.NewRequest("GET", s.baseURL+"/files/"+attID+"/content", nil)
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp2, err := (&http.Client{}).Do(req2)
	s.Require().NoError(err)
	defer resp2.Body.Close()
	s.Equal(http.StatusOK, resp2.StatusCode)
	got, _ := io.ReadAll(resp2.Body)
	s.Equal(webp, got)

	// Requires authentication.
	req3, _ := http.NewRequest("GET", s.baseURL+"/files/"+attID+"/content", nil)
	resp3, err := (&http.Client{}).Do(req3)
	s.Require().NoError(err)
	resp3.Body.Close()
	s.Equal(http.StatusUnauthorized, resp3.StatusCode)
}

func (s *E2ETestSuite) uploadPixel(noteID int, position string) string {
	webp := []byte("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00")
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", "pixel.webp")
	_, _ = fw.Write(webp)
	_ = w.WriteField("note_id", fmt.Sprint(noteID))
	_ = w.WriteField("client_id", uuid.NewString())
	if position != "" {
		_ = w.WriteField("position", position)
	}
	_ = w.Close()
	req, _ := http.NewRequest("POST", s.baseURL+"/upload", &buf)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := (&http.Client{}).Do(req)
	s.Require().NoError(err)
	defer resp.Body.Close()
	var up map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&up)
	s.Require().Equal(http.StatusCreated, resp.StatusCode, up)
	return up["data"].(map[string]any)["attachment_id"].(string)
}

func (s *E2ETestSuite) pulledAttachmentIDs(since time.Time, noteID int) []string {
	for _, n := range s.pullNotes(since) {
		if int(n["id"].(float64)) != noteID {
			continue
		}
		ids := []string{}
		atts, _ := n["attachments"].([]any)
		for _, a := range atts {
			ids = append(ids, a.(map[string]any)["id"].(string))
		}
		return ids
	}
	return nil
}

func (s *E2ETestSuite) Test213_Attachments_KeepTheirPosition() {
	since := time.Now().Add(-time.Minute)
	clientID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	_, d := s.syncPush(map[string]any{"notes": []any{map[string]any{"clientId": clientID, "space_id": s.createdSpaceID, "text": "ordered images", "tags": []string{}, "created_at": now, "modified_at": now}}})
	noteID := mappingFor(d, clientID)
	s.Require().NotZero(noteID)

	// Uploaded out of order: the list follows the positions, not the upload time.
	third := s.uploadPixel(noteID, "2")
	first := s.uploadPixel(noteID, "0")
	second := s.uploadPixel(noteID, "1")
	s.Equal([]string{first, second, third}, s.pulledAttachmentIDs(since, noteID))

	// Without a position the image goes last.
	last := s.uploadPixel(noteID, "")
	s.Equal([]string{first, second, third, last}, s.pulledAttachmentIDs(since, noteID))

	// Reorder through sync.
	var serverModified string
	for _, n := range s.pullNotes(since) {
		if int(n["id"].(float64)) == noteID {
			serverModified, _ = n["modified_at"].(string)
		}
	}
	later := time.Now().UTC().Add(time.Second).Format(time.RFC3339)
	status, _ := s.syncPush(map[string]any{"notes": []any{map[string]any{
		"id": noteID, "space_id": s.createdSpaceID, "text": "ordered images", "tags": []string{},
		"created_at": now, "modified_at": later, "base_modified_at": serverModified,
		"attachments": []any{
			map[string]any{"id": last, "modified_at": later, "position": 0},
			map[string]any{"id": first, "modified_at": later, "position": 1},
			map[string]any{"id": second, "modified_at": later, "position": 2},
			map[string]any{"id": third, "modified_at": later, "position": 3},
		},
	}}})
	s.Equal(http.StatusOK, status)
	s.Equal([]string{last, first, second, third}, s.pulledAttachmentIDs(since, noteID))
}
