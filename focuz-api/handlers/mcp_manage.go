package handlers

// MCP tools that organise: spaces, folders, files and the trash. They run on the same functions as
// the REST handlers (manage_api.go), so the same role rules apply.

import (
	"encoding/json"
	"sort"
	"strings"

	"focuz-api/models"

	"github.com/gin-gonic/gin"
)

// WithManagement gives the handler the space and folder functions the REST handlers use.
func (h *NotesAPIHandler) WithManagement(spaces *SpacesHandler, sharing *SharingHandler, folders *FiltersHandler) *NotesAPIHandler {
	h.spaceAdmin, h.sharing, h.folders = spaces, sharing, folders
	return h
}

var (
	folderSorts = []string{"date,DESC", "date,ASC", "createdat,DESC", "createdat,ASC", "modifiedat,DESC", "modifiedat,ASC"}
	// The web app's folder look (focuz-web/src/lib/folder-look.ts); unknown values show the default.
	folderIcons = []string{"folder", "star", "heart", "bookmark", "flag", "label", "idea", "done", "work", "home", "school",
		"people", "chat", "mail", "docs", "archive", "shopping", "money", "health", "place", "photo", "games", "cafe", "nature"}
	folderColors = []string{"red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "gray"}
)

// folderRule is the rule of a folder as the web app stores it in params (focuz-web/src/lib/folders.ts).
type folderRule struct {
	Tags        []string `json:"tags"`
	ExcludeTags []string `json:"excludeTags"`
	Text        string   `json:"text"`
	Metrics     []string `json:"metrics"`
	Sort        string   `json:"sort"`
}

type folderArgs struct {
	SpaceID  int         `json:"spaceId"`
	ID       int         `json:"id"`
	Name     *string     `json:"name"`
	ParentID optInt      `json:"parentId"`
	Rule     *folderRule `json:"rule"`
	Icon     *string     `json:"icon"`
	Color    *string     `json:"color"`
}

func cleanList(list []string) []string {
	out := []string{}
	for _, s := range list {
		if s = strings.TrimPrefix(strings.TrimSpace(s), "#"); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// applyFolderArgs writes the rule and the look into params, keeping every other key (tree order,
// links the web app keeps).
func applyFolderArgs(params map[string]any, a folderArgs) error {
	set := func(key string, v any, empty bool) {
		if empty {
			delete(params, key)
		} else {
			params[key] = v
		}
	}
	if r := a.Rule; r != nil {
		if r.Sort != "" && !contains(folderSorts, r.Sort) {
			return invalidInput("rule.sort must be one of " + strings.Join(folderSorts, ", "))
		}
		tags, excl, metrics := cleanList(r.Tags), cleanList(r.ExcludeTags), cleanList(r.Metrics)
		params["includeTags"] = tags
		params["excludeTags"] = excl
		set("textContains", strings.TrimSpace(r.Text), strings.TrimSpace(r.Text) == "")
		set("includeActivities", metrics, len(metrics) == 0)
		set("sort", r.Sort, r.Sort == "")
		delete(params, "notReply")
		delete(params, "hasOpenTasks")
	}
	if a.Icon != nil {
		if *a.Icon != "" && !contains(folderIcons, *a.Icon) {
			return invalidInput("icon must be one of " + strings.Join(folderIcons, ", "))
		}
		set("icon", *a.Icon, *a.Icon == "")
	}
	if a.Color != nil {
		if *a.Color != "" && !contains(folderColors, *a.Color) {
			return invalidInput("color must be one of " + strings.Join(folderColors, ", "))
		}
		set("color", *a.Color, *a.Color == "")
	}
	return nil
}

// folderParent: in tools 0 and null both mean the top level.
func folderParent(o optInt) optInt {
	if o.Value != nil && *o.Value == 0 {
		return optInt{Set: true}
	}
	return o
}

func (h *NotesAPIHandler) myFolders(userID, spaceID int) ([]*models.Filter, error) {
	list, _, err := h.filters.List(spaceID, userID, 1, 1000)
	return list, err
}

func (h *NotesAPIHandler) createFolder(userID int, a folderArgs) (*models.Filter, error) {
	if a.Name == nil {
		return nil, invalidInput("name is required")
	}
	params := map[string]any{"includeTags": []string{}, "excludeTags": []string{}}
	if err := applyFolderArgs(params, a); err != nil {
		return nil, err
	}
	parent := folderParent(a.ParentID).Value
	// After its siblings, the way the web app places a new folder.
	siblings, err := h.myFolders(userID, a.SpaceID)
	if err != nil {
		return nil, err
	}
	order := 0.0
	for _, f := range siblings {
		if (f.ParentID == nil) != (parent == nil) || (parent != nil && *f.ParentID != *parent) {
			continue
		}
		var p struct {
			Order float64 `json:"_order"`
		}
		_ = json.Unmarshal(f.Params, &p)
		if p.Order > order {
			order = p.Order
		}
	}
	params["_order"] = order + 10
	raw, _ := json.Marshal(params)
	return h.folders.createFolder(userID, a.SpaceID, *a.Name, parent, raw)
}

func (h *NotesAPIHandler) updateFolder(userID int, a folderArgs) (*models.Filter, error) {
	f, err := h.folders.ownFolder(userID, a.ID)
	if err != nil {
		return nil, err
	}
	edit := folderEdit{Name: a.Name, ParentID: folderParent(a.ParentID)}
	if a.Rule != nil || a.Icon != nil || a.Color != nil {
		params := map[string]any{}
		_ = json.Unmarshal(f.Params, &params)
		if params == nil {
			params = map[string]any{}
		}
		if err := applyFolderArgs(params, a); err != nil {
			return nil, err
		}
		raw, _ := json.Marshal(params)
		msg := json.RawMessage(raw)
		edit.Params = &msg
	}
	if edit.Name == nil && edit.Params == nil && !edit.ParentID.Set {
		return nil, invalidInput("Nothing to change: send name, parentId, rule, icon or color")
	}
	return h.folders.updateFolder(userID, a.ID, edit)
}

// deleteFolder deletes a folder; its subfolders go too, or move up to its parent, as in the web app.
func (h *NotesAPIHandler) deleteFolder(userID, id int, withSubfolders bool) (gin.H, error) {
	f, err := h.folders.ownFolder(userID, id)
	if err != nil {
		return nil, err
	}
	all, err := h.myFolders(userID, f.SpaceID)
	if err != nil {
		return nil, err
	}
	children := map[int][]int{}
	for _, x := range all {
		if x.ParentID != nil {
			children[*x.ParentID] = append(children[*x.ParentID], x.ID)
		}
	}
	deleted, moved := []int{id}, []int{}
	if withSubfolders {
		for i := 0; i < len(deleted); i++ {
			deleted = append(deleted, children[deleted[i]]...)
		}
	} else {
		for _, ch := range children[id] {
			if _, err := h.folders.updateFolder(userID, ch, folderEdit{ParentID: optInt{Set: true, Value: f.ParentID}}); err != nil {
				return nil, err
			}
			moved = append(moved, ch)
		}
	}
	for _, d := range deleted {
		if err := h.folders.setFolderDeleted(userID, d, true); err != nil {
			return nil, err
		}
	}
	sort.Ints(deleted[1:])
	return gin.H{"deleted": deleted, "movedUp": moved, "note": "Notes are not deleted: a folder only shows notes. restore_folder brings a folder back."}, nil
}

var (
	folderIDSchema   = map[string]any{"type": "integer", "description": "Folder id (describe_space lists them)"}
	folderRuleSchema = objectSchema(map[string]any{
		"tags":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Notes must have all these tags. Reserved: open-tasks (an unticked checklist item), tasks-in-progress, closed-tasks, replies"},
		"excludeTags": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Notes must have none of these tags"},
		"text":        map[string]any{"type": "string", "description": "Notes must contain this text"},
		"metrics":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Notes must have values of these metrics (names)"},
		"sort":        map[string]any{"type": "string", "enum": folderSorts},
	})
	folderLookSchema = map[string]any{
		"icon":  map[string]any{"type": "string", "enum": folderIcons},
		"color": map[string]any{"type": "string", "enum": folderColors},
	}
)

func init() {
	spaceArg := func(a json.RawMessage) (int, error) {
		var v struct {
			SpaceID int `json:"spaceId"`
		}
		err := decodeArgs(a, &v)
		return v.SpaceID, err
	}
	withLook := func(props map[string]any) map[string]any {
		for k, v := range folderLookSchema {
			props[k] = v
		}
		return props
	}
	mcpTools = append(mcpTools,
		mcpTool{
			Name:        "create_space",
			Description: "Create a space you own, for a separate area of notes (work, a trip, a shared project). Others can be invited from the app.",
			Schema:      objectSchema(map[string]any{"name": map[string]any{"type": "string", "description": "1 to 100 characters"}}, "name"),
			Write:       true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				var a struct {
					Name string `json:"name"`
				}
				if err := decodeArgs(raw, &a); err != nil {
					return nil, err
				}
				return createSpace(h.spaceAdmin.spacesRepo, userID, a.Name, false)
			},
		},
		mcpTool{
			Name:        "rename_space",
			Description: "Rename a space (admins and the owner).",
			Schema:      objectSchema(map[string]any{"spaceId": spaceSchema, "name": map[string]any{"type": "string"}}, "spaceId", "name"),
			Write:       true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				var a struct {
					SpaceID int    `json:"spaceId"`
					Name    string `json:"name"`
				}
				if err := decodeArgs(raw, &a); err != nil {
					return nil, err
				}
				return h.sharing.renameSpace(userID, a.SpaceID, a.Name)
			},
		},
		mcpTool{
			Name: "delete_space",
			Description: "Delete a space you own, with all its notes, for every member; the members are notified. " +
				"The personal space can't be deleted. restore_space brings it back. Ask the user before deleting.",
			Schema: objectSchema(map[string]any{"spaceId": spaceSchema}, "spaceId"),
			Write:  true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				id, err := spaceArg(raw)
				if err != nil {
					return nil, err
				}
				if err := h.sharing.deleteSpace(userID, id); err != nil {
					return nil, err
				}
				return gin.H{"deleted": true, "spaceId": id}, nil
			},
		},
		mcpTool{
			Name:        "restore_space",
			Description: "Bring back a space you deleted (owner).",
			Schema:      objectSchema(map[string]any{"spaceId": spaceSchema}, "spaceId"),
			Write:       true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				id, err := spaceArg(raw)
				if err != nil {
					return nil, err
				}
				if err := restoreSpace(h.spaceAdmin.spacesRepo, userID, id); err != nil {
					return nil, err
				}
				return gin.H{"restored": true, "spaceId": id}, nil
			},
		},
		mcpTool{
			Name: "create_folder",
			Description: "Create a folder in a space. Folders are yours only (other members don't see them). A folder holds no notes: it " +
				"shows the notes that match its rule, plus what its subfolders show. A rule of tags only is a classic folder: to put a note " +
				"in it, give the note those tags (update_note). Without a rule it only groups subfolders. Optional icon and color.",
			Schema: objectSchema(withLook(map[string]any{
				"spaceId":  spaceSchema,
				"name":     map[string]any{"type": "string"},
				"parentId": map[string]any{"type": "integer", "description": "Folder to put it in; leave out for the top level"},
				"rule":     folderRuleSchema,
			}), "spaceId", "name"),
			Write: true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				var a folderArgs
				if err := decodeArgs(raw, &a); err != nil {
					return nil, err
				}
				return h.createFolder(userID, a)
			},
		},
		mcpTool{
			Name: "update_folder",
			Description: "Change a folder: name, rule (replaces the whole rule), icon, color, or move it with parentId (0 = top level). " +
				"Only what you send changes.",
			Schema: objectSchema(withLook(map[string]any{
				"id":       folderIDSchema,
				"name":     map[string]any{"type": "string"},
				"parentId": map[string]any{"type": "integer", "description": "New parent folder, 0 for the top level"},
				"rule":     folderRuleSchema,
			}), "id"),
			Write: true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				var a folderArgs
				if err := decodeArgs(raw, &a); err != nil {
					return nil, err
				}
				return h.updateFolder(userID, a)
			},
		},
		mcpTool{
			Name: "delete_folder",
			Description: "Delete a folder. Its notes stay. Subfolders move up to its parent, or go too with withSubfolders. " +
				"restore_folder brings a folder back.",
			Schema: objectSchema(map[string]any{
				"id":             folderIDSchema,
				"withSubfolders": map[string]any{"type": "boolean"},
			}, "id"),
			Write: true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				var a struct {
					ID             int  `json:"id"`
					WithSubfolders bool `json:"withSubfolders"`
				}
				if err := decodeArgs(raw, &a); err != nil {
					return nil, err
				}
				return h.deleteFolder(userID, a.ID, a.WithSubfolders)
			},
		},
		mcpTool{
			Name:        "restore_folder",
			Description: "Bring back a deleted folder by its id.",
			Schema:      objectSchema(map[string]any{"id": folderIDSchema}, "id"),
			Write:       true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				var a struct {
					ID int `json:"id"`
				}
				if err := decodeArgs(raw, &a); err != nil {
					return nil, err
				}
				if err := h.folders.setFolderDeleted(userID, a.ID, false); err != nil {
					return nil, err
				}
				return gin.H{"restored": true, "id": a.ID}, nil
			},
		},
		mcpTool{
			Name:        "delete_file",
			Description: "Remove a picture or file from its note for good (editors and above). The note stays.",
			Schema:      objectSchema(map[string]any{"attachmentId": map[string]any{"type": "string"}}, "attachmentId"),
			Write:       true,
			run: func(h *NotesAPIHandler, userID int, raw json.RawMessage) (any, error) {
				var a struct {
					AttachmentID string `json:"attachmentId"`
				}
				if err := decodeArgs(raw, &a); err != nil {
					return nil, err
				}
				att, err := h.files.remove(userID, a.AttachmentID)
				if err != nil {
					return nil, err
				}
				return gin.H{"deleted": true, "attachmentId": att.ID, "noteId": att.NoteID, "fileName": att.FileName}, nil
			},
		},
	)
}
