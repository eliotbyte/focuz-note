package repository

import (
	"database/sql"
	"strconv"
	"strings"
	"time"

	"focuz-api/models"
)

// Metrics: reads over activities for people and agents. A value counts only while its note is live.

// MetricValue turns the stored text of a value into a JSON number or boolean where the type says so.
func MetricValue(valueType, raw string) any {
	switch valueType {
	case "integer", "float":
		if f, err := strconv.ParseFloat(raw, 64); err == nil {
			return f
		}
	case "boolean":
		if b, err := strconv.ParseBool(raw); err == nil {
			return b
		}
	}
	return raw
}

// usableTypesSQL: built-in types and the space's own (space id is $1).
const usableTypesSQL = `t.is_deleted = FALSE AND ((t.is_default = TRUE AND t.space_id IS NULL) OR t.space_id = $1)`

// ListMetrics returns the metrics of a space with the number of values and the last two of them.
func (r *ActivitiesRepository) ListMetrics(spaceID int) ([]models.Metric, error) {
	rows, err := r.db.Query(`
		WITH e AS (
			SELECT a.id, a.type_id, a.value->>'data' AS value, n.date, n.id AS note_id,
			       ROW_NUMBER() OVER (PARTITION BY a.type_id ORDER BY n.date DESC, a.id DESC) AS rn,
			       COUNT(*) OVER (PARTITION BY a.type_id) AS cnt,
			       MIN(n.date) OVER (PARTITION BY a.type_id) AS first_date
			FROM activities a JOIN note n ON n.id = a.note_id
			WHERE a.is_deleted = FALSE AND n.is_deleted = FALSE AND n.space_id = $1
		)
		SELECT t.id, t.name, t.value_type, t.unit, t.aggregation, t.min_value, t.max_value, t.is_default,
		       COALESCE(MAX(e.cnt), 0), MAX(e.first_date),
		       MAX(CASE WHEN e.rn = 1 THEN e.id END), MAX(CASE WHEN e.rn = 1 THEN e.note_id END),
		       MAX(CASE WHEN e.rn = 1 THEN e.date END), MAX(CASE WHEN e.rn = 1 THEN e.value END),
		       MAX(CASE WHEN e.rn = 2 THEN e.id END), MAX(CASE WHEN e.rn = 2 THEN e.note_id END),
		       MAX(CASE WHEN e.rn = 2 THEN e.date END), MAX(CASE WHEN e.rn = 2 THEN e.value END)
		FROM activity_types t
		LEFT JOIN e ON e.type_id = t.id AND e.rn <= 2
		WHERE `+usableTypesSQL+`
		GROUP BY t.id
		ORDER BY lower(t.name)
	`, spaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.Metric, 0)
	for rows.Next() {
		var m models.Metric
		var unit sql.NullString
		var minV, maxV sql.NullFloat64
		var first sql.NullTime
		var e [2]struct {
			id, noteID sql.NullInt64
			date       sql.NullTime
			value      sql.NullString
		}
		if err := rows.Scan(&m.ID, &m.Name, &m.ValueType, &unit, &m.Aggregation, &minV, &maxV, &m.BuiltIn,
			&m.Count, &first,
			&e[0].id, &e[0].noteID, &e[0].date, &e[0].value,
			&e[1].id, &e[1].noteID, &e[1].date, &e[1].value); err != nil {
			return nil, err
		}
		if unit.Valid {
			m.Unit = &unit.String
		}
		if minV.Valid {
			m.MinValue = &minV.Float64
		}
		if maxV.Valid {
			m.MaxValue = &maxV.Float64
		}
		if first.Valid {
			m.FirstDate = &first.Time
		}
		for i, it := range e {
			if !it.id.Valid {
				continue
			}
			entry := &models.MetricEntry{
				ID: int(it.id.Int64), NoteID: int(it.noteID.Int64), Date: it.date.Time,
				Value: MetricValue(m.ValueType, it.value.String),
			}
			if i == 0 {
				m.Last = entry
			} else {
				m.Previous = entry
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// FindMetric finds a usable type in a space by name, ignoring case; the space's own wins over a
// built-in one with the same name. Nil when there is none.
func (r *ActivitiesRepository) FindMetric(spaceID int, name string) (*models.ActivityType, error) {
	var id int
	err := r.db.QueryRow(`
		SELECT t.id FROM activity_types t
		WHERE `+usableTypesSQL+` AND lower(t.name) = lower($2)
		ORDER BY t.space_id IS NULL, t.id
		LIMIT 1
	`, spaceID, strings.TrimSpace(name)).Scan(&id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return NewActivityTypesRepository(r.db).GetActivityTypeByID(id)
}

// HasDeletedMetric tells whether the space has a deleted type with this name (it still holds the name).
func (r *ActivitiesRepository) HasDeletedMetric(spaceID int, name string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(`
		SELECT EXISTS (SELECT 1 FROM activity_types WHERE space_id = $1 AND is_deleted = TRUE AND lower(name) = lower($2))
	`, spaceID, strings.TrimSpace(name)).Scan(&exists)
	return exists, err
}

// MetricEntries returns the values of one metric in a space, newest first unless oldestFirst.
// from is inclusive, to is exclusive; both are optional.
func (r *ActivitiesRepository) MetricEntries(spaceID int, t *models.ActivityType, from, to *time.Time, limit int, oldestFirst bool) ([]models.MetricEntry, error) {
	conds, params := metricRange(spaceID, t.ID, from, to)
	order := "DESC"
	if oldestFirst {
		order = "ASC"
	}
	params = append(params, limit)
	rows, err := r.db.Query(`
		SELECT a.id, n.id, n.date, a.value->>'data', left(n.text, 200)
		FROM activities a JOIN note n ON n.id = a.note_id
		WHERE `+conds+`
		ORDER BY n.date `+order+`, a.id `+order+`
		LIMIT $`+strconv.Itoa(len(params)), params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.MetricEntry, 0)
	for rows.Next() {
		var e models.MetricEntry
		var raw string
		if err := rows.Scan(&e.ID, &e.NoteID, &e.Date, &raw, &e.Note); err != nil {
			return nil, err
		}
		e.Value = MetricValue(t.ValueType, raw)
		out = append(out, e)
	}
	return out, rows.Err()
}

// MetricStats sums up every value of a metric in the range; min, max, avg and sum only for numbers.
func (r *ActivitiesRepository) MetricStats(spaceID int, t *models.ActivityType, from, to *time.Time) (models.MetricStats, error) {
	conds, params := metricRange(spaceID, t.ID, from, to)
	var s models.MetricStats
	if t.ValueType != "integer" && t.ValueType != "float" {
		err := r.db.QueryRow(`SELECT COUNT(*) FROM activities a JOIN note n ON n.id = a.note_id WHERE `+conds, params...).Scan(&s.Count)
		return s, err
	}
	var minV, maxV, avg, sum sql.NullFloat64
	err := r.db.QueryRow(`
		SELECT COUNT(*), MIN((a.value->>'data')::float), MAX((a.value->>'data')::float),
		       AVG((a.value->>'data')::float), SUM((a.value->>'data')::float)
		FROM activities a JOIN note n ON n.id = a.note_id
		WHERE `+conds, params...).Scan(&s.Count, &minV, &maxV, &avg, &sum)
	if err != nil {
		return s, err
	}
	for _, p := range []struct {
		v   sql.NullFloat64
		dst **float64
	}{{minV, &s.Min}, {maxV, &s.Max}, {avg, &s.Avg}, {sum, &s.Sum}} {
		if p.v.Valid {
			f := p.v.Float64
			*p.dst = &f
		}
	}
	return s, nil
}

func metricRange(spaceID, typeID int, from, to *time.Time) (string, []any) {
	conds := []string{"a.type_id = $1", "n.space_id = $2", "a.is_deleted = FALSE", "n.is_deleted = FALSE"}
	params := []any{typeID, spaceID}
	if from != nil {
		params = append(params, *from)
		conds = append(conds, "n.date >= $"+strconv.Itoa(len(params)))
	}
	if to != nil {
		params = append(params, *to)
		conds = append(conds, "n.date < $"+strconv.Itoa(len(params)))
	}
	return strings.Join(conds, " AND "), params
}

// SetNoteValue gives a note its value of a metric: a note holds one value per metric, so an existing
// one (even a removed one) is overwritten. Sync clients see the change through modified_at.
func (r *ActivitiesRepository) SetNoteValue(userID, typeID, noteID int, value []byte) (*models.Activity, error) {
	var id int
	err := r.db.QueryRow(`
		SELECT id FROM activities WHERE note_id = $1 AND type_id = $2
		ORDER BY is_deleted, id DESC LIMIT 1
	`, noteID, typeID).Scan(&id)
	switch {
	case err == sql.ErrNoRows:
		err = r.db.QueryRow(`
			INSERT INTO activities (user_id, type_id, value, note_id, created_at, modified_at, is_deleted)
			VALUES ($1, $2, $3, $4, NOW(), NOW(), FALSE)
			RETURNING id
		`, userID, typeID, value, noteID).Scan(&id)
	case err == nil:
		_, err = r.db.Exec(`UPDATE activities SET value = $2, is_deleted = FALSE, modified_at = NOW() WHERE id = $1`, id, value)
	}
	if err != nil {
		return nil, err
	}
	return r.GetActivityByID(id)
}

// RemoveNoteValue removes a note's value of a metric; false when the note had none.
func (r *ActivitiesRepository) RemoveNoteValue(typeID, noteID int) (bool, error) {
	res, err := r.db.Exec(`
		UPDATE activities SET is_deleted = TRUE, modified_at = NOW()
		WHERE note_id = $1 AND type_id = $2 AND is_deleted = FALSE
	`, noteID, typeID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
