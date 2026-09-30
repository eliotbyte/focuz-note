package repository

import (
	"database/sql"
	"encoding/json"
	"focuz-api/initializers"
	"focuz-api/models"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"

	"golang.org/x/crypto/bcrypt"
)

type NotesRepository struct {
	db *sql.DB
}

func NewNotesRepository(db *sql.DB) *NotesRepository {
	return &NotesRepository{db: db}
}

func (r *NotesRepository) CreateUser(username, password string) (*models.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	// Convert username to lowercase for case-insensitive storage
	lowercaseUsername := strings.ToLower(username)
	var user models.User
	err = r.db.QueryRow(`
		INSERT INTO users (username, password_hash)
		VALUES ($1, $2)
		RETURNING id, username, created_at
	`, lowercaseUsername, string(hash)).Scan(&user.ID, &user.Username, &user.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *NotesRepository) GetUserByUsername(username string) (*models.User, error) {
	var user models.User
	// Convert username to lowercase for case-insensitive search
	lowercaseUsername := strings.ToLower(username)
	err := r.db.QueryRow(`
		SELECT id, username, password_hash, created_at
		FROM users
		WHERE username = $1
	`, lowercaseUsername).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *NotesRepository) CreateNote(userID int, text string, tags []string, parentID *int, date *string, spaceID int) (*models.Note, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var noteDate time.Time
	if date != nil {
		parsed, parseErr := time.Parse(time.RFC3339, *date)
		if parseErr == nil {
			noteDate = parsed
		} else {
			noteDate = time.Now()
		}
	} else {
		noteDate = time.Now()
	}

	var noteID int
	err = tx.QueryRow(`
		INSERT INTO note (user_id, text, created_at, modified_at, date, parent_id, space_id)
		VALUES ($1, $2, NOW(), NOW(), $3, $4, $5)
		RETURNING id
	`, userID, text, noteDate, parentID, spaceID).Scan(&noteID)
	if err != nil {
		return nil, err
	}

	// Process tags if provided
	if tags != nil {
		for _, tagName := range tags {
			var tagID int
			err = tx.QueryRow(`
				INSERT INTO tag (name) VALUES ($1)
				ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
				RETURNING id
			`, tagName).Scan(&tagID)
			if err != nil {
				return nil, err
			}

			// Create note_to_tag entry
			_, err = tx.Exec(`
				INSERT INTO note_to_tag (note_id, tag_id)
				VALUES ($1, $2)
				ON CONFLICT DO NOTHING
			`, noteID, tagID)
			if err != nil {
				return nil, err
			}

			// Create tag_to_space entry
			_, err = tx.Exec(`
				INSERT INTO tag_to_space (tag_id, space_id)
				VALUES ($1, $2)
				ON CONFLICT (tag_id, space_id) DO NOTHING
			`, tagID, spaceID)
			if err != nil {
				return nil, err
			}
		}
	}

	if parentID != nil {
		// Get all parent IDs in the chain
		var parentIDs []int
		currentID := *parentID
		for {
			var parentID sql.NullInt64
			err = tx.QueryRow(`
				SELECT parent_id FROM note WHERE id = $1
			`, currentID).Scan(&parentID)
			if err != nil {
				return nil, err
			}

			parentIDs = append(parentIDs, currentID)

			if !parentID.Valid {
				break
			}
			currentID = int(parentID.Int64)
		}

		// Update reply_count for all parents
		for _, pid := range parentIDs {
			_, err = tx.Exec(`
				UPDATE note SET reply_count = reply_count + 1
				WHERE id = $1
			`, pid)
			if err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	// Get the complete note with tags
	note, err := r.GetNoteByID(noteID)
	if err != nil {
		return nil, err
	}

	return note, nil
}

func (r *NotesRepository) UpdateNoteDeleted(id int, isDeleted bool) error {
	_, err := r.db.Exec(`
		UPDATE note SET is_deleted = $1, modified_at = NOW()
		WHERE id = $2
	`, isDeleted, id)
	return err
}

// TouchNoteModified updates note.modified_at to NOW() without changing other fields.
func (r *NotesRepository) TouchNoteModified(noteID int) error {
	_, err := r.db.Exec(`UPDATE note SET modified_at = NOW() WHERE id = $1`, noteID)
	return err
}

func (r *NotesRepository) GetNoteByID(id int) (*models.Note, error) {
	var note models.Note
	var parentID sql.NullInt64
	var parentText sql.NullString
	err := r.db.QueryRow(`
		SELECT n.id, n.user_id, n.text, n.created_at, n.modified_at, n.date,
		       n.parent_id, n.reply_count, n.is_deleted, n.space_id,
		       p.text AS parent_text
		FROM note n
		LEFT JOIN note p ON n.parent_id = p.id
		WHERE n.id = $1
	`, id).Scan(
		&note.ID,
		&note.UserID,
		&note.Text,
		&note.CreatedAt,
		&note.ModifiedAt,
		&note.Date,
		&parentID,
		&note.ReplyCount,
		&note.IsDeleted,
		&note.SpaceID,
		&parentText,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if parentID.Valid {
		note.Parent = &models.ParentNote{
			ID:   int(parentID.Int64),
			Text: truncate(parentText.String, 20),
		}
	}
	tagRows, err := r.db.Query(`
		SELECT t.name FROM tag t
		JOIN note_to_tag nt ON t.id = nt.tag_id
		WHERE nt.note_id = $1
	`, id)
	if err != nil {
		return nil, err
	}
	defer tagRows.Close()
	for tagRows.Next() {
		var tag string
		if err := tagRows.Scan(&tag); err != nil {
			return nil, err
		}
		note.Tags = append(note.Tags, tag)
	}
	activities, err := r.getActivitiesForNote(note.ID)
	if err != nil {
		return nil, err
	}
	note.Activities = activities
	attRows, err := r.db.Query(`
		SELECT id, file_name, file_type, file_size
		FROM attachments
		WHERE note_id = $1
	`, note.ID)
	if err != nil {
		return nil, err
	}
	defer attRows.Close()
	var attachments []models.Attachment
	for attRows.Next() {
		var att models.Attachment
		if err := attRows.Scan(&att.ID, &att.FileName, &att.FileType, &att.FileSize); err != nil {
			return nil, err
		}
		url, err := initializers.GenerateAttachmentURL(att.ID, att.FileName)
		if err != nil {
			return nil, err
		}
		att.URL = url
		attachments = append(attachments, att)
	}
	note.Attachments = attachments
	return &note, nil
}

func (r *NotesRepository) GetNotes(userID, spaceID int, filters models.NoteFilters) ([]*models.Note, int, error) {
	offset := (filters.Page - 1) * filters.PageSize
	var conditions []string
	var params []interface{}
	idx := 1
	conditions = append(conditions, "n.is_deleted = FALSE")
	conditions = append(conditions, "n.space_id = $"+strconv.Itoa(idx))
	params = append(params, spaceID)
	idx++
	if filters.ParentID != nil {
		conditions = append(conditions, "n.parent_id = $"+strconv.Itoa(idx))
		params = append(params, *filters.ParentID)
		idx++
	} else if filters.NotReply {
		conditions = append(conditions, "n.parent_id IS NULL")
	}

	// Add date filters
	if filters.DateFrom != nil {
		conditions = append(conditions, "n.date >= $"+strconv.Itoa(idx))
		params = append(params, *filters.DateFrom)
		idx++
	}
	if filters.DateTo != nil {
		conditions = append(conditions, "n.date <= $"+strconv.Itoa(idx))
		params = append(params, *filters.DateTo)
		idx++
	}

	query := `
		SELECT 
		  n.id, n.user_id, n.text, n.created_at, n.modified_at, n.date,
		  n.parent_id, p.text AS parent_text, n.reply_count, n.is_deleted, n.space_id,
		  COALESCE((SELECT ARRAY_AGG(DISTINCT t2.name)
		           FROM tag t2 JOIN note_to_tag nt2 ON nt2.tag_id = t2.id
		           WHERE nt2.note_id = n.id), ARRAY[]::text[]) AS tags,
		  COALESCE((
		    SELECT json_agg(json_build_object(
		      'id', a.id,
		      'typeId', a.type_id,
		      'value', a.value->>'data',
		      'unit', at.unit
		    ) ORDER BY a.id)
		    FROM activities a JOIN activity_types at ON a.type_id = at.id
		    WHERE a.note_id = n.id AND a.is_deleted = FALSE
		  ), '[]'::json) AS activities,
		  COALESCE((
		    SELECT json_agg(json_build_object(
		      'id', att.id,
		      'fileName', att.file_name,
		      'fileType', att.file_type,
		      'fileSize', att.file_size
		    ) ORDER BY att.id)
		    FROM attachments att WHERE att.note_id = n.id
		  ), '[]'::json) AS attachments
		FROM note n
		LEFT JOIN note p ON n.parent_id = p.id
	`

	// Process tags with include/exclude logic safely (parameterized)
	var includeTags []string
	var excludeTags []string
	for _, tag := range filters.Tags {
		if strings.HasPrefix(tag, "!") {
			excludeTags = append(excludeTags, strings.TrimPrefix(tag, "!"))
		} else if tag != "" {
			includeTags = append(includeTags, tag)
		}
	}

	// Include: note must contain ALL includeTags
	if len(includeTags) > 0 {
		// Count distinct matched tags for this note and compare with number of includeTags
		conditions = append(conditions,
			"(SELECT COUNT(DISTINCT t.name) FROM tag t JOIN note_to_tag nt ON nt.tag_id = t.id WHERE nt.note_id = n.id AND t.name = ANY($"+strconv.Itoa(idx)+")) = $"+strconv.Itoa(idx+1),
		)
		params = append(params, pq.Array(includeTags), len(includeTags))
		idx += 2
	}
	// Exclude: note must NOT have any of excludeTags
	if len(excludeTags) > 0 {
		conditions = append(conditions,
			"NOT EXISTS (SELECT 1 FROM tag xt JOIN note_to_tag xnt ON xnt.tag_id = xt.id WHERE xnt.note_id = n.id AND xt.name = ANY($"+strconv.Itoa(idx)+"))",
		)
		params = append(params, pq.Array(excludeTags))
		idx++
	}

	if len(conditions) > 0 {
		query += " WHERE " + joinConditions(conditions, " AND ")
	}

	sortField := "n.created_at"
	switch strings.ToLower(filters.SortField) {
	case "created_at", "createdat":
		sortField = "n.created_at"
	case "modified_at", "modifiedat":
		sortField = "n.modified_at"
	}
	order := strings.ToUpper(filters.SortOrder)
	if order != "ASC" && order != "DESC" {
		order = "DESC"
	}
	query += " ORDER BY " + sortField + " " + order
	query += " LIMIT $" + strconv.Itoa(idx) + " OFFSET $" + strconv.Itoa(idx+1)
	params = append(params, filters.PageSize, offset)

	rows, err := r.db.Query(query, params...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var notes []*models.Note
	for rows.Next() {
		var note models.Note
		var parentID sql.NullInt64
		var parentText sql.NullString
		var tags pq.StringArray
		var activitiesJSON []byte
		var attachmentsJSON []byte
		err := rows.Scan(
			&note.ID,
			&note.UserID,
			&note.Text,
			&note.CreatedAt,
			&note.ModifiedAt,
			&note.Date,
			&parentID,
			&parentText,
			&note.ReplyCount,
			&note.IsDeleted,
			&note.SpaceID,
			&tags,
			&activitiesJSON,
			&attachmentsJSON,
		)
		if err != nil {
			return nil, 0, err
		}
		if parentID.Valid {
			note.Parent = &models.ParentNote{ID: int(parentID.Int64), Text: truncate(parentText.String, 20)}
		}
		note.Tags = append([]string{}, tags...)

		// Unmarshal activities
		if len(activitiesJSON) > 0 {
			var acts []models.NoteActivity
			if err := json.Unmarshal(activitiesJSON, &acts); err != nil {
				return nil, 0, err
			}
			note.Activities = acts
		}
		// Unmarshal attachments and add URLs
		if len(attachmentsJSON) > 0 {
			var atts []models.Attachment
			if err := json.Unmarshal(attachmentsJSON, &atts); err != nil {
				return nil, 0, err
			}
			for i := range atts {
				url, uerr := initializers.GenerateAttachmentURL(atts[i].ID, atts[i].FileName)
				if uerr != nil {
					return nil, 0, uerr
				}
				atts[i].URL = url
			}
			note.Attachments = atts
		}
		notes = append(notes, &note)
	}

	var total int
	countQuery := `
		SELECT COUNT(n.id)
		FROM note n
	`
	if len(conditions) > 0 {
		countQuery += " WHERE " + joinConditions(conditions, " AND ")
	}
	// Reuse the same params without limit/offset for count
	err = r.db.QueryRow(countQuery, params[:len(params)-2]...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	return notes, total, nil
}

func (r *NotesRepository) getActivitiesForNote(noteID int) ([]models.NoteActivity, error) {
	rows, err := r.db.Query(`
		SELECT a.id, a.type_id, a.value->>'data', at.unit
		FROM activities a
		JOIN activity_types at ON a.type_id = at.id
		WHERE a.note_id = $1
		  AND a.is_deleted = FALSE
	`, noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []models.NoteActivity
	for rows.Next() {
		var item models.NoteActivity
		var val string
		if err := rows.Scan(&item.ID, &item.TypeID, &val, &item.Unit); err != nil {
			return nil, err
		}
		item.Value = val
		result = append(result, item)
	}
	return result, nil
}

func joinConditions(conds []string, sep string) string {
	result := ""
	for i, c := range conds {
		if i == 0 {
			result = c
		} else {
			result += sep + c
		}
	}
	return result
}

func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max]
	}
	return s
}

type TagAutocomplete struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func (r *NotesRepository) GetTagAutocomplete(text string, spaceID int) ([]TagAutocomplete, error) {
	query := `
		SELECT DISTINCT t.id, t.name
		FROM tag t
		JOIN note_to_tag nt ON t.id = nt.tag_id
		JOIN note n ON nt.note_id = n.id
		WHERE n.space_id = $1
		AND ($2 = '' OR t.name ILIKE $2 || '%')
		ORDER BY t.name
		LIMIT 10
	`
	rows, err := r.db.Query(query, spaceID, text)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []TagAutocomplete
	for rows.Next() {
		var tag TagAutocomplete
		if err := rows.Scan(&tag.ID, &tag.Name); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, nil
}
