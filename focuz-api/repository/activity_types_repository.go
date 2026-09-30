package repository

import (
	"database/sql"
	"errors"
	"focuz-api/models"
	"strings"
	"time"
)

type ActivityTypesRepository struct {
	db *sql.DB
}

func NewActivityTypesRepository(db *sql.DB) *ActivityTypesRepository {
	return &ActivityTypesRepository{db: db}
}

func (r *ActivityTypesRepository) CreateActivityType(name, valueType string, minValue, maxValue *float64, aggregation string, spaceID *int, categoryID *int, unit *string) (*models.ActivityType, error) {
	var id int
	now := time.Now()
	err := r.db.QueryRow(`
		INSERT INTO activity_types (name, value_type, min_value, max_value, aggregation, space_id, category_id, unit, created_at, modified_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
		RETURNING id
	`, name, valueType, minValue, maxValue, aggregation, spaceID, categoryID, unit, now).Scan(&id)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate key") {
			return nil, errors.New("name conflict in this space")
		}
		return nil, err
	}
	return r.GetActivityTypeByID(id)
}

func (r *ActivityTypesRepository) GetActivityTypeByID(id int) (*models.ActivityType, error) {
	var a models.ActivityType
	var spaceID sql.NullInt64
	var categoryID sql.NullInt64
	var minVal sql.NullFloat64
	var maxVal sql.NullFloat64
	var unit sql.NullString
	err := r.db.QueryRow(`
		SELECT id, name, value_type, min_value, max_value, aggregation, space_id, is_default, is_deleted, unit, category_id, created_at, modified_at
		FROM activity_types
		WHERE id = $1
	`, id).Scan(
		&a.ID,
		&a.Name,
		&a.ValueType,
		&minVal,
		&maxVal,
		&a.Aggregation,
		&spaceID,
		&a.IsDefault,
		&a.IsDeleted,
		&unit,
		&categoryID,
		&a.CreatedAt,
		&a.ModifiedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if spaceID.Valid {
		a.SpaceID = int(spaceID.Int64)
	}
	if categoryID.Valid {
		a.CategoryID = int(categoryID.Int64)
	}
	if minVal.Valid {
		f := minVal.Float64
		a.MinValue = &f
	}
	if maxVal.Valid {
		f := maxVal.Float64
		a.MaxValue = &f
	}
	if unit.Valid {
		u := unit.String
		a.Unit = &u
	}
	return &a, nil
}

func (r *ActivityTypesRepository) UpdateActivityTypeDeleted(id int, isDeleted bool) error {
	_, err := r.db.Exec(`
		UPDATE activity_types
		SET is_deleted = $1, modified_at = NOW()
		WHERE id = $2
	`, isDeleted, id)
	return err
}

// New method
func (r *ActivityTypesRepository) GetActivityTypesBySpace(spaceID int) ([]*models.ActivityType, error) {
	rows, err := r.db.Query(`
		SELECT id, name, value_type, min_value, max_value, aggregation, space_id, is_default, is_deleted, unit, category_id, created_at, modified_at
		FROM activity_types
		WHERE 
			is_deleted = false
			AND (
				(is_default = true AND space_id IS NULL)
				OR (space_id = $1)
			)
		ORDER BY id
	`, spaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*models.ActivityType
	for rows.Next() {
		var a models.ActivityType
		var dbSpaceID sql.NullInt64
		var categoryID sql.NullInt64
		var minVal sql.NullFloat64
		var maxVal sql.NullFloat64
		var unit sql.NullString

		err := rows.Scan(
			&a.ID,
			&a.Name,
			&a.ValueType,
			&minVal,
			&maxVal,
			&a.Aggregation,
			&dbSpaceID,
			&a.IsDefault,
			&a.IsDeleted,
			&unit,
			&categoryID,
			&a.CreatedAt,
			&a.ModifiedAt,
		)
		if err != nil {
			return nil, err
		}
		if dbSpaceID.Valid {
			a.SpaceID = int(dbSpaceID.Int64)
		}
		if categoryID.Valid {
			a.CategoryID = int(categoryID.Int64)
		}
		if minVal.Valid {
			f := minVal.Float64
			a.MinValue = &f
		}
		if maxVal.Valid {
			f := maxVal.Float64
			a.MaxValue = &f
		}
		if unit.Valid {
			u := unit.String
			a.Unit = &u
		}
		result = append(result, &a)
	}
	return result, nil
}

func (r *ActivityTypesRepository) GetActivityTypesBySpacePaginated(spaceID, offset, limit int) ([]*models.ActivityType, int, error) {
	// Get total count
	var total int
	err := r.db.QueryRow(`
		SELECT COUNT(*)
		FROM activity_types
		WHERE 
			is_deleted = false
			AND (
				(is_default = true AND space_id IS NULL)
				OR (space_id = $1)
			)
	`, spaceID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Get data with pagination
	rows, err := r.db.Query(`
		SELECT id, name, value_type, min_value, max_value, aggregation, space_id, is_default, is_deleted, unit, category_id, created_at, modified_at
		FROM activity_types
		WHERE 
			is_deleted = false
			AND (
				(is_default = true AND space_id IS NULL)
				OR (space_id = $1)
			)
		ORDER BY id
		LIMIT $2 OFFSET $3
	`, spaceID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []*models.ActivityType
	for rows.Next() {
		var a models.ActivityType
		var dbSpaceID sql.NullInt64
		var categoryID sql.NullInt64
		var minVal sql.NullFloat64
		var maxVal sql.NullFloat64
		var unit sql.NullString

		err := rows.Scan(
			&a.ID,
			&a.Name,
			&a.ValueType,
			&minVal,
			&maxVal,
			&a.Aggregation,
			&dbSpaceID,
			&a.IsDefault,
			&a.IsDeleted,
			&unit,
			&categoryID,
			&a.CreatedAt,
			&a.ModifiedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		if dbSpaceID.Valid {
			a.SpaceID = int(dbSpaceID.Int64)
		}
		if categoryID.Valid {
			a.CategoryID = int(categoryID.Int64)
		}
		if minVal.Valid {
			f := minVal.Float64
			a.MinValue = &f
		}
		if maxVal.Valid {
			f := maxVal.Float64
			a.MaxValue = &f
		}
		if unit.Valid {
			u := unit.String
			a.Unit = &u
		}
		result = append(result, &a)
	}
	return result, total, nil
}
