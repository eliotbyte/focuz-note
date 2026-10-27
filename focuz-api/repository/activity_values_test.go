package repository

import (
	"encoding/json"
	"testing"
)

func TestValidActivityValue(t *testing.T) {
	cases := []struct {
		valueType, value string
		ok               bool
	}{
		{"float", `{"data": 72.5}`, true},
		{"float", `5`, false},
		{"float", `{"data": "72"}`, false},
		{"float", `{"data": null}`, false},
		{"float", `{"data": 1, "x": 2}`, false},
		{"integer", `{"data": 3}`, true},
		{"integer", `{"data": 3.5}`, false},
		{"boolean", `{"data": true}`, true},
		{"boolean", `{"data": "yes"}`, false},
		{"text", `{"data": "calm"}`, true},
		{"time", `{"data": "1 hour 2 minutes 3 seconds"}`, true},
		{"time", `{"data": "250 milliseconds"}`, true},
		{"time", `{"data": "07:30:00"}`, true},
		{"time", `{"data": "soon"}`, false},
		{"time", `{"data": 3600}`, false},
	}
	for _, tc := range cases {
		var v any
		if err := json.Unmarshal([]byte(tc.value), &v); err != nil {
			t.Fatal(err)
		}
		if got := ValidActivityValue(tc.valueType, v); got != tc.ok {
			t.Errorf("%s %s: got %v", tc.valueType, tc.value, got)
		}
	}
}
