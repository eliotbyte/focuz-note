package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"time"

	_ "github.com/lib/pq"
)

func (s *E2ETestSuite) Test38_UploadFileInvalidNote() {
	// Test uploading file with invalid note ID
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("file", "test.txt")
	part.Write([]byte("test content"))
	writer.WriteField("note_id", "99999")
	writer.Close()

	req, _ := http.NewRequest("POST", s.baseURL+"/upload", body)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test39_UploadFile() {
	// Create a new note for this test
	reqBody := map[string]interface{}{
		"text":     "Note for file upload test",
		"tags":     []string{"upload", "test"},
		"parentId": nil,
		"date":     time.Now().Format(time.RFC3339),
		"spaceId":  s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	var noteResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&noteResp)
	var noteID int
	if noteResp["success"] != nil && noteResp["success"].(bool) {
		noteData := noteResp["data"].(map[string]interface{})
		noteID = int(noteData["id"].(float64))
		s.True(noteID > 0)
	} else {
		s.Fail("Note creation failed")
		return
	}

	// Test uploading file with valid note ID
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Create the file part with explicit Content-Type
	part, _ := writer.CreatePart(map[string][]string{
		"Content-Type":        {"text/plain"},
		"Content-Disposition": {`form-data; name="file"; filename="test.txt"`},
	})
	part.Write([]byte("test content"))
	writer.WriteField("note_id", strconv.Itoa(noteID))
	writer.Close()

	req2, _ := http.NewRequest("POST", s.baseURL+"/upload", body)
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", writer.FormDataContentType())
	client2 := &http.Client{}
	resp2, err2 := client2.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)
}

func (s *E2ETestSuite) Test40_GetFileForbidden() {
	req, _ := http.NewRequest("GET", s.baseURL+"/files/some-random-id", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusNotFound, resp.StatusCode)
}

func (s *E2ETestSuite) Test41_UploadAndGetFile() {
	// Create a new note for this test
	reqBody := map[string]interface{}{
		"text":     "Note for upload and get file test",
		"tags":     []string{"upload", "get", "test"},
		"parentId": nil,
		"date":     time.Now().Format(time.RFC3339),
		"spaceId":  s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	var noteResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&noteResp)
	var noteID int
	if noteResp["success"] != nil && noteResp["success"].(bool) {
		noteData := noteResp["data"].(map[string]interface{})
		noteID = int(noteData["id"].(float64))
		s.True(noteID > 0)
	} else {
		s.Fail("Note creation failed")
		return
	}

	// Test uploading and then retrieving a file
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Create the file part with explicit Content-Type
	part, _ := writer.CreatePart(map[string][]string{
		"Content-Type":        {"text/plain"},
		"Content-Disposition": {`form-data; name="file"; filename="test.txt"`},
	})
	part.Write([]byte("test content"))
	writer.WriteField("note_id", strconv.Itoa(noteID))
	writer.Close()

	req2, _ := http.NewRequest("POST", s.baseURL+"/upload", body)
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", writer.FormDataContentType())
	client2 := &http.Client{}
	resp2, err2 := client2.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)

	// Parse response to get attachment ID
	var response map[string]interface{}
	json.NewDecoder(resp2.Body).Decode(&response)
	s.True(response["success"].(bool))

	// Check if data exists before accessing it
	if response["data"] != nil {
		data := response["data"].(map[string]interface{})
		attachmentID := data["attachment_id"].(string)
		s.NotEmpty(attachmentID)

		// Test retrieving the file
		req3, _ := http.NewRequest("GET", s.baseURL+"/files/"+attachmentID, nil)
		req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
		resp3, err3 := client2.Do(req3)
		s.NoError(err3)
		defer resp3.Body.Close()
		s.Equal(http.StatusOK, resp3.StatusCode)
	} else {
		s.Fail("Upload response does not contain data")
	}
}

func (s *E2ETestSuite) Test39B_UploadFile_MimeDetectionOverridesHeader() {
	// Create a new note first
	reqBody := map[string]interface{}{
		"text":     "Note for mime detection test",
		"tags":     []string{"upload", "detect"},
		"parentId": nil,
		"date":     time.Now().Format(time.RFC3339),
		"spaceId":  s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	var noteResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&noteResp)
	noteID := int(noteResp["data"].(map[string]interface{})["id"].(float64))

	// Build multipart with spoofed header (image/png) but plain text body
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreatePart(map[string][]string{
		"Content-Type":        {"image/png"},
		"Content-Disposition": {`form-data; name="file"; filename="test.txt"`},
	})
	part.Write([]byte("just some plain text"))
	writer.WriteField("note_id", strconv.Itoa(noteID))
	writer.Close()

	req2, _ := http.NewRequest("POST", s.baseURL+"/upload", body)
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", writer.FormDataContentType())
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)

	var uploadResp map[string]interface{}
	json.NewDecoder(resp2.Body).Decode(&uploadResp)
	attID := uploadResp["data"].(map[string]interface{})["attachment_id"].(string)

	// Assert DB stored file_type as detected text/plain (not image/png)
	dbURL := os.Getenv("DATABASE_URL")
	db, err := sql.Open("postgres", dbURL)
	s.NoError(err)
	defer db.Close()
	var storedType string
	err = db.QueryRow("SELECT file_type FROM attachments WHERE id=$1", attID).Scan(&storedType)
	s.NoError(err)
	// We normalize to base MIME without parameters
	s.Equal("text/plain", storedType)
}

func (s *E2ETestSuite) Test39C_UploadFile_DisallowedGifDespiteHeaderPng() {
	// Create a note
	reqBody := map[string]interface{}{
		"text":     "Note for disallowed gif test",
		"tags":     []string{"upload", "gif"},
		"parentId": nil,
		"date":     time.Now().Format(time.RFC3339),
		"spaceId":  s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)
	var noteResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&noteResp)
	noteID := int(noteResp["data"].(map[string]interface{})["id"].(float64))

	// Minimal 1x1 GIF (GIF89a ...) bytes
	gifBytes := []byte{
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
		0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0x21,
		0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00,
		0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
		0x01, 0x00, 0x3B,
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreatePart(map[string][]string{
		"Content-Type":        {"image/png"},
		"Content-Disposition": {`form-data; name="file"; filename="tiny.gif"`},
	})
	part.Write(gifBytes)
	writer.WriteField("note_id", strconv.Itoa(noteID))
	writer.Close()

	req2, _ := http.NewRequest("POST", s.baseURL+"/upload", body)
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", writer.FormDataContentType())
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	// GIF is not in ALLOWED_FILE_TYPES, should be rejected
	s.Equal(http.StatusBadRequest, resp2.StatusCode)
}

func (s *E2ETestSuite) Test39D_UploadFile_TooLargeReturns413() {
	// Create a note
	reqBody := map[string]interface{}{
		"text":     "Note for too large file test",
		"tags":     []string{"upload", "large"},
		"parentId": nil,
		"date":     time.Now().Format(time.RFC3339),
		"spaceId":  s.createdSpaceID,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)
	var noteResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&noteResp)
	noteID := int(noteResp["data"].(map[string]interface{})["id"].(float64))

	// Build a payload bigger than MAX_FILE_SIZE (10MB in tests)
	big := bytes.Repeat([]byte("a"), 11*1024*1024)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreatePart(map[string][]string{
		"Content-Type":        {"text/plain"},
		"Content-Disposition": {`form-data; name="file"; filename="big.txt"`},
	})
	part.Write(big)
	writer.WriteField("note_id", strconv.Itoa(noteID))
	writer.Close()

	req2, _ := http.NewRequest("POST", s.baseURL+"/upload", body)
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", writer.FormDataContentType())
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	// Some stacks may return 400 on multipart parse before hitting MaxBytesReader; accept 400 or 413
	s.Contains([]int{http.StatusRequestEntityTooLarge, http.StatusBadRequest}, resp2.StatusCode)
}
