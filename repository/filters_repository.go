package repository

import (
	"database/sql"
	"encoding/json"
	"focuz-api/models"
)

type FiltersRepository struct {
	db *sql.DB
}

func NewFiltersRepository(db *sql.DB) *FiltersRepository {
	return &FiltersRepository{db: db}
}

func (r *FiltersRepository) CreateFilter(userID, spaceID int, name string, parentID *int, params json.RawMessage) (*models.Filter, error) {
	var id int
	err := r.db.QueryRow(`
		INSERT INTO filters (user_id, space_id, parent_id, name, params, is_deleted, created_at, modified_at)
		VALUES ($1, $2, $3, $4, $5, FALSE, NOW(), NOW())
		RETURNING id
	`, userID, spaceID, parentID, name, params).Scan(&id)
	if err != nil {
		return nil, err
	}
	return r.GetByID(id)
}

func (r *FiltersRepository) UpdateFilter(id int, name *string, parentID *int, params *json.RawMessage) error {
	// Update dynamic fields; set modified_at
	// We update only provided fields by coalescing to current values
	_, err := r.db.Exec(`
		UPDATE filters SET
			name = COALESCE($2, name),
			parent_id = $3,
			params = COALESCE($4, params),
			modified_at = NOW()
		WHERE id = $1 AND is_deleted = FALSE
	`, id, name, parentID, params)
	return err
}

func (r *FiltersRepository) SetDeleted(id int, isDeleted bool) error {
	_, err := r.db.Exec(`
		UPDATE filters SET is_deleted = $2, modified_at = NOW() WHERE id = $1
	`, id, isDeleted)
	return err
}

func (r *FiltersRepository) GetByID(id int) (*models.Filter, error) {
	var f models.Filter
	var parentID sql.NullInt64
	err := r.db.QueryRow(`
		SELECT id, user_id, space_id, parent_id, name, params, is_deleted, created_at, modified_at
		FROM filters WHERE id = $1
	`, id).Scan(&f.ID, &f.UserID, &f.SpaceID, &parentID, &f.Name, &f.Params, &f.IsDeleted, &f.CreatedAt, &f.ModifiedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if parentID.Valid {
		pid := int(parentID.Int64)
		f.ParentID = &pid
	}
	return &f, nil
}

// List returns the user's own folders in a space (folders are personal).
func (r *FiltersRepository) List(spaceID, userID int, page, pageSize int) ([]*models.Filter, int, error) {
	offset := (page - 1) * pageSize
	rows, err := r.db.Query(`
		SELECT id, user_id, space_id, parent_id, name, params, is_deleted, created_at, modified_at
		FROM filters
		WHERE space_id = $1 AND user_id = $4 AND is_deleted = FALSE
		ORDER BY id
		LIMIT $2 OFFSET $3
	`, spaceID, pageSize, offset, userID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*models.Filter
	for rows.Next() {
		var f models.Filter
		var parentID sql.NullInt64
		if err := rows.Scan(&f.ID, &f.UserID, &f.SpaceID, &parentID, &f.Name, &f.Params, &f.IsDeleted, &f.CreatedAt, &f.ModifiedAt); err != nil {
			return nil, 0, err
		}
		if parentID.Valid {
			pid := int(parentID.Int64)
			f.ParentID = &pid
		}
		items = append(items, &f)
	}

	var total int
	err = r.db.QueryRow(`SELECT COUNT(*) FROM filters WHERE space_id = $1 AND user_id = $2 AND is_deleted = FALSE`, spaceID, userID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}
