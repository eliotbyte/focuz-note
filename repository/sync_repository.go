package repository

import (
	"database/sql"
	"encoding/json"
	"focuz-api/models"
	"focuz-api/types"
	"time"

	"github.com/lib/pq"
)

// querier is the subset of *sql.DB / *sql.Tx used while applying a push.
type querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

type SyncRepository struct {
	db *sql.DB
	// q is the executor used by applyChanges (a transaction during a push).
	q querier
}

func NewSyncRepository(db *sql.DB) *SyncRepository { return &SyncRepository{db: db, q: db} }

func (r *SyncRepository) GetChangesSince(userID int, accessibleSpaceIDs []int, since time.Time) (*types.SyncPullResponse, error) {
	resp := &types.SyncPullResponse{}

	// Spaces
	rows, err := r.db.Query(`
		SELECT id, name, created_at, modified_at, is_deleted
		FROM space
		WHERE id = ANY($1)
		AND modified_at > $2
	`, pq.Array(accessibleSpaceIDs), since)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int
		var name string
		var created, modified time.Time
		var isDeleted bool
		if err := rows.Scan(&id, &name, &created, &modified, &isDeleted); err != nil {
			rows.Close()
			return nil, err
		}
		var deletedAt *time.Time
		if isDeleted {
			deletedAt = &modified
		}
		resp.Spaces = append(resp.Spaces, types.SpaceChange{ID: id, Name: name, CreatedAt: created, ModifiedAt: modified, DeletedAt: deletedAt})
	}
	rows.Close()

	// Notes (include deleted). Include nested activities, charts and attachments (with RFC3339 timestamps) for each note.
	noteRows, err := r.db.Query(`
        SELECT n.id, n.user_id, n.space_id, n.text, n.date, n.parent_id, n.created_at, n.modified_at, n.is_deleted,
          COALESCE((SELECT ARRAY_AGG(t.name ORDER BY t.name)
                   FROM note_to_tag nt JOIN tag t ON t.id = nt.tag_id
                   WHERE nt.note_id = n.id), ARRAY[]::text[]) AS tags,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', a.id,
              'user_id', a.user_id,
              'type_id', a.type_id,
              'value', a.value,
              'created_at', to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'modified_at', to_char(a.modified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ) ORDER BY a.modified_at ASC, a.id ASC)
            FROM activities a WHERE a.note_id = n.id AND a.is_deleted = FALSE
          ), '[]'::json) AS activities,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', c.id,
              'user_id', c.user_id,
              'space_id', c.space_id,
              'kind_id', c.kind,
              'activity_type_id', c.activity_type_id,
              'period_id', c.period,
              'name', c.name,
              'description', c.description,
              'note_id', c.note_id,
              'created_at', to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'modified_at', to_char(c.modified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'deleted_at', CASE WHEN c.is_deleted THEN to_char(c.modified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END
            ) ORDER BY c.modified_at ASC, c.id ASC)
            FROM chart c WHERE c.note_id = n.id
          ), '[]'::json) AS charts,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', att.id,
              'file_name', att.file_name,
              'file_type', att.file_type,
              'file_size', att.file_size,
              'created_at', to_char(att.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'modified_at', to_char(att.modified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ) ORDER BY att.modified_at ASC, att.id ASC)
            FROM attachments att WHERE att.note_id = n.id
          ), '[]'::json) AS attachments
        FROM note n
        WHERE n.space_id = ANY($1)
        AND (
          n.modified_at > $2 OR
          EXISTS (SELECT 1 FROM activities a WHERE a.note_id = n.id AND a.modified_at > $2) OR
          EXISTS (SELECT 1 FROM chart c WHERE c.note_id = n.id AND c.modified_at > $2) OR
          EXISTS (SELECT 1 FROM attachments att WHERE att.note_id = n.id AND att.modified_at > $2)
        )
        ORDER BY n.id
    `, pq.Array(accessibleSpaceIDs), since)
	if err != nil {
		return nil, err
	}
	for noteRows.Next() {
		var id, userIDRow, spaceID int
		var text string
		var created, modified time.Time
		var isDeleted bool
		var date time.Time
		var parentID sql.NullInt64
		var tags []string
		var activitiesJSON []byte
		var chartsJSON []byte
		var attachmentsJSON []byte
		if err := noteRows.Scan(&id, &userIDRow, &spaceID, &text, &date, &parentID, &created, &modified, &isDeleted, pq.Array(&tags), &activitiesJSON, &chartsJSON, &attachmentsJSON); err != nil {
			noteRows.Close()
			return nil, err
		}
		var deletedAt *time.Time
		if isDeleted {
			deletedAt = &modified
		}
		var datePtr *time.Time = &date
		if date.IsZero() {
			datePtr = nil
		}
		var parentPtr *int
		if parentID.Valid {
			tmp := int(parentID.Int64)
			parentPtr = &tmp
		}
		var noteChange = types.NoteChange{
			ID:         &id,
			SpaceID:    spaceID,
			UserID:     userIDRow,
			Text:       &text,
			Tags:       tags,
			Date:       datePtr,
			ParentID:   parentPtr,
			CreatedAt:  created,
			ModifiedAt: modified,
			DeletedAt:  deletedAt,
		}
		if len(activitiesJSON) > 0 {
			var acts []types.ActivityChange
			_ = json.Unmarshal(activitiesJSON, &acts)
			noteChange.Activities = acts
		}
		if len(attachmentsJSON) > 0 {
			var atts []types.AttachmentChange
			_ = json.Unmarshal(attachmentsJSON, &atts)
			noteChange.Attachments = atts
		}
		if len(chartsJSON) > 0 {
			var chs []types.ChartChange
			_ = json.Unmarshal(chartsJSON, &chs)
			noteChange.Charts = chs
		}
		resp.Notes = append(resp.Notes, noteChange)
	}
	noteRows.Close()

	// Tags per space (no delete tracking yet)
	tagRows, err := r.db.Query(`
		SELECT t.id, ts.space_id, t.name, ts.created_at
		FROM tag t JOIN tag_to_space ts ON ts.tag_id = t.id
		WHERE ts.space_id = ANY($1)
		AND ts.created_at > $2
		ORDER BY ts.space_id, t.name
	`, pq.Array(accessibleSpaceIDs), since)
	if err != nil {
		return nil, err
	}
	for tagRows.Next() {
		var id, spaceID int
		var name string
		var created time.Time
		if err := tagRows.Scan(&id, &spaceID, &name, &created); err != nil {
			tagRows.Close()
			return nil, err
		}
		resp.Tags = append(resp.Tags, types.TagChange{ID: id, SpaceID: spaceID, Name: name, CreatedAt: created, ModifiedAt: created})
	}
	tagRows.Close()

	// Filters
	filterRows, err := r.db.Query(`
		SELECT id, user_id, space_id, parent_id, name, params, created_at, modified_at, is_deleted
		FROM filters
		WHERE space_id = ANY($1)
		AND modified_at > $2
	`, pq.Array(accessibleSpaceIDs), since)
	if err != nil {
		return nil, err
	}
	for filterRows.Next() {
		var id, userIDRow, spaceID int
		var name string
		var paramsRaw []byte
		var created, modified time.Time
		var isDeleted bool
		var parentID sql.NullInt64
		if err := filterRows.Scan(&id, &userIDRow, &spaceID, &parentID, &name, &paramsRaw, &created, &modified, &isDeleted); err != nil {
			filterRows.Close()
			return nil, err
		}
		var params interface{}
		_ = json.Unmarshal(paramsRaw, &params)
		var deletedAt *time.Time
		if isDeleted {
			deletedAt = &modified
		}
		var parentPtr *int
		if parentID.Valid {
			tmp := int(parentID.Int64)
			parentPtr = &tmp
		}
		// Align with pointer ID in type
		idCopy := id
		resp.Filters = append(resp.Filters, types.FilterChange{ID: &idCopy, SpaceID: spaceID, UserID: userIDRow, ParentID: parentPtr, Name: name, Params: params, CreatedAt: created, ModifiedAt: modified, DeletedAt: deletedAt})
	}
	filterRows.Close()

	// Root-level charts removed from pull; charts are nested under notes now.

	// Removed: root-level Activities and Attachments. They are now nested under notes.

	// Activity types (default or space-specific)
	atyRows, err := r.db.Query(`
		SELECT id, name, value_type, min_value, max_value, aggregation, space_id, is_default, unit, category_id, created_at, modified_at
		FROM activity_types
		WHERE modified_at > $2
		AND (is_default = TRUE OR space_id = ANY($1))
		AND is_deleted = FALSE
	`, pq.Array(accessibleSpaceIDs), since)
	if err != nil {
		return nil, err
	}
	for atyRows.Next() {
		var it types.ActivityTypeChange
		var spaceID sql.NullInt64
		var minV, maxV sql.NullFloat64
		var unit sql.NullString
		var catID sql.NullInt64
		if err := atyRows.Scan(&it.ID, &it.Name, &it.ValueType, &minV, &maxV, &it.Aggregation, &spaceID, &it.IsDefault, &unit, &catID, &it.CreatedAt, &it.ModifiedAt); err != nil {
			atyRows.Close()
			return nil, err
		}
		if spaceID.Valid {
			tmp := int(spaceID.Int64)
			it.SpaceID = &tmp
		}
		if minV.Valid {
			tmp := minV.Float64
			it.MinValue = &tmp
		}
		if maxV.Valid {
			tmp := maxV.Float64
			it.MaxValue = &tmp
		}
		if unit.Valid {
			it.Unit = &unit.String
		}
		if catID.Valid {
			tmp := int(catID.Int64)
			it.CategoryID = &tmp
		}
		resp.ActivityTypes = append(resp.ActivityTypes, it)
	}
	atyRows.Close()

	return resp, nil
}

// ApplyChanges applies client changes with last-write-wins policy.
// The whole push is applied atomically: if anything fails, nothing is written, so a client
// retrying after an error cannot create duplicates of the notes that were already inserted.
func (r *SyncRepository) ApplyChanges(userID int, payload types.SyncPushRequest) (*types.SyncPushResponse, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	txRepo := &SyncRepository{db: r.db, q: tx}
	resp, err := txRepo.applyChanges(userID, payload)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return resp, nil
}

// serverChangedSince reports whether the server copy must win over a client edit.
// With a base version the check is exact and independent of client clock skew;
// without one (old clients) we fall back to comparing timestamps.
func serverChangedSince(serverModified time.Time, clientModified time.Time, base *time.Time) bool {
	if base != nil {
		return serverModified.After(*base)
	}
	return !clientModified.After(serverModified)
}

// validParentNote returns parentID if it references an existing note in the same space, nil otherwise.
// An unknown parent must not fail the whole push (it would block every later sync of the client).
func (r *SyncRepository) validParentNote(parentID *int, spaceID int) (*int, error) {
	if parentID == nil {
		return nil, nil
	}
	var exists bool
	if err := r.q.QueryRow(`SELECT EXISTS(SELECT 1 FROM note WHERE id = $1 AND space_id = $2)`, *parentID, spaceID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, nil
	}
	return parentID, nil
}

// validParentFilter is the filters counterpart of validParentNote.
func (r *SyncRepository) validParentFilter(parentID *int, spaceID int) (*int, error) {
	if parentID == nil {
		return nil, nil
	}
	var exists bool
	if err := r.q.QueryRow(`SELECT EXISTS(SELECT 1 FROM filters WHERE id = $1 AND space_id = $2)`, *parentID, spaceID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, nil
	}
	return parentID, nil
}

func (r *SyncRepository) applyChanges(userID int, payload types.SyncPushRequest) (*types.SyncPushResponse, error) {
	resp := &types.SyncPushResponse{Applied: 0, Conflicts: []types.Conflict{}, Mappings: []types.Mapping{}, Versions: []types.Version{}}

	// Notes
	for _, n := range payload.Notes {
		if n.SpaceID == 0 {
			continue
		}
		// Create new when no ID provided
		if n.ID == nil {
			if n.Text == nil {
				continue
			}
			// Idempotent create: a retried push (e.g. the response was lost) maps to the existing note.
			if n.ClientID != nil && *n.ClientID != "" {
				var existingID int
				var existingModified time.Time
				err := r.q.QueryRow(`SELECT id, modified_at FROM note WHERE user_id = $1 AND client_id = $2`, userID, *n.ClientID).Scan(&existingID, &existingModified)
				if err == nil {
					resp.Mappings = append(resp.Mappings, types.Mapping{Resource: "note", ClientID: *n.ClientID, ServerID: existingID})
					resp.Versions = append(resp.Versions, types.Version{Resource: "note", ID: existingID, ModifiedAt: existingModified})
					continue
				} else if err != sql.ErrNoRows {
					return nil, err
				}
			}
			parentID, err := r.validParentNote(n.ParentID, n.SpaceID)
			if err != nil {
				return nil, err
			}
			var newID int
			var newModified time.Time
			// Insert note
			err = r.q.QueryRow(`
				INSERT INTO note (user_id, text, created_at, modified_at, date, parent_id, space_id, is_deleted, client_id)
				VALUES ($1, $2, COALESCE($3, NOW()), NOW(), COALESCE($4, NOW()), $5, $6, FALSE, $7)
				RETURNING id, modified_at
			`, userID, *n.Text, n.CreatedAt, n.Date, parentID, n.SpaceID, n.ClientID).Scan(&newID, &newModified)
			if err != nil {
				return nil, err
			}
			// Replace tags
			if err := r.replaceNoteTags(newID, n.Tags, n.SpaceID); err != nil {
				return nil, err
			}
			// Apply nested activities (create or upsert by type within note)
			if len(n.Activities) > 0 {
				for _, a := range n.Activities {
					val, _ := json.Marshal(a.Value)
					// If activity with same type already exists for this note, LWW on modified_at
					var existingID int
					var existingModified time.Time
					err := r.q.QueryRow(`SELECT id, modified_at FROM activities WHERE note_id = $1 AND type_id = $2`, newID, a.TypeID).Scan(&existingID, &existingModified)
					if err == sql.ErrNoRows {
						createdAt := a.CreatedAt
						if createdAt.IsZero() {
							createdAt = time.Now()
						}
						modifiedAt := a.ModifiedAt
						if modifiedAt.IsZero() {
							modifiedAt = createdAt
						}
						isDeleted := a.DeletedAt != nil
						if _, err := r.q.Exec(`
							INSERT INTO activities (user_id, type_id, value, note_id, created_at, modified_at, is_deleted)
							VALUES ($1, $2, $3, $4, $5, $6, $7)
						`, userID, a.TypeID, val, newID, createdAt, modifiedAt, isDeleted); err != nil {
							return nil, err
						}
						resp.Applied++
					} else if err != nil {
						return nil, err
					} else {
						// Update existing by LWW
						if a.ModifiedAt.After(existingModified) {
							_, err := r.q.Exec(`UPDATE activities SET value = $2, is_deleted = $3, modified_at = NOW() WHERE id = $1`, existingID, val, a.DeletedAt != nil)
							if err != nil {
								return nil, err
							}
							resp.Applied++
						} else {
							resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "activity", ID: existingID, Reason: "server-newer"})
						}
					}
				}
			}
			// Apply nested charts (LWW per chart id, same-note only)
			if len(n.Charts) > 0 {
				for _, ch := range n.Charts {
					if ch.ID == 0 {
						continue
					}
					var currentNoteID int
					var currentModified time.Time
					err := r.q.QueryRow(`SELECT note_id, modified_at FROM chart WHERE id = $1`, ch.ID).Scan(&currentNoteID, &currentModified)
					if err == sql.ErrNoRows {
						continue
					} else if err != nil {
						return nil, err
					}
					if currentNoteID != newID {
						continue
					}
					if ch.ModifiedAt.After(currentModified) {
						_, err := r.q.Exec(`UPDATE chart SET name = $2, description = $3, kind = $4, period = $5, activity_type_id = $6, is_deleted = $7, modified_at = NOW() WHERE id = $1`, ch.ID, ch.Name, ch.Description, ch.KindID, ch.PeriodID, ch.ActivityTypeID, ch.DeletedAt != nil)
						if err != nil {
							return nil, err
						}
						resp.Applied++
					} else {
						resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "chart", ID: ch.ID, Reason: "server-newer"})
					}
				}
			}
			resp.Applied++
			if n.ClientID != nil {
				resp.Mappings = append(resp.Mappings, types.Mapping{Resource: "note", ClientID: *n.ClientID, ServerID: newID})
			}
			resp.Versions = append(resp.Versions, types.Version{Resource: "note", ID: newID, ModifiedAt: newModified})
			continue
		}
		// Update existing with LWW
		var serverModified time.Time
		err := r.q.QueryRow(`SELECT modified_at FROM note WHERE id = $1`, *n.ID).Scan(&serverModified)
		if err == sql.ErrNoRows {
			// Treat as create with forced id
			parentID, err := r.validParentNote(n.ParentID, n.SpaceID)
			if err != nil {
				return nil, err
			}
			var newID int
			err = r.q.QueryRow(`
				INSERT INTO note (id, user_id, text, created_at, modified_at, date, parent_id, space_id, is_deleted)
				VALUES ($1, $2, $3, COALESCE($4, NOW()), NOW(), COALESCE($5, NOW()), $6, $7, $8)
				RETURNING id
			`, *n.ID, userID, toString(n.Text), n.CreatedAt, n.Date, parentID, n.SpaceID, n.DeletedAt != nil).Scan(&newID)
			if err != nil {
				return nil, err
			}
			if err := r.replaceNoteTags(newID, n.Tags, n.SpaceID); err != nil {
				return nil, err
			}
			resp.Applied++
			continue
		} else if err != nil {
			return nil, err
		}
		if !serverChangedSince(serverModified, n.ModifiedAt, n.BaseModifiedAt) {
			parentID, err := r.validParentNote(n.ParentID, n.SpaceID)
			if err != nil {
				return nil, err
			}
			var newModified time.Time
			err = r.q.QueryRow(`
                UPDATE note SET text = COALESCE($2, text), date = COALESCE($3, date), parent_id = $4, is_deleted = $5, modified_at = NOW() WHERE id = $1
                RETURNING modified_at
            `, *n.ID, n.Text, n.Date, parentID, n.DeletedAt != nil).Scan(&newModified)
			if err != nil {
				return nil, err
			}
			resp.Versions = append(resp.Versions, types.Version{Resource: "note", ID: *n.ID, ModifiedAt: newModified})
			if err := r.replaceNoteTags(*n.ID, n.Tags, n.SpaceID); err != nil {
				return nil, err
			}
			// Apply nested activities for this note (LWW per activity)
			if len(n.Activities) > 0 {
				for _, a := range n.Activities {
					val, _ := json.Marshal(a.Value)
					if a.ID != 0 {
						var currentNoteID int
						var currentModified time.Time
						err := r.q.QueryRow(`SELECT note_id, modified_at FROM activities WHERE id = $1`, a.ID).Scan(&currentNoteID, &currentModified)
						if err == sql.ErrNoRows {
							continue
						} else if err != nil {
							return nil, err
						}
						if currentNoteID != *n.ID {
							continue
						}
						if a.ModifiedAt.After(currentModified) {
							_, err := r.q.Exec(`UPDATE activities SET value = $2, is_deleted = $3, modified_at = NOW() WHERE id = $1`, a.ID, val, a.DeletedAt != nil)
							if err != nil {
								return nil, err
							}
							resp.Applied++
						} else {
							resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "activity", ID: a.ID, Reason: "server-newer"})
						}
						continue
					}
					// New activity by type for this note
					var existingID int
					var existingModified time.Time
					err := r.q.QueryRow(`SELECT id, modified_at FROM activities WHERE note_id = $1 AND type_id = $2`, *n.ID, a.TypeID).Scan(&existingID, &existingModified)
					if err == sql.ErrNoRows {
						createdAt := a.CreatedAt
						if createdAt.IsZero() {
							createdAt = time.Now()
						}
						modifiedAt := a.ModifiedAt
						if modifiedAt.IsZero() {
							modifiedAt = createdAt
						}
						isDeleted := a.DeletedAt != nil
						if _, err := r.q.Exec(`
							INSERT INTO activities (user_id, type_id, value, note_id, created_at, modified_at, is_deleted)
							VALUES ($1, $2, $3, $4, $5, $6, $7)
						`, userID, a.TypeID, val, *n.ID, createdAt, modifiedAt, isDeleted); err != nil {
							return nil, err
						}
						resp.Applied++
					} else if err != nil {
						return nil, err
					} else {
						if a.ModifiedAt.After(existingModified) {
							_, err := r.q.Exec(`UPDATE activities SET value = $2, is_deleted = $3, modified_at = NOW() WHERE id = $1`, existingID, val, a.DeletedAt != nil)
							if err != nil {
								return nil, err
							}
							resp.Applied++
						} else {
							resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "activity", ID: existingID, Reason: "server-newer"})
						}
					}
				}
			}
			// Apply nested charts for this note (LWW per chart id, same-note only)
			if len(n.Charts) > 0 {
				for _, ch := range n.Charts {
					if ch.ID == 0 {
						continue
					}
					var currentNoteID int
					var currentModified time.Time
					err := r.q.QueryRow(`SELECT note_id, modified_at FROM chart WHERE id = $1`, ch.ID).Scan(&currentNoteID, &currentModified)
					if err == sql.ErrNoRows {
						continue
					} else if err != nil {
						return nil, err
					}
					if currentNoteID != *n.ID {
						continue
					}
					if ch.ModifiedAt.After(currentModified) {
						_, err := r.q.Exec(`UPDATE chart SET name = $2, description = $3, kind = $4, period = $5, activity_type_id = $6, is_deleted = $7, modified_at = NOW() WHERE id = $1`, ch.ID, ch.Name, ch.Description, ch.KindID, ch.PeriodID, ch.ActivityTypeID, ch.DeletedAt != nil)
						if err != nil {
							return nil, err
						}
						resp.Applied++
					} else {
						resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "chart", ID: ch.ID, Reason: "server-newer"})
					}
				}
			}
			// Apply attachment edits if provided: only id, file_name, modified_at, is_deleted
			if len(n.Attachments) > 0 {
				for _, a := range n.Attachments {
					if a.ID == "" {
						continue
					}
					// Verify attachment belongs to note
					var attNoteID int
					err := r.q.QueryRow(`SELECT note_id FROM attachments WHERE id = $1`, a.ID).Scan(&attNoteID)
					if err == sql.ErrNoRows {
						continue
					} else if err != nil {
						return nil, err
					}
					if attNoteID != *n.ID {
						continue
					}
					// Rename if file_name provided
					if a.FileName != "" {
						if _, err := r.q.Exec(`UPDATE attachments SET file_name = $2, modified_at = $3 WHERE id = $1`, a.ID, a.FileName, a.ModifiedAt); err != nil {
							return nil, err
						}
					} else if !a.ModifiedAt.IsZero() {
						// Only touch modified_at to reorder
						if _, err := r.q.Exec(`UPDATE attachments SET modified_at = $2 WHERE id = $1`, a.ID, a.ModifiedAt); err != nil {
							return nil, err
						}
					}
					// Handle soft delete via is_deleted flag
					if a.IsDeleted != nil && *a.IsDeleted {
						// Hard delete attachment record and object metadata only; actual object cleanup can be async/out-of-scope
						if _, err := r.q.Exec(`DELETE FROM attachments WHERE id = $1`, a.ID); err != nil {
							return nil, err
						}
					}
				}
			}
			resp.Applied++
		} else {
			var current models.Note
			err := r.q.QueryRow(`SELECT id, user_id, space_id, text, created_at, modified_at, is_deleted, date, parent_id FROM note WHERE id = $1`, *n.ID).
				Scan(&current.ID, &current.UserID, &current.SpaceID, &current.Text, &current.CreatedAt, &current.ModifiedAt, &current.IsDeleted, &current.Date, new(sql.NullInt64))
			if err == nil {
				var deletedAt *time.Time
				if current.IsDeleted {
					deletedAt = &current.ModifiedAt
				}
				serverTags := []string{}
				if err := r.q.QueryRow(`SELECT COALESCE(ARRAY_AGG(t.name ORDER BY t.name), ARRAY[]::text[]) FROM note_to_tag nt JOIN tag t ON t.id = nt.tag_id WHERE nt.note_id = $1`, current.ID).Scan(pq.Array(&serverTags)); err != nil {
					return nil, err
				}
				server := types.NoteChange{ID: &current.ID, SpaceID: current.SpaceID, UserID: current.UserID, Text: &current.Text, Tags: serverTags, Date: &current.Date, CreatedAt: current.CreatedAt, ModifiedAt: current.ModifiedAt, DeletedAt: deletedAt}
				resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "note", ID: current.ID, Reason: "server-newer", Server: server})
			}
			// Even if note didn't win LWW, apply nested activities independently (LWW per activity)
			if len(n.Activities) > 0 {
				for _, a := range n.Activities {
					val, _ := json.Marshal(a.Value)
					if a.ID != 0 {
						var currentNoteID int
						var currentModified time.Time
						err := r.q.QueryRow(`SELECT note_id, modified_at FROM activities WHERE id = $1`, a.ID).Scan(&currentNoteID, &currentModified)
						if err == sql.ErrNoRows {
							continue
						} else if err != nil {
							return nil, err
						}
						if currentNoteID != *n.ID {
							continue
						}
						if a.ModifiedAt.After(currentModified) {
							_, err := r.q.Exec(`UPDATE activities SET value = $2, is_deleted = $3, modified_at = NOW() WHERE id = $1`, a.ID, val, a.DeletedAt != nil)
							if err != nil {
								return nil, err
							}
							resp.Applied++
						} else {
							resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "activity", ID: a.ID, Reason: "server-newer"})
						}
						continue
					}
					// New activity by type for this note
					var existingID int
					var existingModified time.Time
					err := r.q.QueryRow(`SELECT id, modified_at FROM activities WHERE note_id = $1 AND type_id = $2`, *n.ID, a.TypeID).Scan(&existingID, &existingModified)
					if err == sql.ErrNoRows {
						createdAt := a.CreatedAt
						if createdAt.IsZero() {
							createdAt = time.Now()
						}
						modifiedAt := a.ModifiedAt
						if modifiedAt.IsZero() {
							modifiedAt = createdAt
						}
						isDeleted := a.DeletedAt != nil
						if _, err := r.q.Exec(`
							INSERT INTO activities (user_id, type_id, value, note_id, created_at, modified_at, is_deleted)
							VALUES ($1, $2, $3, $4, $5, $6, $7)
						`, userID, a.TypeID, val, *n.ID, createdAt, modifiedAt, isDeleted); err != nil {
							return nil, err
						}
						resp.Applied++
					} else if err != nil {
						return nil, err
					} else {
						if a.ModifiedAt.After(existingModified) {
							_, err := r.q.Exec(`UPDATE activities SET value = $2, is_deleted = $3, modified_at = NOW() WHERE id = $1`, existingID, val, a.DeletedAt != nil)
							if err != nil {
								return nil, err
							}
							resp.Applied++
						} else {
							resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "activity", ID: existingID, Reason: "server-newer"})
						}
					}
				}
			}
			// Also apply nested charts independently (LWW per chart id, same-note only)
			if len(n.Charts) > 0 {
				for _, ch := range n.Charts {
					if ch.ID == 0 {
						continue
					}
					var currentNoteID int
					var currentModified time.Time
					err := r.q.QueryRow(`SELECT note_id, modified_at FROM chart WHERE id = $1`, ch.ID).Scan(&currentNoteID, &currentModified)
					if err == sql.ErrNoRows {
						continue
					} else if err != nil {
						return nil, err
					}
					if currentNoteID != *n.ID {
						continue
					}
					if ch.ModifiedAt.After(currentModified) {
						_, err := r.q.Exec(`UPDATE chart SET name = $2, description = $3, kind = $4, period = $5, activity_type_id = $6, is_deleted = $7, modified_at = NOW() WHERE id = $1`, ch.ID, ch.Name, ch.Description, ch.KindID, ch.PeriodID, ch.ActivityTypeID, ch.DeletedAt != nil)
						if err != nil {
							return nil, err
						}
						resp.Applied++
					} else {
						resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "chart", ID: ch.ID, Reason: "server-newer"})
					}
				}
			}
		}
	}

	// Filters (create when id is nil; otherwise LWW on name/params/parent)
	for _, f := range payload.Filters {
		if f.ParentID != nil {
			pid, err := r.validParentFilter(f.ParentID, f.SpaceID)
			if err != nil {
				return nil, err
			}
			f.ParentID = pid
		}
		// Create new when no ID provided
		if f.ID == nil {
			// Require spaceId and name; params may be any JSON
			if f.SpaceID == 0 || f.Name == "" {
				continue
			}
			if f.ClientID != nil && *f.ClientID != "" {
				var existingID int
				var existingModified time.Time
				err := r.q.QueryRow(`SELECT id, modified_at FROM filters WHERE user_id = $1 AND client_id = $2`, userID, *f.ClientID).Scan(&existingID, &existingModified)
				if err == nil {
					resp.Mappings = append(resp.Mappings, types.Mapping{Resource: "filter", ClientID: *f.ClientID, ServerID: existingID})
					resp.Versions = append(resp.Versions, types.Version{Resource: "filter", ID: existingID, ModifiedAt: existingModified})
					continue
				} else if err != sql.ErrNoRows {
					return nil, err
				}
			}
			paramsBytes, _ := json.Marshal(f.Params)
			var newID int
			var newModified time.Time
			err := r.q.QueryRow(`
                INSERT INTO filters (user_id, space_id, parent_id, name, params, is_deleted, created_at, modified_at, client_id)
                VALUES ($1, $2, $3, $4, $5, FALSE, COALESCE($6, NOW()), NOW(), $7)
                RETURNING id, modified_at
            `, userID, f.SpaceID, f.ParentID, f.Name, paramsBytes, f.CreatedAt, f.ClientID).Scan(&newID, &newModified)
			if err != nil {
				return nil, err
			}
			resp.Applied++
			if f.ClientID != nil {
				resp.Mappings = append(resp.Mappings, types.Mapping{Resource: "filter", ClientID: *f.ClientID, ServerID: newID})
			}
			resp.Versions = append(resp.Versions, types.Version{Resource: "filter", ID: newID, ModifiedAt: newModified})
			continue
		}

		var serverModified time.Time
		err := r.q.QueryRow(`SELECT modified_at FROM filters WHERE id = $1`, *f.ID).Scan(&serverModified)
		if err == sql.ErrNoRows {
			// Create with forced id to preserve client-known id
			paramsBytes, _ := json.Marshal(f.Params)
			_, err := r.q.Exec(`
                INSERT INTO filters (id, user_id, space_id, parent_id, name, params, is_deleted, created_at, modified_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), NOW())
            `, *f.ID, f.UserID, f.SpaceID, f.ParentID, f.Name, paramsBytes, f.DeletedAt != nil, f.CreatedAt)
			if err != nil {
				return nil, err
			}
			resp.Applied++
			continue
		} else if err != nil {
			return nil, err
		}
		if !serverChangedSince(serverModified, f.ModifiedAt, f.BaseModifiedAt) {
			paramsBytes, _ := json.Marshal(f.Params)
			var newModified time.Time
			err := r.q.QueryRow(`UPDATE filters SET name = $2, parent_id = $3, params = $4, is_deleted = $5, modified_at = NOW() WHERE id = $1 RETURNING modified_at`, *f.ID, f.Name, f.ParentID, paramsBytes, f.DeletedAt != nil).Scan(&newModified)
			if err != nil {
				return nil, err
			}
			resp.Applied++
			resp.Versions = append(resp.Versions, types.Version{Resource: "filter", ID: *f.ID, ModifiedAt: newModified})
		} else {
			resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "filter", ID: *f.ID, Reason: "server-newer"})
		}
	}

	// Charts and Activities unchanged
	for _, ch := range payload.Charts {
		var serverModified time.Time
		err := r.q.QueryRow(`SELECT modified_at FROM chart WHERE id = $1`, ch.ID).Scan(&serverModified)
		if err == sql.ErrNoRows {
			continue
		} else if err != nil {
			return nil, err
		}
		if ch.ModifiedAt.After(serverModified) {
			_, err := r.q.Exec(`UPDATE chart SET name = $2, description = $3, is_deleted = $4, modified_at = NOW() WHERE id = $1`, ch.ID, ch.Name, ch.Description, ch.DeletedAt != nil)
			if err != nil {
				return nil, err
			}
			resp.Applied++
		} else {
			resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "chart", ID: ch.ID, Reason: "server-newer"})
		}
	}
	for _, a := range payload.Activities {
		var serverModified time.Time
		err := r.q.QueryRow(`SELECT modified_at FROM activities WHERE id = $1`, a.ID).Scan(&serverModified)
		if err == sql.ErrNoRows {
			continue
		} else if err != nil {
			return nil, err
		}
		if a.ModifiedAt.After(serverModified) {
			val, _ := json.Marshal(a.Value)
			_, err := r.q.Exec(`UPDATE activities SET value = $2, is_deleted = $3, modified_at = NOW() WHERE id = $1`, a.ID, val, a.DeletedAt != nil)
			if err != nil {
				return nil, err
			}
			resp.Applied++
		} else {
			resp.Conflicts = append(resp.Conflicts, types.Conflict{Resource: "activity", ID: a.ID, Reason: "server-newer"})
		}
	}

	return resp, nil
}

func (r *SyncRepository) replaceNoteTags(noteID int, tags []string, spaceID int) error {
	_, err := r.q.Exec(`DELETE FROM note_to_tag WHERE note_id = $1`, noteID)
	if err != nil {
		return err
	}
	for _, name := range tags {
		var tagID int
		if err := r.q.QueryRow(`INSERT INTO tag (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, name).Scan(&tagID); err != nil {
			return err
		}
		if _, err := r.q.Exec(`INSERT INTO note_to_tag (note_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, noteID, tagID); err != nil {
			return err
		}
		if _, err := r.q.Exec(`INSERT INTO tag_to_space (tag_id, space_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (tag_id, space_id) DO NOTHING`, tagID, spaceID); err != nil {
			return err
		}
	}
	return nil
}

func toString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
