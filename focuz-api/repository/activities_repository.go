package repository

import (
	"database/sql"
	"errors"
	"focuz-api/models"
	"focuz-api/types"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

type ActivitiesRepository struct {
	db *sql.DB
}

func NewActivitiesRepository(db *sql.DB) *ActivitiesRepository {
	return &ActivitiesRepository{db: db}
}

func (r *ActivitiesRepository) CreateActivity(userID, typeID int, value []byte, noteID *int) (*models.Activity, error) {
	if noteID != nil {
		var exists int
		err := r.db.QueryRow(`
			SELECT 1
			FROM activities
			WHERE note_id = $1
			  AND type_id = $2
			  AND is_deleted = FALSE
		`, noteID, typeID).Scan(&exists)
		if err != sql.ErrNoRows {
			if err == nil {
				return nil, errors.New("activity with this type already exists for the given note")
			}
			return nil, err
		}
	}
	var newID int
	now := time.Now()
	err := r.db.QueryRow(`
		INSERT INTO activities (user_id, type_id, value, note_id, created_at, modified_at, is_deleted)
		VALUES ($1, $2, $3, $4, $5, $5, FALSE)
		RETURNING id
	`, userID, typeID, value, noteID, now).Scan(&newID)
	if err != nil {
		return nil, err
	}
	return r.GetActivityByID(newID)
}

func (r *ActivitiesRepository) GetActivityByID(id int) (*models.Activity, error) {
	var a models.Activity
	var rawValue []byte
	var dbNoteID sql.NullInt64
	err := r.db.QueryRow(`
		SELECT id, user_id, type_id, value, note_id, is_deleted, created_at, modified_at
		FROM activities
		WHERE id = $1
	`, id).Scan(
		&a.ID,
		&a.UserID,
		&a.TypeID,
		&rawValue,
		&dbNoteID,
		&a.IsDeleted,
		&a.CreatedAt,
		&a.ModifiedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if dbNoteID.Valid {
		nid := int(dbNoteID.Int64)
		a.NoteID = &nid
	}
	// Value is stored as JSONB; keep raw bytes so handlers can decode appropriately
	a.Value = rawValue
	return &a, nil
}

func (r *ActivitiesRepository) UpdateActivity(id int, newValue []byte, newNoteID *int) error {
	_, err := r.db.Exec(`
		UPDATE activities
		SET value = $1,
		    note_id = $2,
		    modified_at = NOW()
		WHERE id = $3
	`, newValue, newNoteID, id)
	return err
}

func (r *ActivitiesRepository) SetActivityDeleted(id int, isDeleted bool) error {
	_, err := r.db.Exec(`
		UPDATE activities
		SET is_deleted = $1,
		    modified_at = NOW()
		WHERE id = $2
	`, isDeleted, id)
	return err
}

func (r *ActivitiesRepository) GetActivitiesAnalysis(
	spaceID int,
	startDate, endDate *time.Time,
	tags []string,
	at *models.ActivityType,
	periodID int,
) ([]map[string]any, error) {

	periodType := types.GetPeriodTypeByID(periodID)
	if periodType == nil {
		return nil, errors.New("invalid period type")
	}

	groupExpr, dateFormat := buildGroupExpression(periodType.Name)
	aggExpr, err := buildAggregatorExpression(at.ValueType, at.Aggregation)
	if err != nil {
		return nil, err
	}

	var joins []string
	var conds []string
	var params []interface{}
	idx := 1

	joins = append(joins, "JOIN activity_types aty ON a.type_id = aty.id")
	joins = append(joins, "JOIN note n ON a.note_id = n.id")

	conds = append(conds, "a.is_deleted = FALSE")
	conds = append(conds, "aty.is_deleted = FALSE")
	conds = append(conds, "n.is_deleted = FALSE")
	conds = append(conds, "n.space_id = $"+strconv.Itoa(idx))
	params = append(params, spaceID)
	idx++

	conds = append(conds, "a.type_id = $"+strconv.Itoa(idx))
	params = append(params, at.ID)
	idx++

	if startDate != nil {
		conds = append(conds, "n.date >= $"+strconv.Itoa(idx))
		params = append(params, *startDate)
		idx++
	}
	if endDate != nil {
		conds = append(conds, "n.date <= $"+strconv.Itoa(idx))
		params = append(params, *endDate)
		idx++
	}

	// Secure tag filtering: include must contain ALL tags, exclude must contain NONE
	var includeTags []string
	var excludeTags []string
	for _, tag := range tags {
		if tag == "" {
			continue
		}
		if strings.HasPrefix(tag, "!") {
			excludeTags = append(excludeTags, strings.TrimPrefix(tag, "!"))
		} else {
			includeTags = append(includeTags, tag)
		}
	}
	if len(includeTags) > 0 {
		conds = append(conds,
			"(SELECT COUNT(DISTINCT tgn.name) FROM tag tgn JOIN note_to_tag ntn ON ntn.tag_id = tgn.id WHERE ntn.note_id = n.id AND tgn.name = ANY($"+strconv.Itoa(idx)+")) = $"+strconv.Itoa(idx+1),
		)
		params = append(params, pq.Array(includeTags), len(includeTags))
		idx += 2
	}
	if len(excludeTags) > 0 {
		conds = append(conds,
			"NOT EXISTS (SELECT 1 FROM tag xt JOIN note_to_tag xnt ON xnt.tag_id = xt.id WHERE xnt.note_id = n.id AND xt.name = ANY($"+strconv.Itoa(idx)+"))",
		)
		params = append(params, pq.Array(excludeTags))
		idx++
	}

	sqlStr := `
SELECT
  to_char(` + groupExpr + `, '` + dateFormat + `') AS period,
  ` + aggExpr + ` AS value
FROM activities a
`
	for _, j := range joins {
		sqlStr += j + "\n"
	}
	if len(conds) > 0 {
		sqlStr += "WHERE " + strings.Join(conds, " AND ") + "\n"
	}
	sqlStr += "GROUP BY " + groupExpr + " ORDER BY " + groupExpr

	rows, err := r.db.Query(sqlStr, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Ensure non-nil slice so JSON encodes as [] instead of null
	results := make([]map[string]any, 0)
	for rows.Next() {
		var periodStr string
		var val float64
		if err := rows.Scan(&periodStr, &val); err != nil {
			return nil, err
		}
		results = append(results, map[string]any{
			"period": periodStr,
			"value":  val,
		})
	}
	return results, nil
}

func buildGroupExpression(period string) (string, string) {
	switch period {
	case "week":
		return "date_trunc('week', n.date)", "IYYY-\"W\"IW"
	case "month":
		return "date_trunc('month', n.date)", "YYYY-MM"
	case "year":
		return "date_trunc('year', n.date)", "YYYY"
	default:
		return "date_trunc('day', n.date)", "YYYY-MM-DD"
	}
}

func buildAggregatorExpression(valueType, agg string) (string, error) {
	v := strings.ToLower(valueType)
	a := strings.ToLower(agg)
	switch v {
	case "integer", "float":
		switch a {
		case "sum":
			return "SUM((a.value->>'data')::float)", nil
		case "avg":
			return "AVG((a.value->>'data')::float)", nil
		case "count":
			return "COUNT(*)::float", nil
		case "min":
			return "MIN((a.value->>'data')::float)", nil
		case "max":
			return "MAX((a.value->>'data')::float)", nil
		}
	case "boolean":
		switch a {
		case "and":
			return "CASE WHEN bool_and((a.value->>'data')::boolean) THEN 1.0 ELSE 0.0 END", nil
		case "or":
			return "CASE WHEN bool_or((a.value->>'data')::boolean) THEN 1.0 ELSE 0.0 END", nil
		case "count_true":
			return "SUM(CASE WHEN (a.value->>'data')::boolean THEN 1 ELSE 0 END)::float", nil
		case "count_false":
			return "SUM(CASE WHEN NOT (a.value->>'data')::boolean THEN 1 ELSE 0 END)::float", nil
		case "percentage_true":
			return "AVG(CASE WHEN (a.value->>'data')::boolean THEN 1.0 ELSE 0.0 END)*100", nil
		case "percentage_false":
			return "AVG(CASE WHEN NOT (a.value->>'data')::boolean THEN 1.0 ELSE 0.0 END)*100", nil
		}
	case "text":
		if a == "count" {
			return "COUNT(*)::float", nil
		}
	case "time":
		if a == "sum" {
			return "EXTRACT(EPOCH FROM SUM((a.value->>'data')::interval))", nil
		} else if a == "avg" {
			return "EXTRACT(EPOCH FROM AVG((a.value->>'data')::interval))", nil
		} else if a == "count" {
			return "COUNT(*)::float", nil
		} else if a == "min" {
			return "EXTRACT(EPOCH FROM MIN((a.value->>'data')::interval))", nil
		} else if a == "max" {
			return "EXTRACT(EPOCH FROM MAX((a.value->>'data')::interval))", nil
		}
	}
	return "", errors.New("unsupported aggregator for this value type")
}
