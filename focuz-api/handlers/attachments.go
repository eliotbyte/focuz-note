package handlers

import (
	"context"
	"focuz-api/initializers"
	"focuz-api/pkg/access"
	"focuz-api/pkg/imagegeom"
	"focuz-api/repository"
	"focuz-api/types"
	"image"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"mime/multipart"

	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	_ "golang.org/x/image/webp"
)

// checkPictureSize reads the picture's dimensions from its header and applies the note picture rules.
func checkPictureSize(file *multipart.FileHeader) error {
	f, err := file.Open()
	if err != nil {
		return err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return &clientError{status: http.StatusBadRequest, code: types.ErrorCodeValidation, message: "The picture could not be read"}
	}
	if err := imagegeom.Check(cfg.Width, cfg.Height); err != nil {
		return &clientError{status: http.StatusBadRequest, code: types.ErrorCodeValidation, message: "The picture is not accepted: " + err.Error()}
	}
	return nil
}

type AttachmentsHandler struct {
	attachmentsRepo *repository.AttachmentsRepository
	notesRepo       *repository.NotesRepository
	spacesRepo      *repository.SpacesRepository
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

	note, err := h.notesRepo.GetNoteByID(noteID)
	if err != nil || note == nil || note.IsDeleted {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, "invalid note"))
		return
	}

	roleID, err := h.spacesRepo.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}
	if !access.CanEditNote(roleID) {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "no access"))
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

	// Detect real MIME type from file content, not from client header
	sniff, openErr := file.Open()
	if openErr != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "cannot open uploaded file"))
		return
	}
	mt, detectErr := mimetype.DetectReader(sniff)
	_ = sniff.Close()
	if detectErr != nil || mt == nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "failed to detect file type"))
		return
	}
	detectedCT := initializers.Conf.FileTypes[0]
	// use base MIME from detection
	detectedCT = strings.Split(mt.String(), ";")[0]

	// Validate against server-side policy
	if err := initializers.CheckFileAllowed(file.Size, detectedCT); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	if detectedCT == "image/webp" {
		if err := checkPictureSize(file); err != nil {
			respondAPIError(c, err)
			return
		}
	}

	// Upload file to MinIO using detected content type
	attachmentID, err := h.uploadFileToMinIO(file, noteID, clientIDPtr, detectedCT, position)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.InternalError(c, err))
		return
	}

	// Note: note.modified_at is intentionally not touched here. GET /sync already returns notes whose
	// attachments changed, and bumping the note version would make the uploading client's next
	// edit of that note look like a concurrent change (sync conflict).

	c.JSON(http.StatusCreated, types.NewSuccessResponse(map[string]interface{}{
		"attachment_id": attachmentID,
		"filename":      file.Filename,
		"size":          file.Size,
	}))
}

func (h *AttachmentsHandler) uploadFileToMinIO(file *multipart.FileHeader, noteID int, clientID *string, contentType string, position *int) (string, error) {
	// Create attachment record with server-detected content type
	attachmentID, err := h.attachmentsRepo.CreateOrGetAttachment(noteID, clientID, file.Filename, contentType, file.Size, position)
	if err != nil {
		return "", err
	}

	// Open the file (fresh reader after detection)
	src, err := file.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()

	// Upload to MinIO
	_, err = initializers.MinioClient.PutObject(
		context.Background(),
		initializers.Conf.Bucket,
		attachmentID,
		src,
		file.Size,
		minio.PutObjectOptions{
			ContentType: contentType,
		},
	)
	if err != nil {
		return "", err
	}

	return attachmentID, nil
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
