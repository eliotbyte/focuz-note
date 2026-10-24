// Package imagegeom holds the size rules for note pictures. The web app checks them before it
// uploads (focuz-web/src/lib/image.ts, validateImageGeometry); the server repeats them, because
// agents and other API clients upload without the web app. Keep the two in step.
package imagegeom

import "fmt"

const (
	MinShortSide = 480
	MaxRatio     = 2.4
	MaxLongSide  = 8000
)

// Check returns nil when a picture of width x height is acceptable for a note.
func Check(width, height int) error {
	short, long := width, height
	if short > long {
		short, long = long, short
	}
	if short < MinShortSide {
		return fmt.Errorf("the short side must be at least %d px", MinShortSide)
	}
	if float64(long)/float64(short) > MaxRatio {
		return fmt.Errorf("the long side can be at most %g times the short side", MaxRatio)
	}
	if long > MaxLongSide {
		return fmt.Errorf("the long side can be at most %d px", MaxLongSide)
	}
	return nil
}
