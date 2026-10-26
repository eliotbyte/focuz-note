package handlers

// Spaces, folders and files for REST and MCP. The REST handlers and the MCP tools call these
// functions, so the role rules live in one place.

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"focuz-api/models"
	"focuz-api/pkg/access"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
)

const maxSpaceNameLen, maxFolderNameLen = 100, 100

func notFoundErr(message string) error {
	return &clientError{status: http.StatusNotFound, code: types.ErrorCodeNotFound, message: message}
}

func cleanName(name string, max int) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > max {
		return "", invalidInput("Name must be 1 to 100 characters")
	}
	return name, nil
}

// optInt tells "not sent" (Set false) from null (Set true, Value nil) in a JSON body.
type optInt struct {
	Set   bool
	Value *int
}

func (o *optInt) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var v int
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

// Spaces ---------------------------------------------------------------------------------------

func createSpace(spaces *repository.SpacesRepository, userID int, name string, personal bool) (*models.Space, error) {
	name, err := cleanName(name, maxSpaceNameLen)
	if err != nil {
		return nil, err
	}
	return spaces.CreateSpace(name, userID, personal)
}

// liveSpace returns the space and the caller's role; not a member and deleted look the same.
func (h *SharingHandler) liveSpace(userID, spaceID int) (*repository.SpaceInfo, int, error) {
	role, err := h.repo.RoleOf(userID, spaceID)
	if err != nil {
		return nil, 0, err
	}
	if role == 0 {
		return nil, 0, notFoundErr("Space not found")
	}
	space, err := h.repo.Space(spaceID)
	if err != nil || space.IsDeleted {
		return nil, 0, notFoundErr("Space not found")
	}
	return space, role, nil
}

func (h *SharingHandler) renameSpace(userID, spaceID int, name string) (gin.H, error) {
	_, role, err := h.liveSpace(userID, spaceID)
	if err != nil {
		return nil, err
	}
	if !access.CanManage(role) {
		return nil, errForbidden("Only admins can rename the space")
	}
	name, err = cleanName(name, maxSpaceNameLen)
	if err != nil {
		return nil, err
	}
	if err := h.repo.RenameSpace(spaceID, name); err != nil {
		return nil, err
	}
	return gin.H{"id": spaceID, "name": name}, nil
}

// deleteSpace hides the space for everyone (it can be restored) and tells the other members.
func (h *SharingHandler) deleteSpace(userID, spaceID int) error {
	space, role, err := h.liveSpace(userID, spaceID)
	if err != nil {
		return err
	}
	if access.Name(role) != access.Owner {
		return errForbidden("Only the owner can delete the space")
	}
	if space.IsPersonal {
		return &clientError{status: http.StatusBadRequest, code: types.ErrorCodeInvalidRequest, message: "Your personal space can't be deleted"}
	}
	members, err := h.repo.Members([]int{space.ID})
	if err != nil {
		return err
	}
	if err := h.repo.DeleteSpace(space.ID); err != nil {
		return err
	}
	actorName := h.username(userID)
	h.async(func() {
		for _, m := range members {
			if m.UserID == userID {
				continue
			}
			h.deliver(notification{userID: m.UserID, kind: "space_deleted", payload: map[string]any{"spaceId": space.ID, "spaceName": space.Name, "actorName": actorName}})
		}
	})
	return nil
}

func restoreSpace(spaces *repository.SpacesRepository, userID, spaceID int) error {
	role, err := spaces.RoleIDInDeletedSpace(userID, spaceID)
	if err != nil {
		return err
	}
	if access.Name(role) != access.Owner {
		return errForbidden("No permission to restore space")
	}
	return spaces.SetSpaceDeleted(spaceID, false)
}

// Folders (saved filters; personal: only their author sees and changes them) -------------------

type folderEdit struct {
	Name     *string          `json:"name"`
	ParentID optInt           `json:"parentId"`
	Params   *json.RawMessage `json:"params"`
}

func checkParams(raw json.RawMessage) error {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return &clientError{status: http.StatusBadRequest, code: types.ErrorCodeInvalidRequest, message: "params must be a JSON object"}
	}
	return nil
}

// ownFolder returns a folder of the user in a space they are still a member of.
func (h *FiltersHandler) ownFolder(userID, id int) (*models.Filter, error) {
	f, err := h.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, notFoundErr("Filter not found")
	}
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, f.SpaceID)
	if err != nil {
		return nil, err
	}
	if roleID == 0 || f.UserID != userID {
		return nil, errForbidden("No access to the space")
	}
	return f, nil
}

// checkParent: a parent must be the user's live folder in the same space, and never the folder
// itself or one inside it.
func (h *FiltersHandler) checkParent(userID int, parentID *int, spaceID, selfID int) error {
	bad := &clientError{status: http.StatusBadRequest, code: types.ErrorCodeInvalidRequest, message: "Parent filter must be another filter in the same space"}
	for id, depth := parentID, 0; id != nil; depth++ {
		if *id == selfID || depth > 100 {
			return bad
		}
		p, err := h.repo.GetByID(*id)
		if err != nil {
			return err
		}
		if p == nil || p.SpaceID != spaceID || p.UserID != userID || (depth == 0 && p.IsDeleted) {
			return bad
		}
		id = p.ParentID
	}
	return nil
}

func (h *FiltersHandler) createFolder(userID, spaceID int, name string, parentID *int, params json.RawMessage) (*models.Filter, error) {
	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, spaceID)
	if err != nil {
		return nil, err
	}
	if roleID == 0 {
		return nil, errForbidden("No access to the space")
	}
	name, err = cleanName(name, maxFolderNameLen)
	if err != nil {
		return nil, err
	}
	if err := checkParams(params); err != nil {
		return nil, err
	}
	if err := h.checkParent(userID, parentID, spaceID, 0); err != nil {
		return nil, err
	}
	return h.repo.CreateFilter(userID, spaceID, name, parentID, params)
}

func (h *FiltersHandler) updateFolder(userID, id int, edit folderEdit) (*models.Filter, error) {
	f, err := h.ownFolder(userID, id)
	if err != nil {
		return nil, err
	}
	if f.IsDeleted {
		return nil, notFoundErr("Filter not found")
	}
	if edit.Name != nil {
		n, err := cleanName(*edit.Name, maxFolderNameLen)
		if err != nil {
			return nil, err
		}
		edit.Name = &n
	}
	if edit.Params != nil {
		if err := checkParams(*edit.Params); err != nil {
			return nil, err
		}
	}
	parent := f.ParentID
	if edit.ParentID.Set {
		if err := h.checkParent(userID, edit.ParentID.Value, f.SpaceID, id); err != nil {
			return nil, err
		}
		parent = edit.ParentID.Value
	}
	if err := h.repo.UpdateFilter(id, edit.Name, parent, edit.Params); err != nil {
		return nil, err
	}
	return h.repo.GetByID(id)
}

func (h *FiltersHandler) setFolderDeleted(userID, id int, deleted bool) error {
	if _, err := h.ownFolder(userID, id); err != nil {
		return err
	}
	return h.repo.SetDeleted(id, deleted)
}

// Files ----------------------------------------------------------------------------------------

// remove deletes a file of a note. The note's modified_at moves, so other devices pull the note and
// drop the file; the stored bytes go after the row.
func (f fileAccess) remove(userID int, attID string) (*repository.Attachment, error) {
	att, err := f.attachments.GetAttachmentByID(strings.TrimSpace(attID))
	if err != nil {
		return nil, err
	}
	if att == nil {
		return nil, &clientError{status: http.StatusNotFound, code: types.ErrorCodeNotFound, message: "attachment not found"}
	}
	if _, err := f.writableNote(userID, att.NoteID); err != nil {
		return nil, err
	}
	if err := f.attachments.DeleteAttachment(att.ID); err != nil {
		return nil, err
	}
	if err := f.notes.TouchNoteModified(att.NoteID); err != nil {
		return nil, err
	}
	if f.removeFiles != nil {
		f.removeFiles([]string{att.ID})
	}
	return att, nil
}
