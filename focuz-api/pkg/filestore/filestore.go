// Package filestore removes attachment files from MinIO.
//
// A file is stored under its attachment's id (a UUID). The attachments row is the source of truth:
// a file is removed only once its row is gone for good (after the transaction that deleted it
// committed), so a rollback never loses a file the database still points to.
package filestore

import (
	"context"
	"database/sql"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/minio/minio-go/v7"
)

// removeTimeout bounds the removal of the files of one request.
const removeTimeout = 15 * time.Second

type Store struct {
	Client *minio.Client
	Bucket string
}

// Remove deletes the files of attachments whose rows were deleted. A failure is logged and
// otherwise ignored: the request already succeeded, and the orphan sweep picks the file up later.
func (s *Store) Remove(ids []string) {
	if s == nil || s.Client == nil || len(ids) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), removeTimeout)
	defer cancel()
	for _, id := range ids {
		if _, ok := AttachmentID(id); !ok {
			continue
		}
		if err := s.Client.RemoveObject(ctx, s.Bucket, id, minio.RemoveObjectOptions{}); err != nil {
			log.Printf("filestore: could not remove file of deleted attachment %s: %v", id, err)
		}
	}
}

// AttachmentID returns the attachment id an object key belongs to: the key itself, or its first
// path segment ("<id>/..."). Keys that are not attachment files are reported as not ok.
func AttachmentID(key string) (string, bool) {
	id, _, _ := strings.Cut(key, "/")
	if _, err := uuid.Parse(id); err != nil || len(id) != 36 {
		return "", false
	}
	return strings.ToLower(id), true
}

// sweepBatch is how many object keys are checked against the database in one query.
const sweepBatch = 500

// SweepOrphans removes files that have no attachments row (left behind by deletes before files
// were removed, or by a failed removal). Files newer than minAge are kept, so an upload in
// progress is never touched. It does nothing while the attachments table is empty: that is a new
// or wrong database rather than one whose every picture was deleted.
func (s *Store) SweepOrphans(ctx context.Context, db *sql.DB, minAge time.Duration) (int, error) {
	var hasRows bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM attachments)`).Scan(&hasRows); err != nil {
		return 0, err
	}
	if !hasRows {
		return 0, nil
	}

	cutoff := time.Now().Add(-minAge)
	removed := 0
	batch := map[string][]string{} // attachment id -> its object keys
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		ids := make([]string, 0, len(batch))
		for id := range batch {
			ids = append(ids, id)
		}
		rows, err := db.QueryContext(ctx, `SELECT LOWER(id) FROM attachments WHERE LOWER(id) = ANY($1)`, pq.Array(ids))
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			delete(batch, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, keys := range batch {
			for _, key := range keys {
				if err := s.Client.RemoveObject(ctx, s.Bucket, key, minio.RemoveObjectOptions{}); err != nil {
					log.Printf("filestore: could not remove orphan file %s: %v", key, err)
					continue
				}
				removed++
			}
		}
		batch = map[string][]string{}
		return nil
	}

	for obj := range s.Client.ListObjects(ctx, s.Bucket, minio.ListObjectsOptions{Recursive: true}) {
		if obj.Err != nil {
			return removed, obj.Err
		}
		id, ok := AttachmentID(obj.Key)
		if !ok || obj.LastModified.After(cutoff) {
			continue
		}
		batch[id] = append(batch[id], obj.Key)
		if len(batch) >= sweepBatch {
			if err := flush(); err != nil {
				return removed, err
			}
		}
	}
	return removed, flush()
}
