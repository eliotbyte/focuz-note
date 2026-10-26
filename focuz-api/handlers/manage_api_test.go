package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
)

// An agent organises: spaces, folders, the trash and files, with the roles of the web app.

func (s *E2ETestSuite) Test340_AgentOrganises() {
	ownerTok, _ := s.newUser("organiser")
	editorTok, _ := s.newUser("orgeditor")
	ok := func(res map[string]any) string {
		s.Require().Equal(false, res["isError"], blockText(res, 0))
		return blockText(res, 0)
	}
	fail := func(res map[string]any, contains string) {
		s.Equal(true, res["isError"], blockText(res, 0))
		s.Contains(blockText(res, 0), contains)
	}
	idOf := func(text string) int {
		var v struct {
			ID int `json:"id"`
		}
		s.Require().NoError(json.Unmarshal([]byte(text), &v))
		return v.ID
	}

	// Spaces: create, rename, delete with a member notified, restore.
	space := idOf(ok(s.mcpTool(ownerTok, "create_space", map[string]any{"name": "Trip"})))
	sp := strconv.Itoa(space)
	code, _ := s.call("POST", "/spaces/"+sp+"/invitations", ownerTok, map[string]any{"identifier": s.usernameOf(editorTok), "role": "editor"})
	s.Require().Equal(http.StatusOK, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/invitations/accept", editorTok, nil)
	s.Require().Equal(http.StatusOK, code)
	ok(s.mcpTool(ownerTok, "rename_space", map[string]any{"spaceId": space, "name": "Trip 2027"}))
	fail(s.mcpTool(editorTok, "rename_space", map[string]any{"spaceId": space, "name": "Mine"}), "Only admins")
	fail(s.mcpTool(editorTok, "delete_space", map[string]any{"spaceId": space}), "Only the owner")
	fail(s.mcpTool(ownerTok, "create_space", map[string]any{"name": "  "}), "1 to 100")

	// Folders: a classic folder with a subfolder; cycles refused; delete lifts the subfolder.
	work := idOf(ok(s.mcpTool(ownerTok, "create_folder", map[string]any{
		"spaceId": space, "name": "Tickets", "rule": map[string]any{"tags": []string{"tickets"}}, "icon": "flag", "color": "blue",
	})))
	sub := idOf(ok(s.mcpTool(ownerTok, "create_folder", map[string]any{
		"spaceId": space, "name": "Trains", "parentId": work, "rule": map[string]any{"tags": []string{"tickets", "train"}, "sort": "date,ASC"},
	})))
	fail(s.mcpTool(ownerTok, "update_folder", map[string]any{"id": work, "parentId": sub}), "Parent filter")
	fail(s.mcpTool(editorTok, "update_folder", map[string]any{"id": work, "name": "x"}), "No access")
	out := ok(s.mcpTool(ownerTok, "update_folder", map[string]any{"id": sub, "name": "Rail"}))
	s.Contains(out, `"parentId": `+strconv.Itoa(work)) // renaming keeps the place
	s.Contains(out, `train`)

	// REST: a PATCH without parentId keeps the place too; null moves to the top level.
	code, _ = s.call("PATCH", "/filters/"+strconv.Itoa(sub), ownerTok, map[string]any{"name": "Rail 2"})
	s.Equal(http.StatusOK, code)
	out = ok(s.mcpTool(ownerTok, "describe_space", map[string]any{"spaceId": space}))
	s.Contains(out, `"parentId": `+strconv.Itoa(work))

	out = ok(s.mcpTool(ownerTok, "delete_folder", map[string]any{"id": work}))
	s.Contains(out, `"movedUp": [`)
	out = ok(s.mcpTool(ownerTok, "describe_space", map[string]any{"spaceId": space}))
	s.Contains(out, `"Rail 2"`)
	s.NotContains(out, `"Tickets"`)
	s.Contains(out, `"parentId": null`)
	ok(s.mcpTool(ownerTok, "restore_folder", map[string]any{"id": work}))

	// Trash: a deleted note is listed there and comes back.
	var note struct {
		ID          int `json:"id"`
		Attachments []struct {
			ID string `json:"id"`
		} `json:"attachments"`
	}
	s.Require().NoError(json.Unmarshal([]byte(ok(s.mcpTool(editorTok, "create_note", map[string]any{
		"spaceId": space, "text": "Train to Vienna", "tags": []string{"tickets", "train"},
		"files": []any{map[string]any{"fileName": "ticket.png", "base64": base64.StdEncoding.EncodeToString(testPNG(500))}},
	}))), &note))
	ok(s.mcpTool(editorTok, "delete_note", map[string]any{"id": note.ID}))
	s.Contains(ok(s.mcpTool(ownerTok, "list_notes", map[string]any{"spaceId": space, "inTrash": true})), "Train to Vienna")
	s.NotContains(ok(s.mcpTool(ownerTok, "list_notes", map[string]any{"spaceId": space})), "Train to Vienna")
	ok(s.mcpTool(editorTok, "restore_note", map[string]any{"id": note.ID}))

	// Files: an editor removes one; it is gone from the note and from REST.
	s.Require().Len(note.Attachments, 1)
	att := note.Attachments[0].ID
	ok(s.mcpTool(editorTok, "delete_file", map[string]any{"attachmentId": att}))
	s.NotContains(ok(s.mcpTool(ownerTok, "get_note", map[string]any{"id": note.ID})), att)
	fail(s.mcpTool(ownerTok, "get_file", map[string]any{"attachmentId": att}), "not found")
	code, _ = s.call("DELETE", "/files/"+att, ownerTok, nil)
	s.Equal(http.StatusNotFound, code)

	// Deleting the space hides it for the member; the owner brings it back.
	ok(s.mcpTool(ownerTok, "delete_space", map[string]any{"spaceId": space}))
	fail(s.mcpTool(editorTok, "list_notes", map[string]any{"spaceId": space}), "No access")
	ok(s.mcpTool(ownerTok, "restore_space", map[string]any{"spaceId": space}))
	ok(s.mcpTool(editorTok, "list_notes", map[string]any{"spaceId": space}))
	code, notes := s.call("GET", "/notifications", editorTok, nil)
	s.Equal(http.StatusOK, code)
	b, _ := json.Marshal(notes)
	s.Contains(string(b), "space_deleted")
}
