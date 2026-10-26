package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// No database: inline file content and names.

func TestFileInBytes(t *testing.T) {
	text, b64 := "# Plan", base64.StdEncoding.EncodeToString([]byte("hello"))
	data, err := fileIn{FileName: "plan.md", Text: &text}.bytes()
	if err != nil || string(data) != "# Plan" {
		t.Fatalf("text: %q %v", data, err)
	}
	dataURL := "data:text/plain;base64," + b64
	data, err = fileIn{FileName: "a.txt", Base64: &dataURL}.bytes()
	if err != nil || string(data) != "hello" {
		t.Fatalf("data URL: %q %v", data, err)
	}
	bad := "not base64!"
	for _, in := range []fileIn{
		{FileName: "a.txt"},
		{FileName: "", Text: &text},
		{FileName: "a.txt", Text: &text, Base64: &b64},
		{FileName: "a.bin", Base64: &bad},
	} {
		if _, err := in.bytes(); err == nil {
			t.Errorf("want an error for %+v", in)
		}
	}
}

func TestCleanFileName(t *testing.T) {
	for in, want := range map[string]string{
		"../../etc/passwd":  "passwd",
		`C:\Users\me\a.png`: "a.png",
		"plan\x00.md":       "plan.md",
		"  ":                "file",
		"..":                "..",
	} {
		if got := cleanFileName(in); got != want {
			t.Errorf("cleanFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMCPFileToolsGuarded(t *testing.T) {
	h := &NotesAPIHandler{}
	for _, name := range []string{"attach_files", "get_upload_link"} {
		tool, ok := mcpToolByName(name)
		if !ok {
			t.Fatalf("%s is not listed", name)
		}
		if text, isErr := h.runTool(1, "read", tool, nil); !isErr || !strings.Contains(text, "read-only") {
			t.Errorf("%s with a read token: %q", name, text)
		}
	}
	if tool, _ := mcpToolByName("get_file"); tool.Write {
		t.Error("get_file only reads")
	}
}

// With the database: an agent attaches, uploads and reads files through /mcp and file links.

func (s *E2ETestSuite) mcpTool(token, name string, args map[string]any) map[string]any {
	code, out := s.call("POST", "/mcp", token, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]any{"name": name, "arguments": args},
	})
	s.Require().Equal(http.StatusOK, code, out)
	return out["result"].(map[string]any)
}

func jsonUnmarshal(s string, v any) error { return json.Unmarshal([]byte(s), v) }

func blockText(res map[string]any, i int) string {
	blocks := res["content"].([]any)
	if i >= len(blocks) {
		return ""
	}
	t, _ := blocks[i].(map[string]any)["text"].(string)
	return t
}

func (s *E2ETestSuite) postFile(url, fieldName, fileName string, data []byte) (int, string) {
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	part, _ := w.CreateFormFile(fieldName, fileName)
	_, _ = part.Write(data)
	_ = w.Close()
	req, _ := http.NewRequest("POST", url, body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	s.Require().NoError(err)
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func (s *E2ETestSuite) Test330_AgentFiles() {
	ownerTok, _ := s.newUser("filer")
	guestTok, _ := s.newUser("fileguest")
	space := s.createSpace(ownerTok, "Files")
	sp := strconv.Itoa(space)
	code, _ := s.call("POST", "/spaces/"+sp+"/invitations", ownerTok, map[string]any{"identifier": s.usernameOf(guestTok), "role": "guest"})
	s.Require().Equal(http.StatusOK, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/invitations/accept", guestTok, nil)
	s.Require().Equal(http.StatusOK, code)

	// A note with a Markdown file written by the agent.
	res := s.mcpTool(ownerTok, "create_note", map[string]any{
		"spaceId": space, "text": "Trip",
		"files": []any{map[string]any{"fileName": "plan.md", "text": "# План\n- билеты"}},
	})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	s.Contains(blockText(res, 0), `"fileName": "plan.md"`)
	var note struct {
		ID          int `json:"id"`
		Attachments []struct {
			ID string `json:"id"`
		} `json:"attachments"`
	}
	s.Require().NoError(jsonUnmarshal(blockText(res, 0), &note))
	s.Require().Len(note.Attachments, 1)
	mdID := note.Attachments[0].ID

	// A picture inline as base64; one too small is refused with the reason.
	res = s.mcpTool(ownerTok, "attach_files", map[string]any{"noteId": note.ID, "files": []any{
		map[string]any{"fileName": "photo.png", "base64": base64.StdEncoding.EncodeToString(testPNG(600))},
	}})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	s.Contains(blockText(res, 0), `"fileType": "image/png"`)
	s.Contains(blockText(res, 0), `"picture": true`)
	res = s.mcpTool(ownerTok, "attach_files", map[string]any{"noteId": note.ID, "files": []any{
		map[string]any{"fileName": "icon.png", "base64": base64.StdEncoding.EncodeToString(testPNG(100))},
	}})
	s.Equal(true, res["isError"])
	s.Contains(blockText(res, 0), "short side")

	// Reading: Markdown as text, the picture as an image; the guest may read.
	res = s.mcpTool(guestTok, "get_file", map[string]any{"attachmentId": mdID})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	s.Contains(blockText(res, 1), "# План")
	var meta struct {
		DownloadURL string `json:"downloadUrl"`
	}
	s.Require().NoError(jsonUnmarshal(blockText(res, 0), &meta))

	resp, err := http.Get(meta.DownloadURL)
	s.Require().NoError(err)
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
	s.Equal("# План\n- билеты", string(b))
	s.Contains(resp.Header.Get("Content-Disposition"), "attachment")

	// A download link does not upload, and a login token is not a link.
	token := meta.DownloadURL[strings.LastIndex(meta.DownloadURL, "/")+1:]
	code, _ = s.postFile(s.baseURL+"/links/upload/"+token, "file", "x.txt", []byte("x"))
	s.Equal(http.StatusUnauthorized, code)
	code, _, _ = s.raw("GET", "/links/file/"+ownerTok, "", nil, "")
	s.Equal(http.StatusUnauthorized, code)

	// Upload from disk through a link, as curl -F would.
	res = s.mcpTool(ownerTok, "get_upload_link", map[string]any{"noteId": note.ID})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	var link struct {
		URL string `json:"url"`
	}
	s.Require().NoError(jsonUnmarshal(blockText(res, 0), &link))
	code, out := s.postFile(link.URL, "file", "scan.png", testPNG(700))
	s.Equal(http.StatusCreated, code, out)
	code, out = s.postFile(link.URL, "file", "page.gif", []byte("GIF89a\x01\x00\x01\x00\x80\x00\x00"))
	s.Equal(http.StatusBadRequest, code, out)

	res = s.mcpTool(ownerTok, "get_note", map[string]any{"id": note.ID})
	s.Require().NoError(jsonUnmarshal(blockText(res, 0), &note))
	s.Len(note.Attachments, 3)
	res = s.mcpTool(ownerTok, "get_file", map[string]any{"attachmentId": note.Attachments[2].ID})
	s.Require().Equal(false, res["isError"], blockText(res, 0))
	img := res["content"].([]any)[1].(map[string]any)
	s.Equal("image", img["type"])
	s.Equal("image/png", img["mimeType"])

	// A guest can't upload, and a read-only API token gets no upload link.
	res = s.mcpTool(guestTok, "get_upload_link", map[string]any{"noteId": note.ID})
	s.Equal(true, res["isError"])
	code, tokOut := s.call("POST", "/me/api-tokens", ownerTok, map[string]any{"name": "reader", "scope": "read"})
	s.Require().Equal(http.StatusCreated, code)
	readTok := tokOut["data"].(map[string]any)["token"].(string)
	res = s.mcpTool(readTok, "get_upload_link", map[string]any{"noteId": note.ID})
	s.Equal(true, res["isError"])
	s.Contains(blockText(res, 0), "read-only")
	res = s.mcpTool(readTok, "get_file", map[string]any{"attachmentId": mdID})
	s.Equal(false, res["isError"], blockText(res, 0))
}

func TestApplyFolderArgs(t *testing.T) {
	params := map[string]any{"_order": 30.0, "includeTags": []string{"old"}, "notReply": true, "icon": "star"}
	empty, green := "", "green"
	err := applyFolderArgs(params, folderArgs{Rule: &folderRule{Tags: []string{"#work", " "}, Text: " plan ", Sort: "date,DESC"}, Icon: &empty, Color: &green})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(params)
	want := `{"_order":30,"color":"green","excludeTags":[],"includeTags":["work"],"sort":"date,DESC","textContains":"plan"}`
	if string(b) != want {
		t.Fatalf("params:\n got %s\nwant %s", b, want)
	}
	bad := "unicorn"
	if applyFolderArgs(map[string]any{}, folderArgs{Icon: &bad}) == nil || applyFolderArgs(map[string]any{}, folderArgs{Rule: &folderRule{Sort: "name"}}) == nil {
		t.Error("unknown icon or sort must be refused")
	}
	zero := 0
	if p := folderParent(optInt{Set: true, Value: &zero}); !p.Set || p.Value != nil {
		t.Errorf("parentId 0 means the top level: %+v", p)
	}
}
