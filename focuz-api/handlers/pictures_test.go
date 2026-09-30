package handlers

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"strconv"
)

func testPNG(side int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, side, side))
	for x := 0; x < side; x++ {
		for y := 0; y < side; y++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func (s *E2ETestSuite) raw(method, path, token string, body []byte, contentType string) (int, []byte, http.Header) {
	req, _ := http.NewRequest(method, s.baseURL+path, bytes.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	s.Require().NoError(err)
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b, resp.Header
}

func (s *E2ETestSuite) Test310_Pictures_Avatars() {
	aliceTok, aliceID := s.newUser("pica")
	strangerTok, _ := s.newUser("picb")
	space := s.createSpace(aliceTok, "Pics")
	friendTok := s.join(aliceTok, space, "picf", "guest")
	pic := testPNG(64)

	code, _, _ := s.raw("PUT", "/me/avatar", aliceTok, []byte("not an image at all"), "image/png")
	s.Equal(http.StatusBadRequest, code)
	code, _, _ = s.raw("PUT", "/me/avatar", aliceTok, bytes.Repeat([]byte{1}, 301*1024), "image/png")
	s.Equal(http.StatusBadRequest, code)
	code, _, _ = s.raw("PUT", "/me/avatar", aliceTok, testPNG(1200), "image/png")
	s.Equal(http.StatusBadRequest, code)
	code, _, _ = s.raw("PUT", "/me/avatar", aliceTok, pic, "image/png")
	s.Require().Equal(http.StatusOK, code)
	_, me := s.call("GET", "/me", aliceTok, nil)
	s.Greater(me["data"].(map[string]any)["avatarVersion"].(float64), 0.0)

	path := "/users/" + strconv.Itoa(aliceID) + "/avatar"
	code, body, h := s.raw("GET", path, friendTok, nil, "")
	s.Equal(http.StatusOK, code)
	s.Equal("image/png", h.Get("Content-Type"))
	s.Equal(pic, body)
	code, _, _ = s.raw("GET", path, strangerTok, nil, "")
	s.Equal(http.StatusNotFound, code) // no common space: nothing to see

	code, _, _ = s.raw("DELETE", "/me/avatar", aliceTok, nil, "")
	s.Equal(http.StatusOK, code)
	code, _, _ = s.raw("GET", path, friendTok, nil, "")
	s.Equal(http.StatusNotFound, code)
}

func (s *E2ETestSuite) Test311_Pictures_SpaceIcons() {
	ownerTok, _ := s.newUser("icono")
	outsiderTok, _ := s.newUser("iconx")
	space := s.createSpace(ownerTok, "Garden club")
	sp := strconv.Itoa(space)
	editorTok := s.join(ownerTok, space, "icone", "editor")
	pic := testPNG(128)

	code, _, _ := s.raw("PUT", "/spaces/"+sp+"/icon", editorTok, pic, "image/png")
	s.Equal(http.StatusForbidden, code)
	code, _, _ = s.raw("PUT", "/spaces/"+sp+"/icon", ownerTok, pic, "image/png")
	s.Require().Equal(http.StatusOK, code)

	iconVersion := func(tok string) float64 {
		_, out := s.call("GET", "/sync?since=1970-01-01T00:00:00Z", tok, nil)
		for _, m := range out["data"].(map[string]any)["memberships"].([]any) {
			mm := m.(map[string]any)
			if int(mm["space_id"].(float64)) == space {
				return mm["icon_version"].(float64)
			}
		}
		return -1
	}
	s.Greater(iconVersion(editorTok), 0.0)
	code, body, _ := s.raw("GET", "/spaces/"+sp+"/icon", editorTok, nil, "")
	s.Equal(http.StatusOK, code)
	s.Equal(pic, body)
	code, _, _ = s.raw("GET", "/spaces/"+sp+"/icon", outsiderTok, nil, "")
	s.Equal(http.StatusNotFound, code)

	code, _, _ = s.raw("DELETE", "/spaces/"+sp+"/icon", ownerTok, nil, "")
	s.Equal(http.StatusOK, code)
	s.Equal(0.0, iconVersion(editorTok))

	// The personal space shows the owner's avatar instead.
	_, out := s.call("POST", "/spaces", outsiderTok, map[string]any{"name": "Mine", "personal": true})
	personal := strconv.Itoa(int(out["data"].(map[string]any)["id"].(float64)))
	code, _, _ = s.raw("PUT", "/spaces/"+personal+"/icon", outsiderTok, pic, "image/png")
	s.Equal(http.StatusBadRequest, code)
}
