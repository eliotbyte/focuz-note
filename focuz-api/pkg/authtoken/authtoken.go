// Package authtoken issues and checks login tokens (HS256 JWT).
//
// Each token carries the user's token_version ("tv"). Changing the password bumps the version, so
// every token issued before stops working, including stolen ones.
package authtoken

import (
	"database/sql"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	issuer   = "focuz-api"
	audience = "focuz-fe"
	lifetime = 24 * time.Hour
)

var ErrInvalid = errors.New("invalid token")

type Tokens struct {
	secret []byte
	db     *sql.DB
}

func New(secret string, db *sql.DB) *Tokens {
	return &Tokens{secret: []byte(secret), db: db}
}

// Issue signs a token for the user's current token version.
func (t *Tokens) Issue(userID int) (string, error) {
	var version int
	if err := t.db.QueryRow(`SELECT token_version FROM users WHERE id = $1`, userID).Scan(&version); err != nil {
		return "", err
	}
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"userId": userID,
		"tv":     version,
		"iat":    now.Unix(),
		"exp":    now.Add(lifetime).Unix(),
		"iss":    issuer,
		"aud":    audience,
	}).SignedString(t.secret)
}

// Verify returns the user id of a valid token whose user still exists and whose version is current.
// Tokens issued before versions existed carry no "tv" and count as version 0.
func (t *Tokens) Verify(raw string) (int, error) {
	token, err := jwt.Parse(raw, func(*jwt.Token) (interface{}, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid {
		return 0, ErrInvalid
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, ErrInvalid
	}
	uid, ok := claims["userId"].(float64)
	if !ok || uid <= 0 {
		return 0, ErrInvalid
	}
	tokenVersion := 0
	if v, present := claims["tv"]; present {
		f, ok := v.(float64)
		if !ok {
			return 0, ErrInvalid
		}
		tokenVersion = int(f)
	}
	var current int
	err = t.db.QueryRow(`SELECT token_version FROM users WHERE id = $1`, int(uid)).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrInvalid
	}
	if err != nil {
		return 0, err
	}
	if tokenVersion != current {
		return 0, ErrInvalid
	}
	return int(uid), nil
}
