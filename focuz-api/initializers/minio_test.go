package initializers

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"github.com/gabriel-vasile/mimetype"
)

// zipWith builds a minimal zip-based office file: the entries the detector looks at.
func zipWith(t *testing.T, entries map[string]string, order ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range order {
		f, err := w.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(entries[name])); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func ooxml(t *testing.T, dir string) []byte {
	return zipWith(t, map[string]string{
		"[Content_Types].xml": `<?xml version="1.0"?><Types/>`,
		dir + "/document.xml":  `<?xml version="1.0"?><x/>`,
	}, "[Content_Types].xml", dir+"/document.xml")
}

func odf(t *testing.T, kind string) []byte {
	return zipWith(t, map[string]string{
		"mimetype":    "application/vnd.oasis.opendocument." + kind,
		"content.xml": `<?xml version="1.0"?><x/>`,
	}, "mimetype", "content.xml")
}

// The default list must let the documents people attach through, detected from their content.
func TestDefaultTypesAcceptDocuments(t *testing.T) {
	Conf = MinioConfig{MaxSize: 10 << 20, MaxDocumentSize: 25 << 20, FileTypes: DefaultFileTypes}
	cases := map[string][]byte{
		"pdf":      []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"),
		"txt":      []byte("Shopping list\nmilk\nbread\n"),
		"markdown": []byte("# Plan\n\n- [ ] call the plumber\n- **buy** milk\n"),
		"csv":      []byte("name,qty\nmilk,1\nbread,2\n"),
		"rtf":      []byte(`{\rtf1\ansi Hello}`),
		"docx":     ooxml(t, "word"),
		"xlsx":     ooxml(t, "xl"),
		"pptx":     ooxml(t, "ppt"),
		"odt":      odf(t, "text"),
		"ods":      odf(t, "spreadsheet"),
		"odp":      odf(t, "presentation"),
	}
	for name, content := range cases {
		detected := strings.Split(mimetype.Detect(content).String(), ";")[0]
		if err := CheckFileAllowed(int64(len(content)), detected); err != nil {
			t.Errorf("%s (detected %s): %v", name, detected, err)
		}
	}
}

func TestDefaultTypesRejectOthers(t *testing.T) {
	Conf = MinioConfig{MaxSize: 10 << 20, MaxDocumentSize: 25 << 20, FileTypes: DefaultFileTypes}
	cases := map[string][]byte{
		"html": []byte("<!DOCTYPE html><html><script>alert(1)</script></html>"),
		"svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"zip":  zipWith(t, map[string]string{"a.txt": "a"}, "a.txt"),
		"exe":  append([]byte("MZ\x90\x00\x03\x00\x00\x00"), make([]byte, 120)...),
	}
	for name, content := range cases {
		detected := strings.Split(mimetype.Detect(content).String(), ";")[0]
		if err := CheckFileAllowed(int64(len(content)), detected); err == nil {
			t.Errorf("%s (detected %s) was allowed", name, detected)
		}
	}
}

func TestSizeLimitDependsOnKind(t *testing.T) {
	Conf = MinioConfig{MaxSize: 10 << 20, MaxDocumentSize: 25 << 20, FileTypes: DefaultFileTypes}
	if err := CheckFileAllowed(20<<20, "application/pdf"); err != nil {
		t.Errorf("20 MB PDF: %v", err)
	}
	if err := CheckFileAllowed(26<<20, "application/pdf"); err == nil {
		t.Error("26 MB PDF was allowed")
	}
	if err := CheckFileAllowed(11<<20, "image/webp"); err == nil {
		t.Error("11 MB picture was allowed")
	}
	if got, want := MaxUploadBody(), int64(26<<20); got != want {
		t.Errorf("MaxUploadBody = %d, want %d", got, want)
	}
	// Without a document limit (older configs) documents fall back to the picture limit.
	Conf.MaxDocumentSize = 0
	if err := CheckFileAllowed(11<<20, "application/pdf"); err == nil {
		t.Error("11 MB PDF was allowed without a document limit")
	}
}
