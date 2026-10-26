package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"focuz-api/models"
)

// No database: value checks, durations and metric definitions.

func TestEncodeMetricValue(t *testing.T) {
	min, max := 20.0, 300.0
	weight := &models.ActivityType{Name: "Weight", ValueType: "float", MinValue: &min, MaxValue: &max}
	steps := &models.ActivityType{Name: "Steps", ValueType: "integer"}
	done := &models.ActivityType{Name: "Meditated", ValueType: "boolean"}
	sleep := &models.ActivityType{Name: "Sleep", ValueType: "time"}

	cases := []struct {
		t    *models.ActivityType
		in   string
		want string
	}{
		{weight, "63.4", `{"data":63.4}`},
		{weight, "63,4", `{"data":63.4}`},
		{steps, "10000", `{"data":10000}`},
		{done, "yes", `{"data":true}`},
		{sleep, "7h30m", `{"data":"7 hours 30 minutes"}`},
		{sleep, "7:05", `{"data":"7 hours 5 minutes"}`},
		{sleep, "1 hour 2 minutes 3 seconds", `{"data":"1 hour 2 minutes 3 seconds"}`},
	}
	for _, c := range cases {
		got, err := encodeMetricValue(c.t, c.in)
		if err != nil || string(got) != c.want {
			t.Errorf("%s %q: got %s, %v; want %s", c.t.Name, c.in, got, err, c.want)
		}
	}
	for _, c := range []struct {
		t  *models.ActivityType
		in string
	}{{weight, "heavy"}, {weight, "12"}, {weight, "NaN"}, {steps, "1.5"}, {done, "maybe"}, {sleep, "long"}, {sleep, "-1h"}, {weight, " "}} {
		if _, err := encodeMetricValue(c.t, c.in); err == nil {
			t.Errorf("%s %q: want an error", c.t.Name, c.in)
		}
	}
	if _, err := encodeMetricValue(weight, "400"); err == nil || !strings.Contains(err.Error(), "20 to 300") {
		t.Errorf("out of range error should name the range, got %v", err)
	}
}

func TestParseDuration(t *testing.T) {
	d, err := parseDuration("1h 30m")
	if err != nil || d != 90*time.Minute {
		t.Fatalf("got %v, %v", d, err)
	}
	if got := intervalText(90*time.Minute + 1500*time.Millisecond); got != "1 hour 30 minutes 1 second 500 milliseconds" {
		t.Fatalf("intervalText: %q", got)
	}
}

func TestCheckMetricDef(t *testing.T) {
	kg := " kg "
	m := metricCreate{Name: " Weight ", Unit: &kg}
	if err := checkMetricDef(&m); err != nil {
		t.Fatal(err)
	}
	if m.Name != "Weight" || m.ValueType != "float" || m.Aggregation != "avg" || *m.Unit != "kg" {
		t.Fatalf("defaults not applied: %+v", m)
	}
	for _, bad := range []metricCreate{
		{Name: ""},
		{Name: "X", ValueType: "color"},
		{Name: "X", ValueType: "boolean", Aggregation: "sum"},
		{Name: "X", ValueType: "time", Unit: &kg},
	} {
		if err := checkMetricDef(&bad); err == nil {
			t.Errorf("want an error for %+v", bad)
		}
	}
}

func TestMCPMetricToolsListedAndWriteGuarded(t *testing.T) {
	h := &NotesAPIHandler{}
	res, _ := h.dispatch(1, "write", rpcRequest{Method: "tools/list"})
	b, _ := json.Marshal(res)
	for _, name := range []string{"describe_space", "list_metrics", "create_metric", "record_metrics", "get_metric_history", "remove_metric_value", "restore_note"} {
		if !strings.Contains(string(b), `"`+name+`"`) {
			t.Errorf("tools/list is missing %s", name)
		}
	}
	for _, name := range []string{"create_metric", "record_metrics", "remove_metric_value", "restore_note"} {
		tool, _ := mcpToolByName(name)
		if text, isErr := h.runTool(1, "read", tool, nil); !isErr || !strings.Contains(text, "read-only") {
			t.Errorf("%s with a read token: %q", name, text)
		}
	}
}
