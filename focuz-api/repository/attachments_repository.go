package repository

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type Attachment struct {
	ID         string
	NoteID     int
	ClientID   sql.NullString
	FileName   string
	FileType   string
	FileSize   int64
	CreatedAt  time.Time
	ModifiedAt time.Time
}

type AttachmentsRepository struct {
	db *sql.DB
}

func NewAttachmentsRepository(db *sql.DB) *AttachmentsRepository {
	return &AttachmentsRepository{db: db}
}

func (r *AttachmentsRepository) CreateOrGetAttachment(noteID int, clientID *string, fileName, fileType string, fileSize int64) (string, error) {
	// If clientID is provided, make upload idempotent per (note_id, client_id).
	// This prevents duplicates when the client retries after a timeout/network error.
	id := uuid.NewString()
	var outID string
	if clientID != nil && *clientID != "" {
		err := r.db.QueryRow(`
			INSERT INTO attachments (id, note_id, client_id, file_name, file_type, file_size, created_at, modified_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			ON CONFLICT (note_id, client_id)
			DO UPDATE SET
				file_name = EXCLUDED.file_name,
				file_type = EXCLUDED.file_type,
				file_size = EXCLUDED.file_size,
				modified_at = NOW()
			RETURNING id
		`, id, noteID, *clientID, fileName, fileType, fileSize).Scan(&outID)
		if err != nil {
			return "", err
		}
		return outID, nil
	}
	_, err := r.db.Exec(`
		INSERT INTO attachments (id, note_id, file_name, file_type, file_size, created_at, modified_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
	`, id, noteID, fileName, fileType, fileSize)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (r *AttachmentsRepository) GetAttachmentByID(attID string) (*Attachment, error) {
	var a Attachment
	err := r.db.QueryRow(`
		SELECT id, note_id, client_id, file_name, file_type, file_size, created_at, modified_at
		FROM attachments
		WHERE id = $1
	`, attID).Scan(
		&a.ID, &a.NoteID, &a.ClientID, &a.FileName, &a.FileType, &a.FileSize, &a.CreatedAt, &a.ModifiedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}
