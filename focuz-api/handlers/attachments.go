package handlers

import (
	"focuz-api/initializers"
	"focuz-api/repository"
	"focuz-api/types"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

type AttachmentsHandler struct {
	attachmentsRepo *repository.AttachmentsRepository
	notesRepo       *repository.NotesRepository
	spacesRepo      *repository.SpacesRepository
	removeFiles     func(ids []string)
}

// WithFileRemover sets what deletes the stored bytes of a removed file.
func (h *AttachmentsHandler) WithFileRemover(fn func(ids []string)) *AttachmentsHandler {
	h.removeFiles = fn
	return h
}

// DELETE /files/:id — removes a file from its note (editors and above).
func (h *AttachmentsHandler) DeleteFile(c *gin.Context) {
	files := fileAccess{attachments: h.attachmentsRepo, notes: h.notesRepo, spaces: h.spacesRepo, removeFiles: h.removeFiles}
	att, err := files.remove(c.GetInt("userId"), c.Param("id"))
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"deleted": true, "id": att.ID, "noteId": att.NoteID}))
}

func NewAttachmentsHandler(a *repository.AttachmentsRepository, n *repository.NotesRepository, s *repository.SpacesRepository) *AttachmentsHandler {
	return &AttachmentsHandler{attachmentsRepo: a, notesRepo: n, spacesRepo: s}
}

func (h *AttachmentsHandler) UploadFile(c *gin.Context) {
	userID := c.GetInt("userId")

	noteIDStr := c.PostForm("note_id")
	if noteIDStr == "" {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "note_id is required"))
		return
	}
	noteID, err := strconv.Atoi(noteIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid note_id"))
		return
	}

	clientID := strings.TrimSpace(c.PostForm("client_id"))
	var clientIDPtr *string
	if clientID != "" {
		if _, err := uuid.Parse(clientID); err != nil {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid client_id"))
			return
		}
		clientIDPtr = &clientID
	}

	var position *int
	if posStr := strings.TrimSpace(c.PostForm("position")); posStr != "" {
		pos, err := strconv.Atoi(posStr)
		if err != nil || pos < 0 {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "invalid position"))
			return
		}
		position = &pos
	}

	files := fileAccess{attachments: h.attachmentsRepo, notes: h.notesRepo, spaces: h.spacesRepo}
	// Note and role first, so nobody without access gets the body read.
	if _, err := files.writableNote(userID, noteID); err != nil {
		respondAPIError(c, err)
		return
	}

	// Limit request body size before reading multipart data
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, initializers.MaxUploadBody())

	file, err := c.FormFile("file")
	if err != nil {
		// If the client sent a body larger than allowed limit, return 413
		if strings.Contains(strings.ToLower(err.Error()), "request body too large") {
			c.JSON(http.StatusRequestEntityTooLarge, types.NewErrorResponse(types.ErrorCodeValidation, "file size exceeds the limit"))
			return
		}
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "file is required"))
		return
	}

	stored, err := files.store(userID, upload{
		NoteID: noteID, Name: file.Filename, Size: file.Size, ClientID: clientIDPtr, Position: position,
		Open: func() (io.ReadCloser, error) { return file.Open() },
	})
	if err != nil {
		respondAPIError(c, err)
		return
	}

	c.JSON(http.StatusCreated, types.NewSuccessResponse(map[string]interface{}{
		"attachment_id": stored.ID,
		"filename":      file.Filename,
		"size":          file.Size,
	}))
}

// authorizedAttachment loads the attachment and checks that the user can access its note.
// It writes the error response and returns nil when access is not possible.
func (h *AttachmentsHandler) authorizedAttachment(c *gin.Context) *repository.Attachment {
	userID := c.GetInt("userId")
	attID := c.Param("id")
	if attID == "" {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "attachment id is required"))
		return nil
	}

	att, err := h.attachmentsRepo.GetAttachmentByID(attID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return nil
	}
	if att == nil {
		c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "attachment not found"))
		return nil
	}

	note, err := h.notesRepo.GetNoteByID(att.NoteID)
	if err != nil || note == nil || note.IsDeleted {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "no access"))
		return nil
	}

	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return nil
	}
	if roleID == 0 {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "no access"))
		return nil
	}
	return att
}

func (h *AttachmentsHandler) GetFile(c *gin.Context) {
	att := h.authorizedAttachment(c)
	if att == nil {
		return
	}

	url, err := initializers.GenerateAttachmentURL(att.ID, att.FileName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, "failed to create presigned url"))
		return
	}

	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{
		"url": url,
	}))
}

// GetFileContent streams the attachment bytes through the API.
// Unlike the presigned URL from GetFile it does not depend on MINIO_EXTERNAL_ENDPOINT being
// reachable from the client (e.g. a phone on the LAN cannot reach "localhost:9000").
func (h *AttachmentsHandler) GetFileContent(c *gin.Context) {
	att := h.authorizedAttachment(c)
	if att == nil {
		return
	}
	serveAttachmentContent(c, att.ID, att.FileType, att.FileName, "private, max-age=31536000, immutable")
}

// attachmentDisposition makes a browser save the file under its own name, never show it.
func attachmentDisposition(fileName string) string {
	name := strings.TrimSpace(fileName)
	if name == "" {
		return "attachment"
	}
	return mime.FormatMediaType("attachment", map[string]string{"filename": name})
}

// serveAttachmentContent streams a stored file. Callers check access first.
func serveAttachmentContent(c *gin.Context, id, fileType, fileName, cacheControl string) {
	obj, err := initializers.MinioClient.GetObject(c.Request.Context(), initializers.Conf.Bucket, id, minio.GetObjectOptions{})
	if err != nil {
		c.JSON(http.StatusBadGateway, types.NewErrorResponse(types.ErrorCodeInternal, "storage unavailable"))
		return
	}
	defer obj.Close()
	info, err := obj.Stat()
	if err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, "file content not found"))
			return
		}
		c.JSON(http.StatusBadGateway, types.NewErrorResponse(types.ErrorCodeInternal, "storage unavailable"))
		return
	}
	contentType := info.ContentType
	if contentType == "" {
		contentType = fileType
	}
	c.Header("Cache-Control", cacheControl)
	// Served from the API origin: never let a browser render uploaded content as a page.
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'")
	if !strings.HasPrefix(contentType, "image/") {
		c.Header("Content-Disposition", attachmentDisposition(fileName))
	}
	c.DataFromReader(http.StatusOK, info.Size, contentType, obj, nil)
}
