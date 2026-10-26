package handlers

// Metrics for REST and MCP: things a user tracks over time (weight, spending, sleep). A metric is an
// activity type; each value is attached to a note, so the user sees it in the app, and the note's date
// is the value's date. People and agents go through the same functions here.

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"focuz-api/models"
	"focuz-api/pkg/access"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
)

const (
	maxMetricNameLen     = 100
	maxMetricUnitLen     = 20
	defaultMetricEntries = 50
	maxMetricEntries     = 500
)

func conflict(message string) error {
	return &clientError{status: http.StatusConflict, code: types.ErrorCodeConflict, message: message}
}

// WithMetrics gives the handler what metrics and the space overview need.
func (h *NotesAPIHandler) WithMetrics(activities *repository.ActivitiesRepository, activityTypes *repository.ActivityTypesRepository, filters *repository.FiltersRepository) *NotesAPIHandler {
	h.activities = activities
	h.activityTypes = activityTypes
	h.filters = filters
	return h
}

// spaceRole returns the caller's role, or a client error when they are not a member.
func (h *NotesAPIHandler) spaceRole(userID, spaceID int) (int, error) {
	if spaceID <= 0 {
		return 0, invalidInput("spaceId is required")
	}
	roleID, err := h.spaces.GetUserRoleIDInSpace(userID, spaceID)
	if err != nil {
		return 0, err
	}
	if roleID == 0 {
		return 0, errForbidden("No access to the space")
	}
	return roleID, nil
}

// metricRef names a metric by id (a number) or by name (a string, any case).
type metricRef json.RawMessage

func (m *metricRef) UnmarshalJSON(b []byte) error {
	*m = append((*m)[:0], b...)
	return nil
}

func (h *NotesAPIHandler) resolveMetric(spaceID int, ref metricRef) (*models.ActivityType, error) {
	raw := strings.TrimSpace(string(ref))
	if raw == "" || raw == "null" {
		return nil, invalidInput("metric is required: its name or id")
	}
	var id int
	if err := json.Unmarshal([]byte(raw), &id); err == nil {
		t, err := h.activityTypes.GetActivityTypeByID(id)
		if err != nil {
			return nil, err
		}
		if t == nil || t.IsDeleted || !typeUsableInSpace(t, spaceID) {
			return nil, invalidInput(fmt.Sprintf("No metric %d in this space; list_metrics shows them", id))
		}
		return t, nil
	}
	var name string
	if err := json.Unmarshal([]byte(raw), &name); err != nil || strings.TrimSpace(name) == "" {
		return nil, invalidInput("metric must be a metric name or id")
	}
	t, err := h.activities.FindMetric(spaceID, name)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, invalidInput(fmt.Sprintf("No metric named %q in this space; create it with create_metric or pick one from list_metrics", name))
	}
	return t, nil
}

func (h *NotesAPIHandler) listMetrics(userID, spaceID int) ([]models.Metric, error) {
	if _, err := h.spaceRole(userID, spaceID); err != nil {
		return nil, err
	}
	return h.activities.ListMetrics(spaceID)
}

type metricCreate struct {
	SpaceID     int      `json:"spaceId"`
	Name        string   `json:"name"`
	ValueType   string   `json:"valueType"`
	Unit        *string  `json:"unit"`
	Aggregation string   `json:"aggregation"`
	MinValue    *float64 `json:"minValue"`
	MaxValue    *float64 `json:"maxValue"`
}

var (
	metricValueTypes   = []string{"float", "integer", "boolean", "time", "text"}
	metricAggregations = map[string][]string{
		"float":   {"avg", "sum", "min", "max", "count"},
		"integer": {"avg", "sum", "min", "max", "count"},
		"time":    {"sum", "avg", "min", "max", "count"},
		"boolean": {"count_true", "count_false", "percentage_true", "percentage_false", "and", "or"},
		"text":    {"count"},
	}
)

func contains(list []string, s string) bool {
	for _, it := range list {
		if it == s {
			return true
		}
	}
	return false
}

// checkMetricDef fills defaults (float, the type's first aggregation) and checks the definition.
func checkMetricDef(m *metricCreate) error {
	m.Name = strings.TrimSpace(m.Name)
	if m.Name == "" || len([]rune(m.Name)) > maxMetricNameLen {
		return invalidInput(fmt.Sprintf("name is required, up to %d characters", maxMetricNameLen))
	}
	m.ValueType = strings.ToLower(strings.TrimSpace(m.ValueType))
	if m.ValueType == "" {
		m.ValueType = "float"
	}
	aggs, ok := metricAggregations[m.ValueType]
	if !ok {
		return invalidInput("valueType must be one of " + strings.Join(metricValueTypes, ", "))
	}
	m.Aggregation = strings.ToLower(strings.TrimSpace(m.Aggregation))
	if m.Aggregation == "" {
		m.Aggregation = aggs[0]
	}
	if !contains(aggs, m.Aggregation) {
		return invalidInput(fmt.Sprintf("aggregation for %s must be one of %s", m.ValueType, strings.Join(aggs, ", ")))
	}
	if m.Unit != nil {
		u := strings.TrimSpace(*m.Unit)
		if u == "" {
			m.Unit = nil
		} else {
			if len([]rune(u)) > maxMetricUnitLen {
				return invalidInput(fmt.Sprintf("unit is up to %d characters", maxMetricUnitLen))
			}
			if m.ValueType == "time" || m.ValueType == "boolean" || m.ValueType == "text" {
				return invalidInput("Only number metrics have a unit")
			}
			m.Unit = &u
		}
	}
	if m.MinValue != nil && m.MaxValue != nil && *m.MinValue > *m.MaxValue {
		return invalidInput("minValue cannot be greater than maxValue")
	}
	return nil
}

func (h *NotesAPIHandler) createMetric(userID int, req metricCreate) (*models.ActivityType, error) {
	roleID, err := h.spaceRole(userID, req.SpaceID)
	if err != nil {
		return nil, err
	}
	if !access.CanWrite(roleID) {
		return nil, errForbidden("You can only read this space")
	}
	if err := checkMetricDef(&req); err != nil {
		return nil, err
	}
	existing, err := h.activities.FindMetric(req.SpaceID, req.Name)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, conflict(fmt.Sprintf("A metric named %q already exists (id %d): use it", existing.Name, existing.ID))
	}
	if deleted, err := h.activities.HasDeletedMetric(req.SpaceID, req.Name); err != nil {
		return nil, err
	} else if deleted {
		return nil, conflict(fmt.Sprintf("A deleted metric is still named %q: choose another name", req.Name))
	}
	spaceID := req.SpaceID
	return h.activityTypes.CreateActivityType(req.Name, req.ValueType, req.MinValue, req.MaxValue, req.Aggregation, &spaceID, nil, req.Unit)
}

type metricValueIn struct {
	Metric metricRef `json:"metric"`
	Value  any       `json:"value"`
}

type metricRecord struct {
	SpaceID int             `json:"spaceId"`
	NoteID  *int            `json:"noteId"`
	Values  []metricValueIn `json:"values"`
	Text    *string         `json:"text"`
	Tags    []string        `json:"tags"`
	Date    *time.Time      `json:"date"`
}

type recordedValue struct {
	Metric   string              `json:"metric"`
	MetricID int                 `json:"metricId"`
	Unit     *string             `json:"unit,omitempty"`
	Value    any                 `json:"value"`
	Previous *models.MetricEntry `json:"previous,omitempty"`
	Change   *float64            `json:"change,omitempty"`
}

// valueText turns a JSON value into the text the validator reads.
func valueText(v any) (string, error) {
	switch x := v.(type) {
	case nil:
		return "", invalidInput("value is required")
	case string:
		return x, nil
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64), nil
	case bool:
		return strconv.FormatBool(x), nil
	}
	return "", invalidInput("value must be a number, true/false or text")
}

// recordMetrics saves values: in a new note (dated `date`, now by default) or in an existing note.
func (h *NotesAPIHandler) recordMetrics(userID int, req metricRecord) (gin.H, error) {
	if len(req.Values) == 0 {
		return nil, invalidInput("values is required: [{metric, value}]")
	}
	spaceID := req.SpaceID
	var note *models.Note
	if req.NoteID != nil {
		n, roleID, err := h.loadNote(userID, *req.NoteID)
		if err != nil {
			return nil, err
		}
		if !access.CanEditNote(roleID) {
			return nil, errForbidden("You can only read this space")
		}
		if spaceID != 0 && spaceID != n.SpaceID {
			return nil, invalidInput("The note is in another space")
		}
		if req.Text != nil || req.Tags != nil || req.Date != nil {
			return nil, invalidInput("With noteId only values are saved; change text, tags or date with update_note")
		}
		note, spaceID = n, n.SpaceID
	} else {
		roleID, err := h.spaceRole(userID, spaceID)
		if err != nil {
			return nil, err
		}
		if !access.CanWrite(roleID) {
			return nil, errForbidden("You can only read this space")
		}
	}

	// Check everything before writing anything.
	type checked struct {
		t       *models.ActivityType
		encoded []byte
		value   any
	}
	var items []checked
	seen := map[int]bool{}
	for _, v := range req.Values {
		t, err := h.resolveMetric(spaceID, v.Metric)
		if err != nil {
			return nil, err
		}
		if seen[t.ID] {
			return nil, invalidInput(fmt.Sprintf("%s is listed twice: a note holds one value per metric", t.Name))
		}
		seen[t.ID] = true
		raw, err := valueText(v.Value)
		if err != nil {
			return nil, err
		}
		enc, err := encodeMetricValue(t, raw)
		if err != nil {
			return nil, invalidInput(t.Name + ": " + err.Error())
		}
		var stored struct {
			Data any `json:"data"`
		}
		_ = json.Unmarshal(enc, &stored)
		items = append(items, checked{t: t, encoded: enc, value: stored.Data})
	}

	date := time.Now().UTC()
	switch {
	case note != nil:
		date = note.Date
	case req.Date != nil:
		date = *req.Date
	}
	// What each metric was before this value, for "last time it was ...".
	previous := make([]*models.MetricEntry, len(items))
	for i, it := range items {
		list, err := h.activities.MetricEntries(spaceID, it.t, nil, &date, 2, false)
		if err != nil {
			return nil, err
		}
		for j := range list {
			if note == nil || list[j].NoteID != note.ID {
				previous[i] = &list[j]
				break
			}
		}
	}

	if note == nil {
		text := ""
		if req.Text != nil {
			text = strings.TrimSpace(*req.Text)
		}
		if text == "" {
			parts := make([]string, 0, len(items))
			for _, it := range items {
				parts = append(parts, it.t.Name+": "+formatMetricValue(it.t, it.value))
			}
			text = strings.Join(parts, ", ")
		}
		n, err := h.createNote(userID, noteCreate{SpaceID: spaceID, Text: text, Tags: req.Tags, Date: &date})
		if err != nil {
			return nil, err
		}
		note = n
	}

	out := make([]recordedValue, 0, len(items))
	for i, it := range items {
		if _, err := h.activities.SetNoteValue(userID, it.t.ID, note.ID, it.encoded); err != nil {
			return nil, err
		}
		rv := recordedValue{Metric: it.t.Name, MetricID: it.t.ID, Unit: it.t.Unit, Value: it.value, Previous: previous[i]}
		// For metrics that add up (spending, steps) one value is not a change from the last.
		if p := previous[i]; p != nil && it.t.Aggregation != "sum" && it.t.Aggregation != "count" {
			cur, ok1 := it.value.(float64)
			prev, ok2 := p.Value.(float64)
			if ok1 && ok2 {
				d := math.Round((cur-prev)*1e6) / 1e6
				rv.Change = &d
			}
		}
		out = append(out, rv)
	}
	return gin.H{"noteId": note.ID, "date": date, "values": out}, nil
}

func formatMetricValue(t *models.ActivityType, v any) string {
	s := fmt.Sprint(v)
	switch x := v.(type) {
	case float64:
		s = strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		s = "no"
		if x {
			s = "yes"
		}
	}
	if t.Unit != nil && *t.Unit != "" {
		s += " " + *t.Unit
	}
	return s
}

func (h *NotesAPIHandler) removeMetricValue(userID, noteID int, ref metricRef) error {
	note, roleID, err := h.loadNote(userID, noteID)
	if err != nil {
		return err
	}
	if !access.CanEditNote(roleID) {
		return errForbidden("You can only read this space")
	}
	t, err := h.resolveMetric(note.SpaceID, ref)
	if err != nil {
		return err
	}
	removed, err := h.activities.RemoveNoteValue(t.ID, noteID)
	if err != nil {
		return err
	}
	if !removed {
		return invalidInput(fmt.Sprintf("Note %d has no %s value", noteID, t.Name))
	}
	return nil
}

type metricHistoryQuery struct {
	SpaceID int       `json:"spaceId"`
	Metric  metricRef `json:"metric"`
	From    string    `json:"from"`
	To      string    `json:"to"`
	Limit   int       `json:"limit"`
	Order   string    `json:"order"`
	GroupBy string    `json:"groupBy"`
}

// parseRangeDate reads YYYY-MM-DD or RFC 3339. A bare day as the end of a range covers that whole day.
func parseRangeDate(s string, end bool) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, invalidInput("Dates are YYYY-MM-DD or RFC 3339")
	}
	if end {
		t = t.AddDate(0, 0, 1)
	}
	return &t, nil
}

func (h *NotesAPIHandler) metricHistory(userID int, q metricHistoryQuery) (gin.H, error) {
	if _, err := h.spaceRole(userID, q.SpaceID); err != nil {
		return nil, err
	}
	t, err := h.resolveMetric(q.SpaceID, q.Metric)
	if err != nil {
		return nil, err
	}
	from, err := parseRangeDate(q.From, false)
	if err != nil {
		return nil, err
	}
	to, err := parseRangeDate(q.To, true)
	if err != nil {
		return nil, err
	}
	stats, err := h.activities.MetricStats(q.SpaceID, t, from, to)
	if err != nil {
		return nil, err
	}
	out := gin.H{
		"metric": gin.H{"id": t.ID, "name": t.Name, "valueType": t.ValueType, "unit": t.Unit, "aggregation": t.Aggregation},
		"stats":  stats,
	}
	if q.GroupBy != "" {
		period := types.GetPeriodTypeByName(strings.ToLower(q.GroupBy))
		if period == nil {
			return nil, invalidInput("groupBy must be day, week, month or year")
		}
		var end *time.Time
		if to != nil {
			e := to.Add(-time.Nanosecond)
			end = &e
		}
		series, err := h.activities.GetActivitiesAnalysis(q.SpaceID, from, end, nil, t, period.ID)
		if err != nil {
			return nil, err
		}
		out["groupBy"] = period.Name
		out["series"] = series
		return out, nil
	}
	limit := q.Limit
	if limit <= 0 {
		limit = defaultMetricEntries
	}
	if limit > maxMetricEntries {
		limit = maxMetricEntries
	}
	entries, err := h.activities.MetricEntries(q.SpaceID, t, from, to, limit, strings.EqualFold(q.Order, "oldest"))
	if err != nil {
		return nil, err
	}
	out["entries"] = entries
	return out, nil
}

// describeSpace is an agent's map of a space: what is in it and how it is organised.
func (h *NotesAPIHandler) describeSpace(userID, spaceID int) (gin.H, error) {
	roleID, err := h.spaceRole(userID, spaceID)
	if err != nil {
		return nil, err
	}
	space, err := h.spaces.GetSpaceByID(spaceID)
	if err != nil {
		return nil, err
	}
	notes, topLevel, first, last, err := h.notes.SpaceStats(spaceID)
	if err != nil {
		return nil, err
	}
	tags, err := h.notes.TagCounts(spaceID, 200)
	if err != nil {
		return nil, err
	}
	filters, _, err := h.filters.List(spaceID, userID, 1, 500)
	if err != nil {
		return nil, err
	}
	folders := make([]gin.H, 0, len(filters))
	for _, f := range filters {
		folders = append(folders, gin.H{"id": f.ID, "name": f.Name, "parentId": f.ParentID, "rule": f.Params})
	}
	metrics, err := h.activities.ListMetrics(spaceID)
	if err != nil {
		return nil, err
	}
	name := ""
	if space != nil {
		name = space.Name
	}
	return gin.H{
		"id": spaceID, "name": name, "role": access.Name(roleID),
		"notes": notes, "topLevelNotes": topLevel, "firstNoteDate": first, "lastNoteDate": last,
		"tags": tags, "folders": folders, "metrics": metrics,
	}, nil
}

func (h *NotesAPIHandler) restoreNote(userID, noteID int) error {
	note, err := h.notes.GetNoteByID(noteID)
	if err != nil {
		return err
	}
	if note == nil {
		return notFoundNote()
	}
	roleID, err := h.spaceRole(userID, note.SpaceID)
	if err != nil {
		return err
	}
	if !access.CanDeleteNote(roleID, note.UserID, userID) {
		return errForbidden("You can restore only your own notes here")
	}
	if !note.IsDeleted {
		return invalidInput("The note is not in the trash")
	}
	return h.notes.UpdateNoteDeleted(noteID, false)
}

// Values ---------------------------------------------------------------------------------------

// encodeMetricValue checks a value against its type and returns the stored JSON ({"data": ...}).
func encodeMetricValue(t *models.ActivityType, raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("empty value")
	}
	inRange := func(f float64) error {
		if (t.MinValue != nil && f < *t.MinValue) || (t.MaxValue != nil && f > *t.MaxValue) {
			return errors.New("value is out of range" + rangeText(t))
		}
		return nil
	}
	var data any
	switch t.ValueType {
	case "integer":
		v, err := strconv.Atoi(raw)
		if err != nil {
			return nil, errors.New("value must be a whole number")
		}
		if err := inRange(float64(v)); err != nil {
			return nil, err
		}
		data = v
	case "float":
		f, err := strconv.ParseFloat(strings.Replace(raw, ",", ".", 1), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, errors.New("value must be a number")
		}
		if err := inRange(f); err != nil {
			return nil, err
		}
		data = f
	case "boolean":
		b, ok := parseYesNo(raw)
		if !ok {
			return nil, errors.New("value must be true or false")
		}
		data = b
	case "text":
		data = raw
	case "time":
		d, err := parseDuration(raw)
		if err != nil {
			return nil, err
		}
		if err := inRange(float64(d.Milliseconds())); err != nil {
			return nil, err
		}
		data = intervalText(d)
	default:
		return nil, errors.New("unsupported value type")
	}
	return json.Marshal(map[string]any{"data": data})
}

func rangeText(t *models.ActivityType) string {
	f := func(p *float64) string { return strconv.FormatFloat(*p, 'f', -1, 64) }
	switch {
	case t.MinValue != nil && t.MaxValue != nil:
		return fmt.Sprintf(" (%s to %s)", f(t.MinValue), f(t.MaxValue))
	case t.MinValue != nil:
		return " (at least " + f(t.MinValue) + ")"
	case t.MaxValue != nil:
		return " (at most " + f(t.MaxValue) + ")"
	}
	return ""
}

func parseYesNo(s string) (bool, bool) {
	switch strings.ToLower(s) {
	case "true", "1", "yes", "y":
		return true, true
	case "false", "0", "no", "n":
		return false, true
	}
	return false, false
}

var (
	clockRe    = regexp.MustCompile(`^(\d+):([0-5]\d)(?::([0-5]\d))?$`)
	intervalRe = regexp.MustCompile(`(\d+)\s*(hours?|minutes?|seconds?|milliseconds?)`)
)

// parseDuration reads "7h30m" (Go), "7:30" (hours and minutes) or "7 hours 30 minutes" (what the web
// app sends and Postgres prints).
func parseDuration(s string) (time.Duration, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if d, err := time.ParseDuration(strings.ReplaceAll(s, " ", "")); err == nil && d >= 0 {
		return d, nil
	}
	if m := clockRe.FindStringSubmatch(s); m != nil {
		h, _ := strconv.Atoi(m[1])
		mi, _ := strconv.Atoi(m[2])
		sec := 0
		if m[3] != "" {
			sec, _ = strconv.Atoi(m[3])
		}
		return time.Duration(h)*time.Hour + time.Duration(mi)*time.Minute + time.Duration(sec)*time.Second, nil
	}
	if matches := intervalRe.FindAllStringSubmatch(s, -1); len(matches) > 0 &&
		strings.TrimSpace(intervalRe.ReplaceAllString(s, "")) == "" {
		var d time.Duration
		for _, m := range matches {
			n, _ := strconv.Atoi(m[1])
			unit := map[byte]time.Duration{'h': time.Hour, 's': time.Second}[m[2][0]]
			switch {
			case strings.HasPrefix(m[2], "minute"):
				unit = time.Minute
			case strings.HasPrefix(m[2], "milli"):
				unit = time.Millisecond
			}
			d += time.Duration(n) * unit
		}
		return d, nil
	}
	return 0, errors.New("value must be a duration such as 7h30m, 7:30 or 7 hours 30 minutes")
}

// intervalText writes a duration the way the web app does ("7 hours 30 minutes"), which Postgres
// reads as an interval.
func intervalText(d time.Duration) string {
	ms := d.Milliseconds()
	h, m, s, rest := ms/3600000, ms%3600000/60000, ms%60000/1000, ms%1000
	var parts []string
	plural := func(n int64, word string) string {
		if n == 1 {
			return fmt.Sprintf("%d %s", n, word)
		}
		return fmt.Sprintf("%d %ss", n, word)
	}
	if h > 0 {
		parts = append(parts, plural(h, "hour"))
	}
	if m > 0 {
		parts = append(parts, plural(m, "minute"))
	}
	if s > 0 || (h == 0 && m == 0 && rest == 0) {
		parts = append(parts, plural(s, "second"))
	}
	if rest > 0 {
		parts = append(parts, fmt.Sprintf("%d milliseconds", rest))
	}
	return strings.Join(parts, " ")
}

// REST -----------------------------------------------------------------------------------------

func spaceParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("spaceId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid space ID"))
		return 0, false
	}
	return id, true
}

// GET /spaces/:spaceId/metrics
func (h *NotesAPIHandler) ListMetrics(c *gin.Context) {
	spaceID, ok := spaceParam(c)
	if !ok {
		return
	}
	list, err := h.listMetrics(c.GetInt("userId"), spaceID)
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(list))
}

// POST /spaces/:spaceId/metrics { name, valueType?, unit?, aggregation?, minValue?, maxValue? }
func (h *NotesAPIHandler) CreateMetric(c *gin.Context) {
	spaceID, ok := spaceParam(c)
	if !ok {
		return
	}
	var req metricCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid body"))
		return
	}
	req.SpaceID = spaceID
	created, err := h.createMetric(c.GetInt("userId"), req)
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(created))
}

// GET /spaces/:spaceId/metrics/:metric/entries?from&to&limit&order=newest|oldest&groupBy=day|week|month|year
func (h *NotesAPIHandler) MetricEntries(c *gin.Context) {
	spaceID, ok := spaceParam(c)
	if !ok {
		return
	}
	ref, _ := json.Marshal(c.Param("metric"))
	if id, err := strconv.Atoi(c.Param("metric")); err == nil {
		ref, _ = json.Marshal(id)
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.metricHistory(c.GetInt("userId"), metricHistoryQuery{
		SpaceID: spaceID, Metric: metricRef(ref), From: c.Query("from"), To: c.Query("to"),
		Limit: limit, Order: c.Query("order"), GroupBy: c.Query("groupBy"),
	})
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(out))
}

// POST /metrics/record { spaceId | noteId, values: [{metric, value}], text?, tags?, date? }
func (h *NotesAPIHandler) RecordMetrics(c *gin.Context) {
	var req metricRecord
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Invalid body"))
		return
	}
	out, err := h.recordMetrics(c.GetInt("userId"), req)
	if err != nil {
		respondAPIError(c, err)
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(out))
}
