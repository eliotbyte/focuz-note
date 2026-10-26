package handlers

// Files of notes for the REST upload, MCP and file links. One store function checks the note, the
// role and the content (type by content, size, picture geometry), so a file is held to the same rules
// whoever sends it.
//
// An agent has three ways in: text it writes (Markdown, CSV) and small files as base64 inside the
// MCP call, or, for anything on its disk, a signed upload link it posts to with curl. It reads
// pictures as images in the tool result, text files as text, and gets a download link for the rest.

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"focuz-api/initializers"
	"focuz-api/models"
	"focuz-api/pkg/access"
	"focuz-api/pkg/authtoken"
	"focuz-api/pkg/imagegeom"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	_ "golang.org/x/image/webp"
)

const (
	// Pictures up to this size come back to the agent as an image it can look at.
	maxInlinePicture = 4 << 20
	// Text files up to this size come back as text; longer ones are cut there.
	maxInlineText  = 256 << 10
	maxFileNameLen = 200
)

type fileAccess struct {
	attachments *repository.AttachmentsRepository
	notes       *repository.NotesRepository
	spaces      *repository.SpacesRepository
	// removeFiles deletes stored bytes of removed attachments (nil: the startup sweep does it).
	removeFiles func(ids []string)
}

type upload struct {
	NoteID   int
	Name     string
	Size     int64
	Open     func() (io.ReadCloser, error)
	ClientID *string
	Position *int
}

type storedFile struct {
	ID      string `json:"attachmentId"`
	NoteID  int    `json:"noteId"`
	Name    string `json:"fileName"`
	Type    string `json:"fileType"`
	Size    int64  `json:"size"`
	Picture bool   `json:"picture"`
}

// writableNote returns a live note the user may edit.
func (f fileAccess) writableNote(userID, noteID int) (*models.Note, error) {
	note, err := f.notes.GetNoteByID(noteID)
	if err != nil {
		return nil, err
	}
	if note == nil || note.IsDeleted {
		return nil, &clientError{status: http.StatusBadRequest, code: types.ErrorCodeInvalidRequest, message: "invalid note"}
	}
	roleID, err := f.spaces.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		return nil, err
	}
	if !access.CanEditNote(roleID) {
		return nil, errForbidden("no access")
	}
	return note, nil
}

// readable returns an attachment of a live note in a space the user is a member of.
func (f fileAccess) readable(userID int, attID string) (*repository.Attachment, error) {
	att, err := f.attachments.GetAttachmentByID(strings.TrimSpace(attID))
	if err != nil {
		return nil, err
	}
	if att == nil {
		return nil, &clientError{status: http.StatusNotFound, code: types.ErrorCodeNotFound, message: "attachment not found"}
	}
	note, err := f.notes.GetNoteByID(att.NoteID)
	if err != nil {
		return nil, err
	}
	if note == nil || note.IsDeleted {
		return nil, errForbidden("no access")
	}
	roleID, err := f.spaces.GetUserRoleIDInSpace(userID, note.SpaceID)
	if err != nil {
		return nil, err
	}
	if roleID == 0 {
		return nil, errForbidden("no access")
	}
	return att, nil
}

// cleanFileName keeps the last path element without control characters.
func cleanFileName(name string) string {
	name = path.Base(strings.ReplaceAll(strings.TrimSpace(name), "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	if name == "." || name == "/" || name == "" {
		name = "file"
	}
	if utf8.RuneCountInString(name) > maxFileNameLen {
		name = string([]rune(name)[:maxFileNameLen])
	}
	return name
}

// checkPicture reads a picture's dimensions from its header and applies the note picture rules.
func checkPicture(r io.Reader) error {
	cfg, _, err := image.DecodeConfig(r)
	if err != nil {
		return invalidInput("The picture could not be read")
	}
	if err := imagegeom.Check(cfg.Width, cfg.Height); err != nil {
		return invalidInput("The picture is not accepted: " + err.Error())
	}
	return nil
}

// checkContent applies the upload policy to a file: type by content (never by name), size, and the
// picture rules. It returns the content type and whether the file is a picture.
func checkContent(u upload) (string, bool, error) {
	src, err := u.Open()
	if err != nil {
		return "", false, invalidInput("cannot open uploaded file")
	}
	mt, err := mimetype.DetectReader(src)
	_ = src.Close()
	if err != nil || mt == nil {
		return "", false, invalidInput("failed to detect file type")
	}
	contentType := strings.Split(mt.String(), ";")[0]
	if err := initializers.CheckFileAllowed(u.Size, contentType); err != nil {
		return "", false, invalidInput(err.Error())
	}
	picture := strings.HasPrefix(contentType, "image/")
	if picture {
		src, err := u.Open()
		if err != nil {
			return "", false, invalidInput("cannot open uploaded file")
		}
		err = checkPicture(src)
		_ = src.Close()
		if err != nil {
			return "", false, err
		}
	}
	return contentType, picture, nil
}

// store checks and saves a file in a note.
func (f fileAccess) store(userID int, u upload) (*storedFile, error) {
	if _, err := f.writableNote(userID, u.NoteID); err != nil {
		return nil, err
	}
	contentType, picture, err := checkContent(u)
	if err != nil {
		return nil, err
	}
	name := cleanFileName(u.Name)
	id, err := f.attachments.CreateOrGetAttachment(u.NoteID, u.ClientID, name, contentType, u.Size, u.Position)
	if err != nil {
		return nil, err
	}
	src, err := u.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()
	// note.modified_at stays as it is: /sync returns notes whose attachments changed, and bumping the
	// note would make the uploading client's next edit look like a concurrent change.
	if _, err := initializers.MinioClient.PutObject(context.Background(), initializers.Conf.Bucket, id, src, u.Size,
		minio.PutObjectOptions{ContentType: contentType}); err != nil {
		return nil, err
	}
	return &storedFile{ID: id, NoteID: u.NoteID, Name: name, Type: contentType, Size: u.Size, Picture: picture}, nil
}

func bytesUpload(noteID int, name string, data []byte) upload {
	return upload{NoteID: noteID, Name: name, Size: int64(len(data)), Open: func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(data)), nil
	}}
}

func readObject(id string, limit int64) ([]byte, error) {
	obj, err := initializers.MinioClient.GetObject(context.Background(), initializers.Conf.Bucket, id, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer obj.Close()
	return io.ReadAll(io.LimitReader(obj, limit))
}

// MCP --------------------------------------------------------------------------------------------

// WithFiles gives the handler what files and file links need. publicURL is where agents reach the
// API (PUBLIC_API_URL); empty means the address the MCP request came to.
func (h *NotesAPIHandler) WithFiles(attachments *repository.AttachmentsRepository, removeFiles func([]string), tokens *authtoken.Tokens, publicURL string) *NotesAPIHandler {
	h.files = fileAccess{attachments: attachments, notes: h.notes, spaces: h.spaces, removeFiles: removeFiles}
	h.tokens = tokens
	h.publicURL = strings.TrimRight(publicURL, "/")
	return h
}

// mcpCtx is what a tool may need beyond its arguments.
type mcpCtx struct {
	UserID  int
	BaseURL string
}

func requestBaseURL(c *gin.Context, configured string) string {
	if configured != "" {
		return configured
	}
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host
}

type fileIn struct {
	FileName string  `json:"fileName"`
	Text     *string `json:"text"`
	Base64   *string `json:"base64"`
}

func (in fileIn) bytes() ([]byte, error) {
	if strings.TrimSpace(in.FileName) == "" {
		return nil, invalidInput("fileName is required, with its extension (report.md, photo.jpg)")
	}
	switch {
	case in.Text != nil && in.Base64 != nil:
		return nil, invalidInput("Send text or base64, not both")
	case in.Text != nil:
		if *in.Text == "" {
			return nil, invalidInput("text is empty")
		}
		return []byte(*in.Text), nil
	case in.Base64 != nil:
		raw := strings.TrimSpace(*in.Base64)
		if i := strings.Index(raw, ";base64,"); strings.HasPrefix(raw, "data:") && i > 0 {
			raw = raw[i+len(";base64,"):]
		}
		data, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, invalidInput("base64 is not valid standard Base64")
		}
		if len(data) == 0 {
			return nil, invalidInput("base64 is empty")
		}
		return data, nil
	}
	return nil, invalidInput("Send the content as text (for text files) or base64; for a file on disk use get_upload_link")
}

func (h *NotesAPIHandler) attachFiles(userID, noteID int, files []fileIn) ([]*storedFile, error) {
	// Decode everything first, so a bad file stops the call before anything is saved.
	datas := make([][]byte, len(files))
	for i, in := range files {
		data, err := in.bytes()
		if err != nil {
			return nil, err
		}
		datas[i] = data
	}
	out := make([]*storedFile, 0, len(files))
	for i, in := range files {
		sf, err := h.files.store(userID, bytesUpload(noteID, in.FileName, datas[i]))
		if err != nil {
			if ce, ok := err.(*clientError); ok {
				return out, &clientError{status: ce.status, code: ce.code, message: cleanFileName(in.FileName) + ": " + ce.message}
			}
			return out, err
		}
		out = append(out, sf)
	}
	return out, nil
}

func (h *NotesAPIHandler) uploadLink(ctx mcpCtx, noteID int) (gin.H, error) {
	if _, err := h.files.writableNote(ctx.UserID, noteID); err != nil {
		return nil, err
	}
	token, exp, err := h.tokens.IssueFileLink(ctx.UserID, authtoken.FileLinkUpload, strconv.Itoa(noteID))
	if err != nil {
		return nil, err
	}
	url := ctx.BaseURL + "/links/upload/" + token
	return gin.H{
		"url":       url,
		"expiresAt": exp.UTC().Format(time.RFC3339),
		"curl":      fmt.Sprintf("curl -sS -F \"file=@/path/to/photo.jpg\" '%s'", url),
		"howTo": "POST multipart/form-data with the file in the field \"file\", one file per request; the link takes " +
			"any number of files for this note until it expires. No Authorization header. " + uploadLimitsText(),
	}, nil
}

func uploadLimitsText() string {
	return fmt.Sprintf("Pictures (JPEG, PNG, WebP) up to %d MB, at least %d px on the short side; documents (PDF, Word, Excel, "+
		"PowerPoint, OpenDocument, RTF, text, Markdown, CSV) up to %d MB.",
		initializers.Conf.MaxSize>>20, imagegeom.MinShortSide, initializers.Conf.MaxDocumentSize>>20)
}

func isTextType(ct string) bool {
	return ct == "text/plain" || ct == "text/csv" || ct == "text/markdown"
}

// getFile returns MCP content blocks: a picture as an image, a text file as text, and for the rest a
// download link.
func (h *NotesAPIHandler) getFile(ctx mcpCtx, attID string) (mcpBlocks, error) {
	att, err := h.files.readable(ctx.UserID, attID)
	if err != nil {
		return nil, err
	}
	token, exp, err := h.tokens.IssueFileLink(ctx.UserID, authtoken.FileLinkDownload, att.ID)
	if err != nil {
		return nil, err
	}
	meta := gin.H{
		"attachmentId": att.ID, "noteId": att.NoteID, "fileName": att.FileName, "fileType": att.FileType, "size": att.FileSize,
		"downloadUrl": ctx.BaseURL + "/links/file/" + token, "downloadUrlExpiresAt": exp.UTC().Format(time.RFC3339),
	}
	switch {
	case strings.HasPrefix(att.FileType, "image/") && att.FileSize <= maxInlinePicture:
		data, err := readObject(att.ID, maxInlinePicture+1)
		if err != nil {
			return nil, err
		}
		return mcpBlocks{jsonBlock(meta), {"type": "image", "data": base64.StdEncoding.EncodeToString(data), "mimeType": att.FileType}}, nil
	case isTextType(att.FileType):
		data, err := readObject(att.ID, maxInlineText)
		if err != nil {
			return nil, err
		}
		if int64(len(data)) < att.FileSize {
			meta["truncated"] = fmt.Sprintf("Only the first %d KB are below; download the rest from downloadUrl", maxInlineText>>10)
		}
		return mcpBlocks{jsonBlock(meta), {"type": "text", "text": strings.ToValidUTF8(string(data), "�")}}, nil
	}
	meta["note"] = "This kind of file is not shown inline: download it from downloadUrl (curl -o), valid 15 minutes, no Authorization header."
	return mcpBlocks{jsonBlock(meta)}, nil
}

// File links (no sign-in: the signed link is the permission) -----------------------------------

// POST /links/upload/:token (multipart "file")
func (h *NotesAPIHandler) UploadByLink(c *gin.Context) {
	userID, target, err := h.tokens.VerifyFileLink(c.Param("token"), authtoken.FileLinkUpload)
	if err != nil {
		c.JSON(http.StatusUnauthorized, types.NewErrorResponse(types.ErrorCodeInvalidToken, "The link is not valid or has expired: ask for a new one"))
		return
	}
	noteID, _ := strconv.Atoi(target)
	if _, err := h.files.writableNote(userID, noteID); err != nil {
		respondAPIError(c, err)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, initializers.MaxUploadBody())
	file, err := c.FormFile("file")
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "request body too large") {
			c.JSON(http.StatusRequestEntityTooLarge, types.NewErrorResponse(types.ErrorCodeValidation, "file size exceeds the limit"))
			return
		}
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Send the file as multipart/form-data in the field \"file\""))
		return
	}
	sf, err := h.files.store(userID, upload{NoteID: noteID, Name: file.Filename, Size: file.Size, Open: func() (io.ReadCloser, error) { return file.Open() }})
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(sf))
}

// GET /links/file/:token
func (h *NotesAPIHandler) DownloadByLink(c *gin.Context) {
	userID, attID, err := h.tokens.VerifyFileLink(c.Param("token"), authtoken.FileLinkDownload)
	if err != nil {
		c.JSON(http.StatusUnauthorized, types.NewErrorResponse(types.ErrorCodeInvalidToken, "The link is not valid or has expired: ask for a new one"))
		return
	}
	att, err := h.files.readable(userID, attID)
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.Header("Content-Disposition", attachmentDisposition(att.FileName))
	serveAttachmentContent(c, att.ID, att.FileType, att.FileName, "no-store")
}
