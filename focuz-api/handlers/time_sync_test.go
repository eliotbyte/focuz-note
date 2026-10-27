package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// pullAll returns the data of GET /sync for one space.
func (s *E2ETestSuite) pullAll(token string, spaceID int, since string) map[string]any {
	code, out := s.call("GET", "/sync?since="+url.QueryEscape(since)+"&spaceId="+strconv.Itoa(spaceID), token, nil)
	s.Require().Equal(http.StatusOK, code, out)
	return out["data"].(map[string]any)
}

func pulledNote(data map[string]any, id int) map[string]any {
	notes, _ := data["notes"].([]any)
	for _, n := range notes {
		m := n.(map[string]any)
		if int(m["id"].(float64)) == id {
			return m
		}
	}
	return nil
}

func sameInstant(s *E2ETestSuite, want string, got any) {
	w, err := time.Parse(time.RFC3339, want)
	s.Require().NoError(err)
	str, _ := got.(string)
	g, err := time.Parse(time.RFC3339, str)
	s.Require().NoError(err, "time %v", got)
	s.True(w.Equal(g), "want %s, got %s", w.UTC(), g.UTC())
}

// A time with an offset is the instant it names, through MCP and /sync alike.
func (s *E2ETestSuite) Test350_TimesWithOffset() {
	tok, _ := s.newUser("offset")
	space := s.createSpace(tok, "Zones")
	const at = "2026-10-27T14:00:00+03:00" // 11:00 UTC

	res := s.mcpTool(tok, "create_note", map[string]any{"spaceId": space, "text": "zoned", "date": at})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	var created struct {
		ID   int    `json:"id"`
		Date string `json:"date"`
	}
	s.Require().NoError(json.Unmarshal([]byte(blockText(res, 0)), &created))
	sameInstant(s, at, created.Date)
	got := s.mcpTool(tok, "get_note", map[string]any{"id": created.ID})
	var note struct {
		Date string `json:"date"`
	}
	s.Require().NoError(json.Unmarshal([]byte(blockText(got, 0)), &note))
	sameInstant(s, at, note.Date)

	clientID := uuid.NewString()
	code, data := s.pushAs(tok, map[string]any{"notes": []any{map[string]any{
		"clientId": clientID, "space_id": space, "text": "pushed", "tags": []string{},
		"created_at": at, "modified_at": at, "date": at,
	}}})
	s.Require().Equal(http.StatusOK, code, data)
	id := mappingFor(data, clientID)
	s.Require().NotZero(id)
	n := pulledNote(s.pullAll(tok, space, "1970-01-01T00:00:00Z"), id)
	s.Require().NotNil(n)
	sameInstant(s, at, n["created_at"])
	sameInstant(s, at, n["date"])
}

// The pull checkpoint comes from the server: a client time from the future hides nothing.
func (s *E2ETestSuite) Test351_PullCheckpoint() {
	tok, _ := s.newUser("checkpoint")
	space := s.createSpace(tok, "Clock")
	typeID := s.metricID(tok, space, "Push-ups", "integer")
	future := "2099-01-01T00:00:00Z"
	clientID := uuid.NewString()
	code, data := s.pushAs(tok, map[string]any{"notes": []any{map[string]any{
		"clientId": clientID, "space_id": space, "text": "from the future", "tags": []string{},
		"created_at": future, "modified_at": future,
		"activities": []any{map[string]any{"type_id": typeID, "value": map[string]any{"data": 5}, "created_at": future, "modified_at": future}},
	}}})
	s.Require().Equal(http.StatusOK, code, data)
	id := mappingFor(data, clientID)

	before := time.Now().Add(-time.Minute)
	pull := s.pullAll(tok, space, before.UTC().Format(time.RFC3339))
	n := pulledNote(pull, id)
	s.Require().NotNil(n, "the new note is in the pull")
	acts := n["activities"].([]any)
	s.Require().Len(acts, 1)
	modified, err := time.Parse(time.RFC3339, acts[0].(map[string]any)["modified_at"].(string))
	s.Require().NoError(err)
	s.True(modified.Before(time.Now().Add(time.Minute)), "modified_at is the server's time, not the client's: %s", modified)

	checkpoint, err := time.Parse(time.RFC3339, pull["syncedAt"].(string))
	s.Require().NoError(err)
	s.True(checkpoint.After(before) && checkpoint.Before(time.Now().Add(time.Minute)), "syncedAt %s", checkpoint)

	// Nothing new since the checkpoint; a later note shows up after it.
	s.Nil(pulledNote(s.pullAll(tok, space, pull["syncedAt"].(string)), id))
	res := s.mcpTool(tok, "create_note", map[string]any{"spaceId": space, "text": "later"})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	notes := s.pullAll(tok, space, pull["syncedAt"].(string))["notes"].([]any)
	s.Len(notes, 1)

	// A client stuck on a checkpoint from the future gets everything again.
	s.NotNil(pulledNote(s.pullAll(tok, space, future), id))
}

func (s *E2ETestSuite) metricID(tok string, space int, name, valueType string) int {
	res := s.mcpTool(tok, "create_metric", map[string]any{"spaceId": space, "name": name, "valueType": valueType})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	var m struct {
		ID int `json:"id"`
	}
	s.Require().NoError(json.Unmarshal([]byte(blockText(res, 0)), &m))
	s.Require().NotZero(m.ID, blockText(res, 0))
	return m.ID
}

// /sync refuses a metric value that is not {"data": <value of the metric's type>}.
func (s *E2ETestSuite) Test352_SyncChecksMetricValues() {
	tok, _ := s.newUser("metricshape")
	space := s.createSpace(tok, "Shapes")
	weight := s.metricID(tok, space, "Weight", "float")
	now := time.Now().UTC().Format(time.RFC3339)
	push := func(value any) map[string]any {
		code, data := s.pushAs(tok, map[string]any{"notes": []any{map[string]any{
			"clientId": uuid.NewString(), "space_id": space, "text": "weighed", "tags": []string{}, "created_at": now, "modified_at": now,
			"activities": []any{map[string]any{"type_id": weight, "value": value, "created_at": now, "modified_at": now}},
		}}})
		s.Require().Equal(http.StatusOK, code, data)
		return data
	}
	for _, bad := range []any{5, map[string]any{"data": "heavy"}, map[string]any{"value": 5}, map[string]any{"data": 5, "x": 1}} {
		data := push(bad)
		rejected, _ := data["rejected"].([]any)
		s.Require().Len(rejected, 1, "value %v", bad)
		s.Equal("invalid_value", rejected[0].(map[string]any)["reason"])
	}
	push(map[string]any{"data": 72.5})

	res := s.mcpTool(tok, "get_metric_history", map[string]any{"spaceId": space, "metric": "Weight"})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	s.Contains(blockText(res, 0), "72.5")
	res = s.mcpTool(tok, "list_metrics", map[string]any{"spaceId": space})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
}

// Note tools take noteId as well as id; notes no longer carry storage links.
func (s *E2ETestSuite) Test353_NoteIdAliasAndNoStorageLinks() {
	tok, _ := s.newUser("alias")
	space := s.createSpace(tok, "Alias")
	res := s.mcpTool(tok, "create_note", map[string]any{"spaceId": space, "text": "hello",
		"files": []any{map[string]any{"fileName": "a.txt", "text": "hi"}}})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	var created struct {
		ID int `json:"id"`
	}
	s.Require().NoError(json.Unmarshal([]byte(blockText(res, 0)), &created))

	got := s.mcpTool(tok, "get_note", map[string]any{"noteId": created.ID})
	s.Require().Equal(false, got["isError"], blockText(got, 0))
	s.Contains(blockText(got, 0), "a.txt")
	s.NotContains(blockText(got, 0), "X-Amz")
	s.NotContains(blockText(got, 0), `"url"`)
	bad := s.mcpTool(tok, "get_note", map[string]any{"id": created.ID, "noteId": created.ID + 1})
	s.Equal(true, bad["isError"])
	none := s.mcpTool(tok, "get_note", map[string]any{})
	s.Equal(true, none["isError"])
	upd := s.mcpTool(tok, "update_note", map[string]any{"noteId": created.ID, "text": "hello again"})
	s.Require().Equal(false, upd["isError"], blockText(upd, 0))
	list := s.mcpTool(tok, "list_notes", map[string]any{"spaceId": space})
	s.NotContains(blockText(list, 0), "X-Amz")
}
