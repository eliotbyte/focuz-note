package handlers

import (
	"encoding/json"
	"strings"
	"testing"
)

// These tests need no database: they cover the protocol surface and the checks that run before a tool
// touches the repositories.

func TestMCPInitializeAndToolList(t *testing.T) {
	h := &NotesAPIHandler{}

	res, rpcErr := h.dispatch(1, "write", rpcRequest{Method: "initialize"})
	if rpcErr != nil {
		t.Fatalf("initialize failed: %+v", rpcErr)
	}
	b, _ := json.Marshal(res)
	if !strings.Contains(string(b), mcpProtocolVersion) || !strings.Contains(string(b), `"tools"`) {
		t.Fatalf("initialize result misses protocol version or tools capability: %s", b)
	}

	res, rpcErr = h.dispatch(1, "write", rpcRequest{Method: "tools/list"})
	if rpcErr != nil {
		t.Fatalf("tools/list failed: %+v", rpcErr)
	}
	b, _ = json.Marshal(res)
	for _, name := range []string{"list_spaces", "list_notes", "get_note", "create_note", "update_note", "delete_note"} {
		if !strings.Contains(string(b), `"`+name+`"`) {
			t.Errorf("tools/list is missing %s", name)
		}
	}
}

func TestMCPUnknownMethodAndTool(t *testing.T) {
	h := &NotesAPIHandler{}
	if _, err := h.dispatch(1, "write", rpcRequest{Method: "resources/list"}); err == nil || err.Code != -32601 {
		t.Fatalf("unknown method should be -32601, got %+v", err)
	}
	params := json.RawMessage(`{"name":"drop_everything","arguments":{}}`)
	if _, err := h.dispatch(1, "write", rpcRequest{Method: "tools/call", Params: params}); err == nil || err.Code != -32602 {
		t.Fatalf("unknown tool should be -32602, got %+v", err)
	}
}

func TestReadOnlyTokenCannotCallWriteTools(t *testing.T) {
	h := &NotesAPIHandler{}
	for _, name := range []string{"create_note", "update_note", "delete_note"} {
		tool, ok := mcpToolByName(name)
		if !ok {
			t.Fatalf("%s is not defined", name)
		}
		if !tool.Write {
			t.Fatalf("%s must be marked as a write tool", name)
		}
		text, isError := h.runTool(1, "read", tool, nil)
		if !isError || text != "This token is read-only" {
			t.Fatalf("%s with a read token: got %q, isError=%v", name, text, isError)
		}
	}
}

func TestMCPArgumentErrorsAreClientErrors(t *testing.T) {
	var a struct {
		ID int `json:"id"`
	}
	err := decodeArgs(json.RawMessage(`{"id":"not a number"}`), &a)
	if err == nil {
		t.Fatal("a string id must be rejected")
	}
	if err := decodeArgs(nil, &a); err != nil {
		t.Fatalf("missing arguments should be an empty object, got %v", err)
	}
	if _, err := parseDay("24.10.2026"); err == nil {
		t.Fatal("filter dates must be YYYY-MM-DD")
	}
	if d, err := parseDay("2026-10-24"); err != nil || d == nil {
		t.Fatalf("valid filter date rejected: %v", err)
	}
}
