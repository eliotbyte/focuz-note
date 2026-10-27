package repository

import (
	"database/sql"
	"encoding/json"
	"focuz-api/types"
	"math"
	"regexp"
)

// intervalPattern: the interval texts the clients write ("1 hour 2 minutes 3 seconds") and hh:mm:ss.
var intervalPattern = regexp.MustCompile(`^\s*(?:\d+(?:\.\d+)?\s*(?:milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\s*)+$|^\s*\d+:\d{2}(?::\d{2}(?:\.\d+)?)?\s*$`)

// ValidActivityValue reports whether a stored activity value ({"data": ...}) fits its value type.
// Reading metrics depends on this shape, so a push may not store anything else.
func ValidActivityValue(valueType string, value any) bool {
	obj, ok := value.(map[string]any)
	if !ok || len(obj) != 1 {
		return false
	}
	data, ok := obj["data"]
	if !ok {
		return false
	}
	switch valueType {
	case "integer":
		f, ok := data.(float64)
		return ok && f == math.Trunc(f) && !math.IsInf(f, 0)
	case "float":
		f, ok := data.(float64)
		return ok && !math.IsNaN(f) && !math.IsInf(f, 0)
	case "boolean":
		_, ok := data.(bool)
		return ok
	case "text":
		_, ok := data.(string)
		return ok
	case "time":
		s, ok := data.(string)
		return ok && intervalPattern.MatchString(s)
	}
	return false
}

// activityValue returns the JSON to store for a pushed activity, or ok=false when its value does
// not fit the activity's type (that of the existing activity a.ID, else a.TypeID).
// A deletion keeps whatever value it carries.
func (r *SyncRepository) activityValue(a types.ActivityChange) (val []byte, ok bool, err error) {
	val, err = json.Marshal(a.Value)
	if err != nil {
		return nil, false, nil
	}
	if a.DeletedAt != nil {
		return val, true, nil
	}
	var valueType string
	if a.ID != 0 {
		err = r.q.QueryRow(`SELECT t.value_type FROM activities a JOIN activity_types t ON t.id = a.type_id WHERE a.id = $1`, a.ID).Scan(&valueType)
	} else {
		err = r.q.QueryRow(`SELECT value_type FROM activity_types WHERE id = $1`, a.TypeID).Scan(&valueType)
	}
	if err == sql.ErrNoRows {
		return val, true, nil // unknown type or activity: the caller skips it anyway
	}
	if err != nil {
		return nil, false, err
	}
	return val, ValidActivityValue(valueType, a.Value), nil
}
