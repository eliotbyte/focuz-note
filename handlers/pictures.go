package handlers

import (
	"bytes"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strconv"

	"focuz-api/pkg/access"
	"focuz-api/repository"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
)

// Space pictures and avatars: small square images the apps crop and resize before upload.
const (
	maxPictureBytes = 300 * 1024
	maxPictureSide  = 1024
)

var pictureTypes = map[string]bool{"image/webp": true, "image/png": true, "image/jpeg": true}

// readPicture takes the raw request body and checks it really is a small image.
func readPicture(c *gin.Context) ([]byte, string, bool) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxPictureBytes+1))
	if err != nil {
		badRequest(c, "Could not read the picture")
		return nil, "", false
	}
	if len(body) == 0 || len(body) > maxPictureBytes {
		badRequest(c, "The picture must be under 300 KB")
		return nil, "", false
	}
	ct := http.DetectContentType(body)
	if !pictureTypes[ct] {
		badRequest(c, "Use a WebP, PNG or JPEG picture")
		return nil, "", false
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > maxPictureSide || cfg.Height > maxPictureSide {
		badRequest(c, "The picture must be a valid image up to 1024x1024")
		return nil, "", false
	}
	return body, ct, true
}

func servePicture(c *gin.Context, p *repository.Picture, err error) {
	if err != nil {
		if !errors.Is(err, repository.ErrNotFound) {
			c.Status(http.StatusInternalServerError)
			return
		}
		notFound(c, "No picture")
		return
	}
	c.Header("Cache-Control", "private, max-age=31536000, immutable")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'")
	c.Data(http.StatusOK, p.Type, p.Data)
}

// GET /spaces/:spaceId/icon (members)
func (h *SharingHandler) SpaceIcon(c *gin.Context) {
	space, _, ok := h.member(c)
	if !ok {
		return
	}
	p, err := h.repo.SpaceIcon(space.ID)
	servePicture(c, p, err)
}

// PUT /spaces/:spaceId/icon (admins; raw image body) · DELETE removes it
func (h *SharingHandler) SetSpaceIcon(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	if !access.CanManage(role) {
		forbidden(c, "Only admins can change the space picture")
		return
	}
	if space.IsPersonal {
		badRequest(c, "Your personal space shows your own picture: change it in Settings → Account")
		return
	}
	var data []byte
	ct := ""
	if c.Request.Method != http.MethodDelete {
		var ok bool
		if data, ct, ok = readPicture(c); !ok {
			return
		}
	}
	if err := h.repo.SetSpaceIcon(space.ID, data, ct); err != nil {
		h.fail(c, "space icon", err)
		return
	}
	h.pingSpace(space.ID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// PUT /me/avatar (raw image body) · DELETE removes it
func (h *SharingHandler) SetAvatar(c *gin.Context) {
	userID := c.GetInt("userId")
	var data []byte
	ct := ""
	if c.Request.Method != http.MethodDelete {
		var ok bool
		if data, ct, ok = readPicture(c); !ok {
			return
		}
	}
	if err := h.repo.SetAvatar(userID, data, ct); err != nil {
		h.fail(c, "avatar", err)
		return
	}
	// People who share a space with me pull the new version with the member list.
	if spaces, err := h.repo.Memberships(userID); err == nil {
		for _, m := range spaces {
			h.pingSpace(m.SpaceID)
		}
	}
	h.GetMe(c)
}

// GET /users/:userId/avatar — yourself, or someone you share a space with.
func (h *SharingHandler) UserAvatar(c *gin.Context) {
	target, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		badRequest(c, "Invalid user id")
		return
	}
	me := c.GetInt("userId")
	if target != me {
		ok, err := h.repo.ShareASpace(me, target)
		if err != nil || !ok {
			notFound(c, "No picture")
			return
		}
	}
	p, err := h.repo.Avatar(target)
	servePicture(c, p, err)
}
