package handlers

// MCP endpoint (Streamable HTTP, JSON responses only). An agent such as Claude connects to POST /mcp
// with a personal API token (Authorization: Bearer fct_...). The tools call the same functions as the
// REST API, so the same role rules apply to people and to agents.

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"focuz-api/models"
	"focuz-api/pkg/access"

	"github.com/gin-gonic/gin"
)

const (
	mcpProtocolVersion = "2025-06-18"
	mcpServerVersion   = "0.1.10"
	maxMCPBodyBytes    = 1 << 20
	mcpInstructions    = "Focuz notes. Call list_spaces first to get a spaceId. " +
		"Dates are RFC 3339 timestamps, for example 2026-10-24T12:00:00Z."
)

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpTool struct {
	Name        string
	Description string
	Schema      map[string]any
	Write       bool
	run         func(h *NotesAPIHandler, userID int, args json.RawMessage) (any, error)
}

// POST /mcp
func (h *NotesAPIHandler) MCP(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxMCPBodyBytes))
	if err != nil {
		c.JSON(http.StatusBadRequest, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: -32700, Message: "Could not read the request"}})
		return
	}
	if trimmed := bytes.TrimSpace(body); len(trimmed) > 0 && trimmed[0] == '[' {
		c.JSON(http.StatusBadRequest, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: -32600, Message: "Batch requests are not supported"}})
		return
	}
	var req rpcRequest
	if err := json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusBadRequest, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: -32700, Message: "Parse error"}})
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		c.JSON(http.StatusBadRequest, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: -32600, Message: "Invalid request"}})
		return
	}
	// A message without an id is a notification (for example notifications/initialized): no answer.
	if len(req.ID) == 0 {
		c.Status(http.StatusAccepted)
		return
	}
	result, rpcErr := h.dispatch(c.GetInt("userId"), c.GetString(scopeKey), req)
	c.JSON(http.StatusOK, rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result, Error: rpcErr})
}

func (h *NotesAPIHandler) dispatch(userID int, scope string, req rpcRequest) (any, *rpcError) {
	switch req.Method {
	case "initialize":
		return gin.H{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    gin.H{"tools": gin.H{}},
			"serverInfo":      gin.H{"name": "focuz", "version": mcpServerVersion},
			"instructions":    mcpInstructions,
		}, nil
	case "ping":
		return gin.H{}, nil
	case "tools/list":
		list := make([]gin.H, 0, len(mcpTools))
		for _, t := range mcpTools {
			list = append(list, gin.H{"name": t.Name, "description": t.Description, "inputSchema": t.Schema})
		}
		return gin.H{"tools": list}, nil
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Name == "" {
			return nil, &rpcError{Code: -32602, Message: "Invalid params"}
		}
		tool, ok := mcpToolByName(p.Name)
		if !ok {
			return nil, &rpcError{Code: -32602, Message: "Unknown tool: " + p.Name}
		}
		text, isError := h.runTool(userID, scope, tool, p.Arguments)
		return gin.H{"content": []gin.H{{"type": "text", "text": text}}, "isError": isError}, nil
	}
	return nil, &rpcError{Code: -32601, Message: "Method not found"}
}

// runTool returns the text the agent sees and whether it is an error the agent should react to.
func (h *NotesAPIHandler) runTool(userID int, scope string, tool mcpTool, args json.RawMessage) (string, bool) {
	if tool.Write && scope == "read" {
		return "This token is read-only", true
	}
	out, err := tool.run(h, userID, args)
	if err != nil {
		var ce *clientError
		if errors.As(err, &ce) {
			return ce.message, true
		}
		slog.Error("mcp tool failed", "tool", tool.Name, "error", err)
		return "Something went wrong, try again", true
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), false
}

func mcpToolByName(name string) (mcpTool, bool) {
	for _, t := range mcpTools {
		if t.Name == name {
			return t, true
		}
	}
	return mcpTool{}, false
}

// decodeArgs reads tool arguments; missing arguments count as an empty object.
func decodeArgs(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return invalidInput("Invalid arguments: " + err.Error())
	}
	return nil
}

func parseDay(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, invalidInput("Dates for filters are YYYY-MM-DD")
	}
	return &t, nil
}

func objectSchema(props map[string]any, required ...string) map[string]any {
	s := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

var (
	idSchema    = map[string]any{"type": "integer", "description": "Note id"}
	spaceSchema = map[string]any{"type": "integer", "description": "Space id from list_spaces"}
	textSchema  = map[string]any{"type": "string", "description": "Note text (Markdown)"}
	tagsSchema  = map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Tags without #"}
	dateSchema  = map[string]any{"type": "string", "format": "date-time", "description": "Note date, RFC 3339. Defaults to the creation time."}
)

var mcpTools = []mcpTool{
	{
		Name:        "list_spaces",
		Description: "List the spaces you can use, with your role in each (owner, admin, editor or guest).",
		Schema:      objectSchema(map[string]any{}),
		run: func(h *NotesAPIHandler, userID int, _ json.RawMessage) (any, error) {
			spaces, err := h.spaces.GetSpacesForUser(userID)
			if err != nil {
				return nil, err
			}
			out := make([]gin.H, 0, len(spaces))
			for _, s := range spaces {
				roleID, err := h.spaces.GetUserRoleIDInSpace(userID, s.ID)
				if err != nil {
					return nil, err
				}
				out = append(out, gin.H{"id": s.ID, "name": s.Name, "role": access.Name(roleID)})
			}
			return out, nil
		},
	},
	{
		Name:        "list_notes",
		Description: "List notes in a space, newest created first by default. Use page and pageSize (max 100) to go on.",
		Schema: objectSchema(map[string]any{
			"spaceId":  spaceSchema,
			"page":     map[string]any{"type": "integer", "minimum": 1},
			"pageSize": map[string]any{"type": "integer", "minimum": 1, "maximum": 100},
			"tags":     tagsSchema,
			"notReply": map[string]any{"type": "boolean", "description": "Only notes that are not replies"},
			"dateFrom": map[string]any{"type": "string", "description": "YYYY-MM-DD"},
			"dateTo":   map[string]any{"type": "string", "description": "YYYY-MM-DD"},
			"sortBy":   map[string]any{"type": "string", "enum": []string{"createdAt", "modifiedAt"}},
			"order":    map[string]any{"type": "string", "enum": []string{"ASC", "DESC"}},
		}, "spaceId"),
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				SpaceID  int      `json:"spaceId"`
				Page     int      `json:"page"`
				PageSize int      `json:"pageSize"`
				Tags     []string `json:"tags"`
				NotReply bool     `json:"notReply"`
				DateFrom string   `json:"dateFrom"`
				DateTo   string   `json:"dateTo"`
				SortBy   string   `json:"sortBy"`
				Order    string   `json:"order"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			roleID, err := h.spaces.GetUserRoleIDInSpace(userID, a.SpaceID)
			if err != nil {
				return nil, err
			}
			if roleID == 0 {
				return nil, errForbidden("No access to the space")
			}
			dateFrom, err := parseDay(a.DateFrom)
			if err != nil {
				return nil, err
			}
			dateTo, err := parseDay(a.DateTo)
			if err != nil {
				return nil, err
			}
			if a.Page < 1 {
				a.Page = 1
			}
			if a.PageSize < 1 || a.PageSize > 100 {
				a.PageSize = 20
			}
			sortField := "created_at"
			if a.SortBy == "modifiedAt" {
				sortField = "modified_at"
			}
			order := "DESC"
			if a.Order == "ASC" {
				order = "ASC"
			}
			notes, total, err := h.notes.GetNotes(userID, a.SpaceID, models.NoteFilters{
				Tags: a.Tags, NotReply: a.NotReply, Page: a.Page, PageSize: a.PageSize,
				SortField: sortField, SortOrder: order, DateFrom: dateFrom, DateTo: dateTo,
			})
			if err != nil {
				return nil, err
			}
			return gin.H{"notes": notes, "total": total, "page": a.Page, "pageSize": a.PageSize}, nil
		},
	},
	{
		Name:        "get_note",
		Description: "Get one note with its tags, replies count and attachments.",
		Schema:      objectSchema(map[string]any{"id": idSchema}, "id"),
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				ID int `json:"id"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			note, _, err := h.loadNote(userID, a.ID)
			return note, err
		},
	},
	{
		Name:        "create_note",
		Description: "Create a note in a space where you are an editor or admin. For a reply, set parentId to a note in the same space.",
		Schema: objectSchema(map[string]any{
			"spaceId":  spaceSchema,
			"text":     textSchema,
			"tags":     tagsSchema,
			"date":     dateSchema,
			"parentId": map[string]any{"type": "integer", "description": "Note this one replies to"},
		}, "spaceId", "text"),
		Write: true,
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a noteCreate
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			return h.createNote(userID, a)
		},
	},
	{
		Name:        "update_note",
		Description: "Change a note's text, tags or date. Only the fields you send change.",
		Schema: objectSchema(map[string]any{
			"id":   idSchema,
			"text": textSchema,
			"tags": tagsSchema,
			"date": dateSchema,
		}, "id"),
		Write: true,
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				ID int `json:"id"`
				noteEdit
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			return h.editNote(userID, a.ID, a.noteEdit)
		},
	},
	{
		Name:        "delete_note",
		Description: "Move a note to the trash. Editors can delete only their own notes; admins and owners can delete any.",
		Schema:      objectSchema(map[string]any{"id": idSchema}, "id"),
		Write:       true,
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				ID int `json:"id"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			if err := h.deleteNote(userID, a.ID); err != nil {
				return nil, err
			}
			return gin.H{"deleted": true, "id": a.ID}, nil
		},
	},
}
