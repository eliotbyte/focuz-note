package initializers

import (
	"database/sql"
	"focuz-api/globals"
)

func InitDefaults(db *sql.DB) error {
	ownerID, err := ensureRole(db, "owner")
	if err != nil {
		return err
	}
	guestID, err := ensureRole(db, "guest")
	if err != nil {
		return err
	}
	adminID, err := ensureRole(db, "admin")
	if err != nil {
		return err
	}
	editorID, err := ensureRole(db, "editor")
	if err != nil {
		return err
	}
	globals.DefaultOwnerRoleID = ownerID
	globals.DefaultGuestRoleID = guestID
	globals.DefaultAdminRoleID = adminID
	globals.DefaultEditorRoleID = editorID

	healthID, err := ensureCategory(db, "health")
	if err != nil {
		return err
	}
	financeID, err := ensureCategory(db, "finance")
	if err != nil {
		return err
	}
	globals.DefaultHealthCatID = healthID
	globals.DefaultFinanceCatID = financeID

	if _, err := ensureActivityType(db, "mood", "integer", 1.0, 10.0, "avg", nil, healthID, nil, true); err != nil {
		return err
	}
	if _, err := ensureActivityType(db, "steps", "integer", 0.0, nil, "sum", nil, healthID, nil, true); err != nil {
		return err
	}
	if _, err := ensureActivityType(db, "sleep", "time", 0.0, nil, "sum", nil, healthID, nil, true); err != nil {
		return err
	}

	return nil
}

func ensureRole(db *sql.DB, name string) (int, error) {
	var id int
	err := db.QueryRow("SELECT id FROM role WHERE name = $1", name).Scan(&id)
	if err == sql.ErrNoRows {
		err = db.QueryRow("INSERT INTO role (name) VALUES ($1) RETURNING id", name).Scan(&id)
		if err != nil {
			return 0, err
		}
	} else if err != nil {
		return 0, err
	}
	return id, nil
}

func ensureCategory(db *sql.DB, name string) (int, error) {
	var id int
	err := db.QueryRow("SELECT id FROM activity_type_category WHERE name = $1", name).Scan(&id)
	if err == sql.ErrNoRows {
		err = db.QueryRow("INSERT INTO activity_type_category (name) VALUES ($1) RETURNING id", name).Scan(&id)
		if err != nil {
			return 0, err
		}
	} else if err != nil {
		return 0, err
	}
	return id, nil
}

func ensureActivityType(
	db *sql.DB,
	name, valueType string,
	minValue, maxValue interface{},
	aggregation string,
	spaceID, categoryID interface{},
	unit interface{},
	isDefault bool,
) (int, error) {
	var id int
	query := `
	  SELECT id FROM activity_types 
	  WHERE name = $1 
	    AND ((space_id = $2) OR (space_id IS NULL AND $2 IS NULL))
	`
	err := db.QueryRow(query, name, spaceID).Scan(&id)
	if err == sql.ErrNoRows {
		insertSQL := `
			INSERT INTO activity_types 
				(name, value_type, min_value, max_value, aggregation, space_id, category_id, unit, is_default)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			RETURNING id
		`
		err = db.QueryRow(insertSQL,
			name, valueType, minValue, maxValue, aggregation, spaceID, categoryID, unit, isDefault,
		).Scan(&id)
		if err != nil {
			return 0, err
		}
	} else if err != nil {
		return 0, err
	}
	return id, nil
}
