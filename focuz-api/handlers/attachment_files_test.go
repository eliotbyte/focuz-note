package handlers

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// storedFile reports whether the attachment's file is in the test MinIO bucket.
func (s *E2ETestSuite) storedFile(id string) bool {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = "localhost:9002"
		if os.Getenv("CI") != "" || os.Getenv("DOCKER") != "" {
			endpoint = "test-minio:9000"
		}
	}
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4("minioadmin", "minioadmin", "")})
	s.Require().NoError(err)
	_, err = client.StatObject(context.Background(), "notes", id, minio.StatObjectOptions{})
	if err == nil {
		return true
	}
	s.Require().Equal("NoSuchKey", minio.ToErrorResponse(err).Code, err)
	return false
}

func (s *E2ETestSuite) fileContentStatus(id string) int {
	req, _ := http.NewRequest("GET", s.baseURL+"/files/"+id+"/content", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp, err := (&http.Client{}).Do(req)
	s.Require().NoError(err)
	resp.Body.Close()
	return resp.StatusCode
}

// Deleting a picture through sync removes its file from storage, but only once the push commits.
func (s *E2ETestSuite) Test214_Attachments_DeletedFileIsRemoved() {
	since := time.Now().Add(-time.Minute)
	clientID := uuid.NewString()
	now := time.Now().UTC().Format(time.RFC3339)
	_, d := s.syncPush(map[string]any{"notes": []any{map[string]any{"clientId": clientID, "space_id": s.createdSpaceID, "text": "picture to delete", "tags": []string{}, "created_at": now, "modified_at": now}}})
	noteID := mappingFor(d, clientID)
	s.Require().NotZero(noteID)
	att := s.uploadPixel(noteID, "")
	s.Require().True(s.storedFile(att))

	deletePush := func(extra ...any) int {
		var serverModified string
		for _, n := range s.pullNotes(since) {
			if int(n["id"].(float64)) == noteID {
				serverModified, _ = n["modified_at"].(string)
			}
		}
		later := time.Now().UTC().Add(time.Second).Format(time.RFC3339)
		notes := append([]any{map[string]any{
			"id": noteID, "space_id": s.createdSpaceID, "text": "picture to delete", "tags": []string{},
			"created_at": now, "modified_at": later, "base_modified_at": serverModified,
			"attachments": []any{map[string]any{"id": att, "modified_at": later, "is_deleted": true}},
		}}, extra...)
		status, _ := s.syncPush(map[string]any{"notes": notes})
		return status
	}

	// A push that fails is rolled back: the row stays, so the file must stay too.
	bad := map[string]any{"clientId": uuid.NewString(), "space_id": s.createdSpaceID, "text": "bad", "tags": []string{strings.Repeat("x", 300)}, "created_at": now, "modified_at": now}
	s.Equal(http.StatusInternalServerError, deletePush(bad))
	s.True(s.storedFile(att))
	s.Equal(http.StatusOK, s.fileContentStatus(att))

	s.Require().Equal(http.StatusOK, deletePush())
	s.NotContains(s.pulledAttachmentIDs(since, noteID), att)
	s.False(s.storedFile(att))
	s.Equal(http.StatusNotFound, s.fileContentStatus(att))
}
