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
	mcpServerVersion   = "0.3.0"
	maxMCPBodyBytes    = 1 << 20
	mcpInstructions    = "Focuz is the user's notes app and long-term memory; the user also reads it themselves. " +
		"Start with list_spaces, then describe_space: it shows the tags, folders and metrics of a space, so you " +
		"know where things are. Find notes with list_notes (query searches the text). " +
		"Metrics are numbers the user tracks over time (weight, spending, sleep). When the user reports one, " +
		"call record_metrics: it saves the value in a dated note and tells you the previous value. " +
		"Read the past with get_metric_history (groupBy for chart data). Create a metric with create_metric " +
		"only when list_metrics has nothing that fits. " +
		"Dates are RFC 3339 timestamps, for example 2026-10-24T12:00:00Z; date filters also take YYYY-MM-DD."
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

	metricRefSchema = map[string]any{"type": []string{"string", "integer"}, "description": "Metric name (any case) or id from list_metrics"}
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
		Name: "list_notes",
		Description: "List or search notes in a space, newest created first by default. query keeps notes whose text " +
			"contains every word (any case). Tags: a note must have all of them; prefix one with ! to exclude it. " +
			"Use page and pageSize (max 100) to go on.",
		Schema: objectSchema(map[string]any{
			"spaceId":  spaceSchema,
			"query":    map[string]any{"type": "string", "description": "Words the text must contain"},
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
				Query    string   `json:"query"`
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
				SortField: sortField, SortOrder: order, DateFrom: dateFrom, DateTo: dateTo, Search: a.Query,
			})
			if err != nil {
				return nil, err
			}
			return gin.H{"notes": notes, "total": total, "page": a.Page, "pageSize": a.PageSize}, nil
		},
	},
	{
		Name:        "get_note",
		Description: "Get one note with its tags, metric values and attachments. includeReplies adds its replies (up to 100, oldest first).",
		Schema: objectSchema(map[string]any{
			"id":             idSchema,
			"includeReplies": map[string]any{"type": "boolean"},
		}, "id"),
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				ID             int  `json:"id"`
				IncludeReplies bool `json:"includeReplies"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			note, _, err := h.loadNote(userID, a.ID)
			if err != nil || !a.IncludeReplies {
				return note, err
			}
			parentID := note.ID
			replies, _, err := h.notes.GetNotes(userID, note.SpaceID, models.NoteFilters{
				ParentID: &parentID, Page: 1, PageSize: 100, SortField: "created_at", SortOrder: "ASC",
			})
			if err != nil {
				return nil, err
			}
			if replies == nil {
				replies = []*models.Note{}
			}
			return gin.H{"note": note, "replies": replies}, nil
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
	{
		Name:        "restore_note",
		Description: "Bring a note back from the trash, with the same rules as delete_note.",
		Schema:      objectSchema(map[string]any{"id": idSchema}, "id"),
		Write:       true,
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				ID int `json:"id"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			if err := h.restoreNote(userID, a.ID); err != nil {
				return nil, err
			}
			return gin.H{"restored": true, "id": a.ID}, nil
		},
	},
	{
		Name: "describe_space",
		Description: "Overview of a space: number of notes and their dates, tags with how many notes use each, " +
			"your folders (saved filters: a rule over tags, text or metrics) and the metrics with their last values.",
		Schema: objectSchema(map[string]any{"spaceId": spaceSchema}, "spaceId"),
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				SpaceID int `json:"spaceId"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			return h.describeSpace(userID, a.SpaceID)
		},
	},
	{
		Name: "list_metrics",
		Description: "List the metrics of a space (built-in ones too): value type, unit, how many values there are, " +
			"the last value and the one before it, each with its note and date.",
		Schema: objectSchema(map[string]any{"spaceId": spaceSchema}, "spaceId"),
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				SpaceID int `json:"spaceId"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			return h.listMetrics(userID, a.SpaceID)
		},
	},
	{
		Name: "create_metric",
		Description: "Create a metric to track, for example Weight in kg or Spending in EUR. Check list_metrics " +
			"first: names are unique in a space, ignoring case. Use the name the user would look for in the app.",
		Schema: objectSchema(map[string]any{
			"spaceId":   spaceSchema,
			"name":      map[string]any{"type": "string", "description": "Short name, for example Weight"},
			"valueType": map[string]any{"type": "string", "enum": metricValueTypes, "description": "float (default) for measurements and money, integer for counts, boolean for yes/no, time for durations, text for words"},
			"unit":      map[string]any{"type": "string", "description": "Unit of a number metric, for example kg, EUR, mmol/L"},
			"aggregation": map[string]any{"type": "string", "description": "How values add up per day/week/month: avg (default for numbers; weight, blood values), " +
				"sum (spending, steps), min, max, count. time: sum (default), avg. boolean: count_true (default), percentage_true. text: count."},
			"minValue": map[string]any{"type": "number", "description": "Lowest value allowed"},
			"maxValue": map[string]any{"type": "number", "description": "Highest value allowed"},
		}, "spaceId", "name"),
		Write: true,
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a metricCreate
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			return h.createMetric(userID, a)
		},
	},
	{
		Name: "record_metrics",
		Description: "Save metric values. Without noteId it creates a note in the space, dated `date` (now by default), " +
			"with your text or, when text is empty, a line like \"Weight: 63 kg\"; the values are attached to it. " +
			"With noteId the values are added to that note (a note holds one value per metric; an existing one is replaced). " +
			"The answer has the note id and, per metric, the previous value with its date and, unless the metric adds up (sum), the change.",
		Schema: objectSchema(map[string]any{
			"spaceId": spaceSchema,
			"noteId":  map[string]any{"type": "integer", "description": "Add the values to this note instead of creating one"},
			"values": map[string]any{
				"type": "array", "minItems": 1,
				"items": objectSchema(map[string]any{
					"metric": metricRefSchema,
					"value":  map[string]any{"type": []string{"number", "string", "boolean"}, "description": "A number in the metric's unit, true/false, text, or a duration like 7h30m"},
				}, "metric", "value"),
			},
			"text": map[string]any{"type": "string", "description": "Note text (Markdown). Optional: write the user's own words if they said more than the number"},
			"tags": tagsSchema,
			"date": map[string]any{"type": "string", "format": "date-time", "description": "When it was measured, RFC 3339. Defaults to now"},
		}, "values"),
		Write: true,
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a metricRecord
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			return h.recordMetrics(userID, a)
		},
	},
	{
		Name: "get_metric_history",
		Description: "Values of one metric with their dates and notes, and stats over the range (count; min, max, avg and sum for numbers). " +
			"Newest first by default; order oldest suits a chart. With groupBy (day, week, month, year) you get one aggregated value per period " +
			"instead of the single values, using the metric's aggregation.",
		Schema: objectSchema(map[string]any{
			"spaceId": spaceSchema,
			"metric":  metricRefSchema,
			"from":    map[string]any{"type": "string", "description": "YYYY-MM-DD or RFC 3339, inclusive"},
			"to":      map[string]any{"type": "string", "description": "YYYY-MM-DD (the whole day counts) or RFC 3339"},
			"limit":   map[string]any{"type": "integer", "minimum": 1, "maximum": maxMetricEntries, "description": "Default 50"},
			"order":   map[string]any{"type": "string", "enum": []string{"newest", "oldest"}},
			"groupBy": map[string]any{"type": "string", "enum": []string{"day", "week", "month", "year"}},
		}, "spaceId", "metric"),
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a metricHistoryQuery
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			return h.metricHistory(userID, a)
		},
	},
	{
		Name:        "remove_metric_value",
		Description: "Remove a metric's value from a note (the note stays). To fix a wrong value, call record_metrics with the noteId instead.",
		Schema: objectSchema(map[string]any{
			"noteId": idSchema,
			"metric": metricRefSchema,
		}, "noteId", "metric"),
		Write: true,
		run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
			var a struct {
				NoteID int       `json:"noteId"`
				Metric metricRef `json:"metric"`
			}
			if err := decodeArgs(raw, &a); err != nil {
				return nil, err
			}
			if err := h.removeMetricValue(userID, a.NoteID, a.Metric); err != nil {
				return nil, err
			}
			return gin.H{"removed": true, "noteId": a.NoteID}, nil
		},
	},
}
