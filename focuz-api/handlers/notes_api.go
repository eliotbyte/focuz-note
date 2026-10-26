package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"focuz-api/models"
	"focuz-api/pkg/access"
	"focuz-api/pkg/authtoken"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
)

// clientError is a failure the caller can see (wrong input, no access). Any other error is internal:
// it is logged and the client gets a generic message.
type clientError struct {
	status  int
	code    string
	message string
}

func (e *clientError) Error() string { return e.message }

func invalidInput(message string) error {
	return &clientError{status: http.StatusBadRequest, code: types.ErrorCodeValidation, message: message}
}

func errForbidden(message string) error {
	return &clientError{status: http.StatusForbidden, code: types.ErrorCodeForbidden, message: message}
}

func notFoundNote() error {
	return &clientError{status: http.StatusNotFound, code: types.ErrorCodeNotFound, message: "Note not found"}
}

// noteEdit is what the REST API and the MCP tools may change. A nil field is left as it is.
type noteEdit struct {
	Text *string    `json:"text"`
	Tags *[]string  `json:"tags"`
	Date *time.Time `json:"date"`
}

type noteCreate struct {
	SpaceID  int        `json:"spaceId"`
	Text     string     `json:"text"`
	Tags     []string   `json:"tags"`
	Date     *time.Time `json:"date"`
	ParentID *int       `json:"parentId"`
	// withFiles: files come with the note, so it may have no text (a picture alone), as in the app.
	withFiles bool
}

// NotesAPIHandler serves note edits for REST (PATCH /notes/:id) and the MCP endpoint (POST /mcp).
// Both use the same functions, so the same role rules apply to people and to agents.
type NotesAPIHandler struct {
	notes  *repository.NotesRepository
	spaces *repository.SpacesRepository
	sync   *repository.SyncRepository

	activities    *repository.ActivitiesRepository
	activityTypes *repository.ActivityTypesRepository
	filters       *repository.FiltersRepository

	files     fileAccess
	tokens    *authtoken.Tokens
	publicURL string

	spaceAdmin *SpacesHandler
	sharing    *SharingHandler
	folders    *FiltersHandler
}

func NewNotesAPIHandler(notes *repository.NotesRepository, spaces *repository.SpacesRepository, sync *repository.SyncRepository) *NotesAPIHandler {
	return &NotesAPIHandler{notes: notes, spaces: spaces, sync: sync}
}

// loadNote returns a live note and the caller's role in its space.
func (h *NotesAPIHandler) loadNote(userID, noteID int) (*models.Note, int, error) {
	note, err := h.notes.GetNoteByID(noteID)
	if err != nil {
		return nil, 0, err
	}
	if note == nil || note.IsDeleted {
		return nil, 0, notFoundNote()
	}
	roleID, err := h.spaces.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		return nil, 0, err
	}
	if roleID == 0 {
		return nil, 0, errForbidden("No access to the space")
	}
	return note, roleID, nil
}

func (h *NotesAPIHandler) editNote(userID, noteID int, edit noteEdit) (*models.Note, error) {
	note, roleID, err := h.loadNote(userID, noteID)
	if err != nil {
		return nil, err
	}
	if !access.CanEditNote(roleID) {
		return nil, errForbidden("You can only read this space")
	}
	if edit.Text == nil && edit.Tags == nil && edit.Date == nil {
		return nil, invalidInput("Nothing to change: send text, tags or date")
	}
	if edit.Text != nil && strings.TrimSpace(*edit.Text) == "" {
		return nil, invalidInput("Text cannot be empty")
	}
	if _, err := h.sync.UpdateNoteByAPI(userID, noteID, note.SpaceID, edit.Text, edit.Tags, edit.Date); err != nil {
		return nil, err
	}
	return h.notes.GetNoteByID(noteID)
}

func (h *NotesAPIHandler) createNote(userID int, req noteCreate) (*models.Note, error) {
	roleID, err := h.spaces.GetUserRoleIDInSpace(userID, req.SpaceID)
	if err != nil {
		return nil, err
	}
	if !access.CanWrite(roleID) {
		return nil, errForbidden("You can only read this space")
	}
	if strings.TrimSpace(req.Text) == "" && !req.withFiles {
		return nil, invalidInput("Text is required")
	}
	if req.ParentID != nil {
		// Replies stay inside the space: a foreign parent would link spaces together.
		parent, err := h.notes.GetNoteByID(*req.ParentID)
		if err != nil {
			return nil, err
		}
		if parent == nil || parent.SpaceID != req.SpaceID {
			return nil, invalidInput("Parent note must be in the same space")
		}
	}
	date := time.Now()
	if req.Date != nil {
		date = *req.Date
	}
	dateStr := date.Format(time.RFC3339)
	return h.notes.CreateNote(userID, req.Text, req.Tags, req.ParentID, &dateStr, req.SpaceID)
}

func (h *NotesAPIHandler) deleteNote(userID, noteID int) error {
	note, roleID, err := h.loadNote(userID, noteID)
	if err != nil {
		return err
	}
	if !access.CanDeleteNote(roleID, note.UserID, userID) {
		return errForbidden("You can delete only your own notes here")
	}
	return h.notes.UpdateNoteDeleted(noteID, true)
}

// respondAPIError sends a client error as-is and everything else as a generic 500.
func respondAPIError(c *gin.Context, err error) {
	var ce *clientError
	if errors.As(err, &ce) {
		c.JSON(ce.status, types.NewErrorResponse(ce.code, ce.message))
		return
	}
	c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
}

// PATCH /notes/:id { text?, tags?, date? }
func (h *NotesAPIHandler) UpdateNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid ID"))
		return
	}
	var edit noteEdit
	if err := c.ShouldBindJSON(&edit); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid body: send text, tags or date (RFC 3339)"))
		return
	}
	note, err := h.editNote(c.GetInt("userId"), id, edit)
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(note))
}
