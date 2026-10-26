package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

// A note moves to another thread or out of one (REST, MCP and sync), never into its own replies.
func (s *E2ETestSuite) Test341_MoveNoteBetweenThreads() {
	ownerTok, _ := s.newUser("mover")
	space := s.createSpace(ownerTok, "Threads")
	guestTok := s.join(ownerTok, space, "moveguest", "guest")
	note := func(text string, parent *int) int {
		body := map[string]any{"spaceId": space, "text": text, "date": time.Now().Format(time.RFC3339)}
		if parent != nil {
			body["parentId"] = *parent
		}
		code, out := s.call("POST", "/notes", ownerTok, body)
		s.Require().Equal(http.StatusCreated, code, out)
		return int(out["data"].(map[string]any)["id"].(float64))
	}
	type shown struct {
		parent  *int
		replies int
	}
	get := func(id int) shown {
		code, out := s.call("GET", "/notes/"+strconv.Itoa(id), ownerTok, nil)
		s.Require().Equal(http.StatusOK, code, out)
		d := out["data"].(map[string]any)
		var sh shown
		if p, ok := d["parent"].(map[string]any); ok {
			v := int(p["id"].(float64))
			sh.parent = &v
		}
		sh.replies = int(d["replyCount"].(float64))
		return sh
	}
	patch := func(token string, id int, parent any) (int, map[string]any) {
		return s.call("PATCH", "/notes/"+strconv.Itoa(id), token, map[string]any{"parentId": parent})
	}

	a := note("thread A", nil)
	b := note("thread B", nil)
	reply := note("reply", &a)
	deep := note("reply to the reply", &reply)
	s.Equal(1, get(a).replies, "replyCount counts direct replies")

	// REST: move to B; the reply's own replies come along.
	code, out := patch(ownerTok, reply, b)
	s.Require().Equal(http.StatusOK, code, out)
	s.Equal(b, *get(reply).parent)
	s.Equal(reply, *get(deep).parent)
	s.Equal(0, get(a).replies)
	s.Equal(1, get(b).replies)

	// Not into itself or its own replies; not to a note in the trash or in another space.
	code, out = patch(ownerTok, reply, reply)
	s.Equal(http.StatusBadRequest, code, out)
	code, out = patch(ownerTok, reply, deep)
	s.Equal(http.StatusBadRequest, code, out)
	trashed := note("trashed", nil)
	code, _ = s.call("PATCH", "/notes/"+strconv.Itoa(trashed)+"/delete", ownerTok, nil)
	s.Require().Equal(http.StatusOK, code)
	code, _ = patch(ownerTok, reply, trashed)
	s.Equal(http.StatusBadRequest, code)
	otherSpace := s.createSpace(ownerTok, "Elsewhere")
	code, out = s.call("POST", "/notes", ownerTok, map[string]any{"spaceId": otherSpace, "text": "foreign", "date": time.Now().Format(time.RFC3339)})
	s.Require().Equal(http.StatusCreated, code)
	foreign := int(out["data"].(map[string]any)["id"].(float64))
	code, _ = patch(ownerTok, reply, foreign)
	s.Equal(http.StatusBadRequest, code)
	s.Equal(b, *get(reply).parent, "a refused move leaves the note where it was")

	// A guest reads only.
	code, _ = patch(guestTok, reply, nil)
	s.Equal(http.StatusForbidden, code)

	// REST: null detaches.
	code, out = patch(ownerTok, reply, nil)
	s.Require().Equal(http.StatusOK, code, out)
	s.Nil(get(reply).parent)

	// MCP: parentId moves, 0 detaches, a loop is an error.
	res := s.mcpTool(ownerTok, "update_note", map[string]any{"id": reply, "parentId": a})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	var moved struct {
		Parent *struct {
			ID int `json:"id"`
		} `json:"parent"`
	}
	s.Require().NoError(json.Unmarshal([]byte(blockText(res, 0)), &moved))
	s.Require().NotNil(moved.Parent)
	s.Equal(a, moved.Parent.ID)
	res = s.mcpTool(ownerTok, "update_note", map[string]any{"id": a, "parentId": deep})
	s.Equal(true, res["isError"])
	s.Contains(blockText(res, 0), "one of its replies")
	res = s.mcpTool(ownerTok, "update_note", map[string]any{"id": reply, "parentId": 0})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	s.Nil(get(reply).parent)
	res = s.mcpTool(guestTok, "update_note", map[string]any{"id": reply, "parentId": a})
	s.Equal(true, res["isError"])

	// Sync: a loop keeps the parent the note has; a normal move applies.
	push := func(id int, parent int) {
		ch := noteChange(&id, space, "reply")
		ch["parent_id"] = parent
		code, _ := s.pushAs(ownerTok, map[string]any{"notes": []any{ch}})
		s.Require().Equal(http.StatusOK, code)
	}
	push(reply, b)
	s.Equal(b, *get(reply).parent)
	push(reply, deep)
	s.Equal(b, *get(reply).parent, "sync must not close a loop")
}
