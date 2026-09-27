package handlers

import (
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/time/rate"
)

// loginGuard limits failed password attempts per username. The per-IP limit on /login can be
// bypassed by spoofing X-Forwarded-For whenever the API sits behind a trusted proxy range,
// so brute force against one account is additionally capped here: a burst of
// loginFailureBurst failures, then one attempt per loginFailureEvery.
type loginGuard struct {
	mu      sync.Mutex
	entries map[string]*loginGuardEntry
}

type loginGuardEntry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

const (
	loginFailureBurst = 10
	loginFailureEvery = 30 * time.Second
	loginGuardMaxKeys = 10000
)

var failedLogins = &loginGuard{entries: map[string]*loginGuardEntry{}}

func (g *loginGuard) entry(username string) *loginGuardEntry {
	e, ok := g.entries[username]
	if !ok {
		if len(g.entries) >= loginGuardMaxKeys {
			g.pruneLocked()
		}
		e = &loginGuardEntry{lim: rate.NewLimiter(rate.Every(loginFailureEvery), loginFailureBurst)}
		g.entries[username] = e
	}
	e.lastSeen = time.Now()
	return e
}

// pruneLocked drops entries that have fully refilled (idle long enough).
func (g *loginGuard) pruneLocked() {
	idle := loginFailureEvery * loginFailureBurst
	for k, e := range g.entries {
		if time.Since(e.lastSeen) > idle {
			delete(g.entries, k)
		}
	}
}

// Blocked reports whether the username has used up its failed-attempt budget.
func (g *loginGuard) Blocked(username string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.entry(username).lim.Tokens() < 1
}

// Failed records a failed attempt.
func (g *loginGuard) Failed(username string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.entry(username).lim.Allow()
}

// Succeeded clears the counter after a correct password.
func (g *loginGuard) Succeeded(username string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.entries, username)
}

// dummyHash is compared against when the user does not exist, so both cases take the same
// time and response timing does not reveal which usernames are registered.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("focuz-timing-equalizer"), bcrypt.DefaultCost)
