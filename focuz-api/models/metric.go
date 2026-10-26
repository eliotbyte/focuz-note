package models

import "time"

// A metric is an activity type seen from the user's side: something they track over time (weight,
// spending, sleep). Each value is attached to a note, and the note's date is the value's date.

type MetricEntry struct {
	ID     int       `json:"id"`
	NoteID int       `json:"noteId"`
	Date   time.Time `json:"date"`
	Value  any       `json:"value"`
	Note   string    `json:"note,omitempty"`
}

type Metric struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	ValueType   string       `json:"valueType"`
	Unit        *string      `json:"unit,omitempty"`
	Aggregation string       `json:"aggregation"`
	MinValue    *float64     `json:"minValue,omitempty"`
	MaxValue    *float64     `json:"maxValue,omitempty"`
	BuiltIn     bool         `json:"builtIn"`
	Count       int          `json:"count"`
	FirstDate   *time.Time   `json:"firstDate,omitempty"`
	Last        *MetricEntry `json:"last,omitempty"`
	Previous    *MetricEntry `json:"previous,omitempty"`
}

// MetricStats covers every value in a date range (numbers only).
type MetricStats struct {
	Count int      `json:"count"`
	Min   *float64 `json:"min,omitempty"`
	Max   *float64 `json:"max,omitempty"`
	Avg   *float64 `json:"avg,omitempty"`
	Sum   *float64 `json:"sum,omitempty"`
}
