package repository

import "time"

// UpdateNoteByAPI changes a note's text, tags and/or date outside sync (REST and MCP). A nil field is
// left as it is. It records the edit in the note history, the same way a sync push does.
func (r *SyncRepository) UpdateNoteByAPI(userID, noteID, spaceID int, text *string, tags *[]string, date *time.Time) (time.Time, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback()
	q := &SyncRepository{db: r.db, q: tx}

	var modified time.Time
	err = tx.QueryRow(`
		UPDATE note SET text = COALESCE($2, text), date = COALESCE($3, date), modified_at = NOW(), modified_by = $4
		WHERE id = $1
		RETURNING modified_at
	`, noteID, text, date, userID).Scan(&modified)
	if err != nil {
		return time.Time{}, err
	}
	if err := q.logNoteEdit(noteID, userID, "edited"); err != nil {
		return time.Time{}, err
	}
	if tags != nil {
		if err := q.replaceNoteTags(noteID, *tags, spaceID); err != nil {
			return time.Time{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return time.Time{}, err
	}
	return modified, nil
}
