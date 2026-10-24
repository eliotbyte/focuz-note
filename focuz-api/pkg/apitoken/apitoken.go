// Package apitoken makes personal API tokens for agents and scripts. A token looks like
// "fct_<random>". Only its SHA-256 hash is stored, so a leaked database does not reveal tokens.
package apitoken

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

const Prefix = "fct_"

// Generate returns a new random token (256 bits of entropy).
func Generate() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return Prefix + base64.RawURLEncoding.EncodeToString(b), nil
}

// IsAPIToken reports whether a bearer value is an API token rather than a login token.
func IsAPIToken(raw string) bool { return strings.HasPrefix(raw, Prefix) }

// Hash is what gets stored and looked up. Tokens are random, so a fast hash is enough.
func Hash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// DisplayPrefix returns the start of a token, enough to tell tokens apart in a list.
func DisplayPrefix(raw string) string {
	if len(raw) > 12 {
		return raw[:12]
	}
	return raw
}
