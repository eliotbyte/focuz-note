package handlers

import "encoding/binary"

// testPictureWebP returns a lossless WebP header for a width x height picture with no pixel data.
// The server reads only the header to check the size, so this is enough for upload tests.
func testPictureWebP(width, height int) []byte {
	le32 := func(v int) []byte {
		b := make([]byte, 4)
		binary.LittleEndian.PutUint32(b, uint32(v))
		return b
	}
	bits := uint32(width-1) | uint32(height-1)<<14
	vp8l := []byte{0x2f, byte(bits), byte(bits >> 8), byte(bits >> 16), byte(bits >> 24)}
	chunk := append(append([]byte("VP8L"), le32(len(vp8l))...), vp8l...)
	riff := append([]byte("WEBP"), chunk...)
	return append(append([]byte("RIFF"), le32(len(riff))...), riff...)
}
