// Package imagegeom holds the size rules for note pictures. The web app checks them before it
// uploads (focuz-web/src/lib/image.ts, validateImageGeometry); the server repeats them, because
// agents and other API clients upload without the web app. Keep the two in step.
package imagegeom

import (
	"errors"
	"fmt"
	"strings"
)

// The short side only keeps out icons and tracking pixels: screenshots, chat pictures and pixel art are
// often small. Long screenshots and panoramas pass the ratio; the long side guards against huge files.
const (
	MinShortSide = 64
	MaxRatio     = 8
	MaxLongSide  = 8000
)

// Check returns nil when a picture of width x height is acceptable for a note; otherwise the error
// names every rule the picture breaks.
func Check(width, height int) error {
	short, long := width, height
	if short > long {
		short, long = long, short
	}
	var broken []string
	if short < MinShortSide {
		broken = append(broken, fmt.Sprintf("the short side must be at least %d px", MinShortSide))
	}
	if short <= 0 || float64(long)/float64(short) > MaxRatio {
		broken = append(broken, fmt.Sprintf("the long side can be at most %d times the short side", MaxRatio))
	}
	if long > MaxLongSide {
		broken = append(broken, fmt.Sprintf("the long side can be at most %d px", MaxLongSide))
	}
	if len(broken) == 0 {
		return nil
	}
	return errors.New(strings.Join(broken, "; "))
}
