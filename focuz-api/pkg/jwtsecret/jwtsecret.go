// Package jwtsecret resolves the key that signs login tokens.
package jwtsecret

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"focuz-api/pkg/appenv"
)

// Secrets published in this repository (compose defaults, examples): anyone can mint tokens for any
// user with them.
var known = []string{
	"dev-secret-change-me-please-0123456789abcdef",
	"your_super_secret_jwt_key_at_least_32_chars_long",
	"your_secret_key_here",
}

// The test compose file uses this one; it is accepted only with APP_ENV=test.
const testSecret = "test-secret-change-me-please-0123456789abcdef"

// Resolve returns JWT_SECRET if set, rejecting short and publicly known values. When it is unset,
// a random secret is generated once and kept in the database, so every restart (and every API
// replica) signs with the same key.
func Resolve(db *sql.DB) (secret string, generated bool, err error) {
	secret = strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		secret, err = fromDB(db)
		return secret, true, err
	}
	if len(secret) < 32 {
		return "", false, fmt.Errorf("JWT_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`), or unset to let the server generate one")
	}
	if secret == testSecret && appenv.IsTest() {
		return secret, false, nil
	}
	for _, k := range append(known, testSecret) {
		if secret == k {
			return "", false, fmt.Errorf("JWT_SECRET is a publicly known default value: anyone could forge login tokens. Set a random one (e.g. `openssl rand -hex 32`) or unset it to let the server generate one; everyone will need to sign in again")
		}
	}
	return secret, false, nil
}

func fromDB(db *sql.DB) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	// ON CONFLICT: another replica may have generated it first; everyone uses the stored value.
	if _, err := db.Exec(`INSERT INTO server_settings (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO NOTHING`, hex.EncodeToString(buf)); err != nil {
		return "", fmt.Errorf("store generated JWT secret: %w", err)
	}
	var secret string
	if err := db.QueryRow(`SELECT value FROM server_settings WHERE key = 'jwt_secret'`).Scan(&secret); err != nil {
		return "", fmt.Errorf("load generated JWT secret: %w", err)
	}
	return secret, nil
}
