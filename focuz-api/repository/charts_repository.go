package repository

import (
	"database/sql"
	"focuz-api/models"
	"focuz-api/types"
	"strconv"
	"time"
)

type ChartsRepository struct {
	db *sql.DB
}

func NewChartsRepository(db *sql.DB) *ChartsRepository {
	return &ChartsRepository{db: db}
}

func (r *ChartsRepository) CreateChart(userID, spaceID, kindID, activityTypeID, periodID int, name string, description *string, noteID *int) (*models.Chart, error) {
	var chart models.Chart
	err := r.db.QueryRow(`
		INSERT INTO chart (user_id, space_id, kind, activity_type_id, period, name, description, note_id, created_at, modified_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		RETURNING id, user_id, space_id, kind, activity_type_id, period, name, description, note_id, created_at, modified_at
	`, userID, spaceID, kindID, activityTypeID, periodID, name, description, noteID).Scan(
		&chart.ID,
		&chart.UserID,
		&chart.SpaceID,
		&chart.KindID,
		&chart.ActivityTypeID,
		&chart.PeriodID,
		&chart.Name,
		&chart.Description,
		&chart.NoteID,
		&chart.CreatedAt,
		&chart.ModifiedAt,
	)
	if err != nil {
		return nil, err
	}
	return &chart, nil
}

func (r *ChartsRepository) GetChartByID(id int) (*models.Chart, error) {
	var chart models.Chart
	err := r.db.QueryRow(`
		SELECT id, user_id, space_id, kind, activity_type_id, period, name, description, note_id, is_deleted, created_at, modified_at
		FROM chart
		WHERE id = $1
	`, id).Scan(
		&chart.ID,
		&chart.UserID,
		&chart.SpaceID,
		&chart.KindID,
		&chart.ActivityTypeID,
		&chart.PeriodID,
		&chart.Name,
		&chart.Description,
		&chart.NoteID,
		&chart.IsDeleted,
		&chart.CreatedAt,
		&chart.ModifiedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &chart, nil
}

func (r *ChartsRepository) UpdateChartDeleted(id int, isDeleted bool) error {
	_, err := r.db.Exec(`
		UPDATE chart
		SET is_deleted = $1, modified_at = NOW()
		WHERE id = $2
	`, isDeleted, id)
	return err
}

func (r *ChartsRepository) UpdateChart(id int, kindID, activityTypeID, periodID int, name string, description *string, noteID *int) error {
	_, err := r.db.Exec(`
		UPDATE chart
		SET kind = $1, activity_type_id = $2, period = $3, name = $4, description = $5, note_id = $6, modified_at = NOW()
		WHERE id = $7
	`, kindID, activityTypeID, periodID, name, description, noteID, id)
	return err
}

func (r *ChartsRepository) GetCharts(spaceID int, filters models.ChartFilters) ([]*models.Chart, int, error) {
	offset := (filters.Page - 1) * filters.PageSize
	var conditions []string
	var params []interface{}
	idx := 1

	conditions = append(conditions, "c.is_deleted = FALSE")
	conditions = append(conditions, "c.space_id = $"+strconv.Itoa(idx))
	params = append(params, spaceID)
	idx++

	query := `
		SELECT c.id, c.user_id, c.space_id, c.kind, c.activity_type_id, c.period, c.name, c.description, c.note_id, c.created_at, c.modified_at
		FROM chart c
	`

	if len(conditions) > 0 {
		query += " WHERE " + joinConditions(conditions, " AND ")
	}

	query += " ORDER BY c.created_at DESC"
	query += " LIMIT $" + strconv.Itoa(idx) + " OFFSET $" + strconv.Itoa(idx+1)
	params = append(params, filters.PageSize, offset)

	rows, err := r.db.Query(query, params...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var charts []*models.Chart
	for rows.Next() {
		var chart models.Chart
		err := rows.Scan(
			&chart.ID,
			&chart.UserID,
			&chart.SpaceID,
			&chart.KindID,
			&chart.ActivityTypeID,
			&chart.PeriodID,
			&chart.Name,
			&chart.Description,
			&chart.NoteID,
			&chart.CreatedAt,
			&chart.ModifiedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		charts = append(charts, &chart)
	}

	var total int
	countQuery := `
		SELECT COUNT(c.id)
		FROM chart c
	`
	if len(conditions) > 0 {
		countQuery += " WHERE " + joinConditions(conditions, " AND ")
	}
	err = r.db.QueryRow(countQuery, params[:len(params)-2]...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	return charts, total, nil
}

func (r *ChartsRepository) GetChartData(chart *models.Chart) ([]models.ChartDataPoint, error) {
	var startDate time.Time
	var endDate = time.Now()

	periodType := types.GetPeriodTypeByID(chart.PeriodID)
	if periodType == nil {
		return nil, nil
	}

	switch periodType.Name {
	case "day":
		startDate = endDate.AddDate(0, 0, -1)
	case "week":
		startDate = endDate.AddDate(0, 0, -7)
	case "month":
		startDate = endDate.AddDate(0, -1, 0)
	case "year":
		startDate = endDate.AddDate(-1, 0, 0)
	default:
		startDate = endDate.AddDate(0, 0, -7) // Default to week
	}

	// Сначала получаем тип агрегации
	var aggregation string
	err := r.db.QueryRow(`
		SELECT aggregation
		FROM activity_types
		WHERE id = $1
	`, chart.ActivityTypeID).Scan(&aggregation)
	if err != nil {
		return nil, err
	}

	// Формируем выражение агрегации
	var aggExpr string
	switch aggregation {
	case "sum":
		aggExpr = "SUM((a.value->>'data')::float)"
	case "avg":
		aggExpr = "AVG((a.value->>'data')::float)"
	case "count":
		aggExpr = "COUNT(*)"
	case "min":
		aggExpr = "MIN((a.value->>'data')::float)"
	case "max":
		aggExpr = "MAX((a.value->>'data')::float)"
	default:
		aggExpr = "0"
	}

	rows, err := r.db.Query(`
		SELECT date_trunc($1, a.created_at) as period,
		       `+aggExpr+` as value
		FROM activities a
		JOIN note n ON a.note_id = n.id
		WHERE a.type_id = $2
		  AND a.is_deleted = FALSE
		  AND n.space_id = $3
		  AND a.created_at BETWEEN $4 AND $5
		GROUP BY period
		ORDER BY period
	`, periodType.Name, chart.ActivityTypeID, chart.SpaceID, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dataPoints []models.ChartDataPoint
	for rows.Next() {
		var point models.ChartDataPoint
		err := rows.Scan(&point.Date, &point.Value)
		if err != nil {
			return nil, err
		}
		dataPoints = append(dataPoints, point)
	}

	return dataPoints, nil
}
