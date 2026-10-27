package imagegeom

import (
	"strings"
	"testing"
)

func TestCheck(t *testing.T) {
	cases := []struct {
		name          string
		width, height int
		ok            bool
	}{
		{"16:9 full HD", 1920, 1080, true},
		{"21:9", 2560, 1080, true},
		{"portrait", 1080, 1440, true},
		{"small screenshot", 400, 300, true},
		{"pixel art at the minimum short side", 64, 64, true},
		{"long chat screenshot 1:8", 1000, 8000, true},
		{"panorama 8:1", 4000, 500, true},
		{"icon", 32, 32, false},
		{"tracking pixel", 1, 1, false},
		{"too narrow", 480, 4000, false},
		{"long side too long", 9000, 3000, false},
		{"empty picture", 0, 0, false},
	}
	for _, c := range cases {
		err := Check(c.width, c.height)
		if (err == nil) != c.ok {
			t.Errorf("%s (%dx%d): got %v, want ok=%v", c.name, c.width, c.height, err, c.ok)
		}
	}
}

func TestCheckNamesEveryBrokenRule(t *testing.T) {
	err := Check(40, 9000)
	if err == nil {
		t.Fatal("40x9000 accepted")
	}
	for _, want := range []string{"at least 64 px", "8 times", "at most 8000 px"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not mention %q", err, want)
		}
	}
}
