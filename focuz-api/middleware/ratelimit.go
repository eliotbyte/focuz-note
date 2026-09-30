package middleware

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"focuz-api/pkg/appenv"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// limiterEntry holds a rate limiter and the last time it was seen.
type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// ipLimiterStore is a threadsafe store mapping keys (user or IP) to limiter entries.
// A background janitor removes stale entries to avoid unbounded memory growth.
type ipLimiterStore struct {
	mu         sync.Mutex
	entries    map[string]*limiterEntry
	staleAfter time.Duration
}

func newIPLimiterStore(staleAfter time.Duration) *ipLimiterStore {
	store := &ipLimiterStore{
		entries:    make(map[string]*limiterEntry),
		staleAfter: staleAfter,
	}
	// Start cleanup goroutine
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			store.cleanup()
		}
	}()
	return store
}

func (s *ipLimiterStore) getOrCreate(key string, r rate.Limit, burst int) *rate.Limiter {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.entries[key]; ok {
		e.lastSeen = time.Now()
		return e.limiter
	}
	lim := rate.NewLimiter(r, burst)
	s.entries[key] = &limiterEntry{limiter: lim, lastSeen: time.Now()}
	return lim
}

func (s *ipLimiterStore) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-s.staleAfter)
	for k, e := range s.entries {
		if e.lastSeen.Before(cutoff) {
			delete(s.entries, k)
		}
	}
}

// parseEnvRate reads RATE_LIMIT_RPS and RATE_LIMIT_BURST from environment or returns defaults.
func parseEnvRate() (rate.Limit, int) {
	rps := 5.0
	burst := 20
	if v := strings.TrimSpace(os.Getenv("RATE_LIMIT_RPS")); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			rps = f
		}
	}
	if v := strings.TrimSpace(os.Getenv("RATE_LIMIT_BURST")); v != "" {
		if i, err := strconv.Atoi(v); err == nil && i > 0 {
			burst = i
		}
	}
	return rate.Limit(rps), burst
}

// buildWhitelist returns IP/CIDR whitelist from RATE_LIMIT_WHITELIST, comma separated.
func buildWhitelist() ([]net.IP, []*net.IPNet) {
	var ips []net.IP
	var nets []*net.IPNet
	raw := strings.TrimSpace(os.Getenv("RATE_LIMIT_WHITELIST"))
	if raw == "" {
		return ips, nets
	}
	for _, part := range strings.Split(raw, ",") {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		if ip := net.ParseIP(p); ip != nil {
			ips = append(ips, ip)
			continue
		}
		if _, n, err := net.ParseCIDR(p); err == nil {
			nets = append(nets, n)
		}
	}
	return ips, nets
}

func isWhitelisted(clientIP string, ips []net.IP, nets []*net.IPNet) bool {
	ip := net.ParseIP(clientIP)
	if ip == nil {
		return false
	}
	for _, w := range ips {
		if w.Equal(ip) {
			return true
		}
	}
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// isDisabled returns true when rate limiting should be disabled, e.g. for tests.
func isDisabled() bool {
	// Disable if RATE_LIMIT_ENABLED is explicitly set to false/0/no
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("RATE_LIMIT_ENABLED"))); v == "0" || v == "false" || v == "no" {
		return true
	}
	// Also disable automatically in tests
	if appenv.IsTest() {
		return true
	}
	return false
}

// RateLimitMiddleware performs per-user (when authenticated) or per-IP token bucket limiting.
// It skips preflight (OPTIONS) and the /health endpoint. Configure via env:
// - RATE_LIMIT_ENABLED (bool, default true)
// - RATE_LIMIT_RPS (float, default 5)
// - RATE_LIMIT_BURST (int, default 20)
// - RATE_LIMIT_WHITELIST (comma-separated IPs or CIDRs)
func RateLimitMiddleware() gin.HandlerFunc {
	if isDisabled() {
		// No-op middleware
		return func(c *gin.Context) { c.Next() }
	}

	r, burst := parseEnvRate()
	whitelistIPs, whitelistNets := buildWhitelist()
	store := newIPLimiterStore(10 * time.Minute)

	return func(c *gin.Context) {
		// Skip preflight and health check
		if c.Request.Method == http.MethodOptions || c.Request.URL.Path == "/health" {
			c.Next()
			return
		}

		clientIP := c.ClientIP()
		if isWhitelisted(clientIP, whitelistIPs, whitelistNets) {
			c.Next()
			return
		}

		key := "ip:" + clientIP
		if userIDVal, exists := c.Get("userId"); exists {
			switch v := userIDVal.(type) {
			case int:
				key = "uid:" + strconv.Itoa(v)
			case int64:
				key = "uid:" + strconv.FormatInt(v, 10)
			case float64:
				key = "uid:" + strconv.Itoa(int(v))
			case string:
				if v != "" {
					key = "uid:" + v
				}
			}
		}

		lim := store.getOrCreate(key, r, burst)
		if !lim.Allow() {
			c.Header("Retry-After", "1")
			c.JSON(http.StatusTooManyRequests, types.NewErrorResponse("RATE_LIMIT_EXCEEDED", "Too many requests"))
			c.Abort()
			return
		}

		c.Next()
	}
}

// RateLimitAuthMiddleware applies a stricter per-IP limit for auth endpoints such as /login and /register.
// It is independent from the global limiter to avoid allowing brute force via general limits.
func RateLimitAuthMiddleware() gin.HandlerFunc {
	if isDisabled() {
		return func(c *gin.Context) { c.Next() }
	}
	// Hard-coded stricter limits suitable for auth: 1 rps, burst 5
	r := rate.Limit(1.0)
	burst := 5
	store := newIPLimiterStore(10 * time.Minute)
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		clientIP := c.ClientIP()
		lim := store.getOrCreate("auth:"+clientIP, r, burst)
		if !lim.Allow() {
			c.Header("Retry-After", "1")
			c.JSON(http.StatusTooManyRequests, types.NewErrorResponse("RATE_LIMIT_EXCEEDED", "Too many requests"))
			c.Abort()
			return
		}
		c.Next()
	}
}
