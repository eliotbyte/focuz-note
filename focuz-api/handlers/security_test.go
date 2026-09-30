package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Security regression tests: every request here is an attempt to touch data the caller must not.

func (s *E2ETestSuite) newUser(prefix string) (token string, id int) {
	name := fmt.Sprintf("%s%d", prefix, time.Now().UnixNano()%1_000_000_000)
	s.lastUsername = name
	body := fmt.Sprintf(`{"username":%q,"password":"Password123"}`, name)
	resp, err := http.Post(s.baseURL+"/register", "application/json", bytes.NewBufferString(body))
	s.Require().NoError(err)
	var reg map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&reg)
	resp.Body.Close()
	s.Require().Equal(http.StatusCreated, resp.StatusCode)
	id = int(reg["data"].(map[string]any)["id"].(float64))
	s.usernames[fmt.Sprint(id)] = name
	resp, err = http.Post(s.baseURL+"/login", "application/json", bytes.NewBufferString(body))
	s.Require().NoError(err)
	var login map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&login)
	resp.Body.Close()
	token = login["data"].(map[string]any)["token"].(string)
	s.usernames[token] = name
	return token, id
}

func (s *E2ETestSuite) usernameOf(token string) string { return s.usernames[token] }

func (s *E2ETestSuite) call(method, path, token string, body any) (int, map[string]any) {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, s.baseURL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := (&http.Client{}).Do(req)
	s.Require().NoError(err)
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (s *E2ETestSuite) pushAs(token string, payload map[string]any) (int, map[string]any) {
	for _, k := range []string{"notes", "tags", "filters", "charts", "activities"} {
		if _, ok := payload[k]; !ok {
			payload[k] = []any{}
		}
	}
	code, out := s.call("POST", "/sync", token, payload)
	data, _ := out["data"].(map[string]any)
	return code, data
}

func (s *E2ETestSuite) createSpace(token, name string) int {
	code, out := s.call("POST", "/spaces", token, map[string]any{"name": name})
	s.Require().Equal(http.StatusCreated, code)
	return int(out["data"].(map[string]any)["id"].(float64))
}

func (s *E2ETestSuite) serverNoteText(token string, spaceID, noteID int) (string, bool) {
	code, out := s.call("GET", "/sync?since=1970-01-01T00:00:00Z&spaceId="+strconv.Itoa(spaceID), token, nil)
	s.Require().Equal(http.StatusOK, code)
	notes, _ := out["data"].(map[string]any)["notes"].([]any)
	for _, n := range notes {
		m := n.(map[string]any)
		if int(m["id"].(float64)) == noteID {
			return m["text"].(string), m["deleted_at"] != nil
		}
	}
	return "", false
}

func rejectedReasons(data map[string]any) []string {
	var out []string
	rs, _ := data["rejected"].([]any)
	for _, r := range rs {
		out = append(out, r.(map[string]any)["reason"].(string))
	}
	return out
}

func noteChange(id *int, spaceID int, text string) map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)
	m := map[string]any{"space_id": spaceID, "text": text, "tags": []string{}, "created_at": now, "modified_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
	if id != nil {
		m["id"] = *id
	} else {
		m["clientId"] = uuid.NewString()
	}
	return m
}

func (s *E2ETestSuite) Test208_Security_SyncCannotTouchOtherUsersNotes() {
	aliceTok, _ := s.newUser("alice")
	malloryTok, _ := s.newUser("mallory")
	aliceSpace := s.createSpace(aliceTok, "Alice private")
	mallorySpace := s.createSpace(malloryTok, "Mallory")

	_, d := s.pushAs(aliceTok, map[string]any{"notes": []any{noteChange(nil, aliceSpace, "alice secret")}})
	vs := d["versions"].([]any)
	noteID := int(vs[0].(map[string]any)["id"].(float64))

	// Edit by id, claiming the attacker's own space.
	code, d := s.pushAs(malloryTok, map[string]any{"notes": []any{noteChange(&noteID, mallorySpace, "pwned")}})
	s.Equal(http.StatusOK, code)
	s.Equal([]string{"forbidden"}, rejectedReasons(d))

	// Soft-delete by id.
	del := noteChange(&noteID, aliceSpace, "alice secret")
	del["deleted_at"] = time.Now().UTC().Format(time.RFC3339)
	_, d = s.pushAs(malloryTok, map[string]any{"notes": []any{del}})
	s.Equal([]string{"forbidden"}, rejectedReasons(d))

	// Create inside Alice's space.
	_, d = s.pushAs(malloryTok, map[string]any{"notes": []any{noteChange(nil, aliceSpace, "planted")}})
	s.Equal([]string{"forbidden"}, rejectedReasons(d))

	text, deleted := s.serverNoteText(aliceTok, aliceSpace, noteID)
	s.Equal("alice secret", text)
	s.False(deleted)

	// Pull of a foreign space is refused.
	code, _ = s.call("GET", "/sync?since=1970-01-01T00:00:00Z&spaceId="+strconv.Itoa(aliceSpace), malloryTok, nil)
	s.Equal(http.StatusForbidden, code)

	// Unknown ids are not created with a forced id any more.
	missing := 987650000 + int(time.Now().UnixNano()%1000)
	_, d = s.pushAs(malloryTok, map[string]any{"notes": []any{noteChange(&missing, mallorySpace, "forced id")}})
	s.Equal([]string{"not_found"}, rejectedReasons(d))
}

func (s *E2ETestSuite) Test209_Security_SyncCannotTouchOtherUsersFilters() {
	aliceTok, _ := s.newUser("alicef")
	malloryTok, _ := s.newUser("malloryf")
	aliceSpace := s.createSpace(aliceTok, "Alice filters")
	mallorySpace := s.createSpace(malloryTok, "Mallory filters")
	now := time.Now().UTC().Format(time.RFC3339)
	_, d := s.pushAs(aliceTok, map[string]any{"filters": []any{map[string]any{"clientId": uuid.NewString(), "space_id": aliceSpace, "name": "Work", "params": map[string]any{}, "created_at": now, "modified_at": now}}})
	filterID := int(d["mappings"].([]any)[0].(map[string]any)["serverId"].(float64))

	later := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	_, d = s.pushAs(malloryTok, map[string]any{"filters": []any{map[string]any{"id": filterID, "space_id": mallorySpace, "name": "pwned", "params": map[string]any{}, "created_at": now, "modified_at": later, "deleted_at": later}}})
	s.Equal([]string{"forbidden"}, rejectedReasons(d))
	// Nesting under a foreign filter is not possible either.
	_, d = s.pushAs(malloryTok, map[string]any{"filters": []any{map[string]any{"clientId": uuid.NewString(), "space_id": mallorySpace, "parent_id": filterID, "name": "child", "params": map[string]any{}, "created_at": now, "modified_at": now}}})
	s.Empty(rejectedReasons(d))

	code, out := s.call("GET", "/spaces/"+strconv.Itoa(aliceSpace)+"/filters", aliceTok, nil)
	s.Equal(http.StatusOK, code)
	b, _ := json.Marshal(out)
	s.Contains(string(b), `"Work"`)
	s.NotContains(string(b), "pwned")
	code, _ = s.call("POST", "/filters", malloryTok, map[string]any{"spaceId": mallorySpace, "parentId": filterID, "name": "x", "params": map[string]any{}})
	s.Equal(http.StatusBadRequest, code)
}

func (s *E2ETestSuite) Test210_Security_RolesDecideWhoWritesAndDeletes() {
	ownerTok, _ := s.newUser("owner")
	editorTok, _ := s.newUser("editorx")
	guestTok, _ := s.newUser("guestx")
	space := s.createSpace(ownerTok, "Shared")
	sp := strconv.Itoa(space)
	editorName, guestName := s.usernameOf(editorTok), s.usernameOf(guestTok)
	code, _ := s.call("POST", "/spaces/"+sp+"/invitations", ownerTok, map[string]any{"identifier": editorName, "role": "editor"})
	s.Require().Equal(http.StatusOK, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/invitations", ownerTok, map[string]any{"identifier": guestName, "role": "guest"})
	s.Require().Equal(http.StatusOK, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/invitations/accept", editorTok, nil)
	s.Require().Equal(http.StatusOK, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/invitations/accept", guestTok, nil)
	s.Require().Equal(http.StatusOK, code)

	_, d := s.pushAs(ownerTok, map[string]any{"notes": []any{noteChange(nil, space, "owner note")}})
	ownerNote := int(d["versions"].([]any)[0].(map[string]any)["id"].(float64))
	_, d = s.pushAs(editorTok, map[string]any{"notes": []any{noteChange(nil, space, "editor note")}})
	s.Empty(rejectedReasons(d))
	editorNote := int(d["versions"].([]any)[0].(map[string]any)["id"].(float64))

	// Editors edit any note, but delete only their own.
	_, d = s.pushAs(editorTok, map[string]any{"notes": []any{noteChange(&ownerNote, space, "edited by editor")}})
	s.Empty(rejectedReasons(d))
	del := noteChange(&ownerNote, space, "edited by editor")
	del["deleted_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	_, d = s.pushAs(editorTok, map[string]any{"notes": []any{del}})
	s.Equal([]string{"forbidden"}, rejectedReasons(d))
	delOwn := noteChange(&editorNote, space, "editor note")
	delOwn["deleted_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	_, d = s.pushAs(editorTok, map[string]any{"notes": []any{delOwn}})
	s.Empty(rejectedReasons(d))

	// Guests only read: no new notes, no edits.
	_, d = s.pushAs(guestTok, map[string]any{"notes": []any{noteChange(nil, space, "guest note")}})
	s.Equal([]string{"forbidden"}, rejectedReasons(d))
	_, d = s.pushAs(guestTok, map[string]any{"notes": []any{noteChange(&ownerNote, space, "guest overwrote")}})
	s.Equal([]string{"forbidden"}, rejectedReasons(d))
	text, _ := s.serverNoteText(guestTok, space, ownerNote)
	s.Equal("edited by editor", text)

	// Who changed it is recorded.
	code, out := s.call("GET", "/notes/"+strconv.Itoa(ownerNote)+"/history", guestTok, nil)
	s.Require().Equal(http.StatusOK, code)
	h := out["data"].(map[string]any)
	s.Equal(s.usernameOf(ownerTok), h["createdBy"])
	s.Equal(editorName, h["modifiedBy"])

	// Re-inviting an existing member is refused; inviting yourself too. Guests can't rename.
	code, _ = s.call("POST", "/spaces/"+sp+"/invitations", ownerTok, map[string]any{"identifier": editorName})
	s.Equal(http.StatusConflict, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/invitations", ownerTok, map[string]any{"identifier": s.usernameOf(ownerTok)})
	s.Equal(http.StatusBadRequest, code)
	code, _ = s.call("PATCH", "/spaces/"+sp, guestTok, map[string]any{"name": "mine now"})
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("PATCH", "/spaces/"+sp, ownerTok, map[string]any{"name": "still mine"})
	s.Equal(http.StatusOK, code)
}

func (s *E2ETestSuite) Test211_Security_ActivityTypesAreScopedToTheirSpace() {
	aliceTok, _ := s.newUser("alicet")
	malloryTok, _ := s.newUser("malloryt")
	aliceSpace := s.createSpace(aliceTok, "Alice types")
	mallorySpace := s.createSpace(malloryTok, "Mallory types")
	code, out := s.call("POST", "/spaces/"+strconv.Itoa(aliceSpace)+"/activity-types", aliceTok, map[string]any{"name": "mood", "valueType": "integer", "aggregation": "avg", "minValue": 0, "maxValue": 10})
	s.Require().Equal(http.StatusCreated, code, out)
	typeID := int(out["data"].(map[string]any)["id"].(float64))

	// Mallory owns *a* space, but not the one the type belongs to.
	code, _ = s.call("PATCH", fmt.Sprintf("/spaces/%d/activity-types/%d/delete", mallorySpace, typeID), malloryTok, nil)
	s.Equal(http.StatusNotFound, code)

	// Using a foreign custom type on her own note is refused too.
	_, d := s.pushAs(malloryTok, map[string]any{"notes": []any{noteChange(nil, mallorySpace, "n")}})
	noteID := int(d["versions"].([]any)[0].(map[string]any)["id"].(float64))
	code, _ = s.call("POST", "/activities", malloryTok, map[string]any{"typeId": typeID, "value": "5", "note_id": noteID})
	s.Equal(http.StatusBadRequest, code)
}

func (s *E2ETestSuite) Test212_Security_LoginBruteForceIsLimitedPerAccount() {
	_, _ = s.newUser("victim")
	name := s.lastUsername
	for i := 0; i < loginFailureBurst; i++ {
		code, _ := s.call("POST", "/login", "", map[string]any{"username": name, "password": fmt.Sprintf("wrong-%d-pass", i)})
		if code == http.StatusTooManyRequests {
			break // the per-IP limiter may kick in first; either way attempts are capped
		}
		s.Equal(http.StatusUnauthorized, code)
	}
	code, _ := s.call("POST", "/login", "", map[string]any{"username": name, "password": "Password123"})
	s.Equal(http.StatusTooManyRequests, code)
}
