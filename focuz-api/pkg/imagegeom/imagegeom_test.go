package imagegeom

import "testing"

func TestCheck(t *testing.T) {
	cases := []struct {
		name          string
		width, height int
		ok            bool
	}{
		{"16:9 full HD", 1920, 1080, true},
		{"16:9 at the minimum short side", 854, 480, true},
		{"21:9", 2560, 1080, true},
		{"portrait", 1080, 1440, true},
		{"short side too small", 400, 300, false},
		{"too narrow", 480, 2000, false},
		{"too wide", 3000, 1000, false},
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
