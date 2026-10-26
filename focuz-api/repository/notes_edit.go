package repository

import "time"

// ParentChange moves a note to another thread: Parent is the new parent, nil for none.
type ParentChange struct {
	Parent *int
}

// UpdateNoteByAPI changes a note's text, tags, date and/or parent outside sync (REST and MCP). A nil
// field is left as it is. It records the edit in the note history, the same way a sync push does.
func (r *SyncRepository) UpdateNoteByAPI(userID, noteID, spaceID int, text *string, tags *[]string, date *time.Time, parent *ParentChange) (time.Time, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback()
	q := &SyncRepository{db: r.db, q: tx}

	setParent := parent != nil
	var parentID *int
	if setParent {
		parentID = parent.Parent
	}
	var modified time.Time
	err = tx.QueryRow(`
		UPDATE note SET text = COALESCE($2, text), date = COALESCE($3, date), modified_at = NOW(), modified_by = $4,
			parent_id = CASE WHEN $5::boolean THEN $6::integer ELSE parent_id END
		WHERE id = $1
		RETURNING modified_at
	`, noteID, text, date, userID, setParent, parentID).Scan(&modified)
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

// ParentMakesCycle reports whether parentID is noteID or one of its replies (see parentMakesCycle).
func (r *SyncRepository) ParentMakesCycle(noteID, parentID int) (bool, error) {
	return parentMakesCycle(r.db, noteID, parentID)
}
