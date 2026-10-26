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

// File links let an agent move file bytes outside MCP (a shell runs curl with the link): upload to one
// note, or download one attachment. They are short-lived, signed like login tokens but for another
// audience, so neither kind can stand in for the other. They carry the token version too: changing
// the password ends them. Whoever uses a link gets the user's current rights, checked at that time.
const (
	fileLinkAudience = "focuz-file-link"
	FileLinkLifetime = 15 * time.Minute

	FileLinkUpload   = "upload"
	FileLinkDownload = "download"
)

// IssueFileLink signs a link of kind (FileLinkUpload, FileLinkDownload) for target (a note id, an
// attachment id).
func (t *Tokens) IssueFileLink(userID int, kind, target string) (string, time.Time, error) {
	var version int
	if err := t.db.QueryRow(`SELECT token_version FROM users WHERE id = $1`, userID).Scan(&version); err != nil {
		return "", time.Time{}, err
	}
	now := time.Now()
	exp := now.Add(FileLinkLifetime)
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"userId": userID,
		"tv":     version,
		"kind":   kind,
		"target": target,
		"iat":    now.Unix(),
		"exp":    exp.Unix(),
		"iss":    issuer,
		"aud":    fileLinkAudience,
	}).SignedString(t.secret)
	return s, exp, err
}

// VerifyFileLink returns the user and target of a valid link of this kind.
func (t *Tokens) VerifyFileLink(raw, kind string) (int, string, error) {
	token, err := jwt.Parse(raw, func(*jwt.Token) (interface{}, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithAudience(fileLinkAudience),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid {
		return 0, "", ErrInvalid
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, "", ErrInvalid
	}
	uid, _ := claims["userId"].(float64)
	tv, _ := claims["tv"].(float64)
	gotKind, _ := claims["kind"].(string)
	target, _ := claims["target"].(string)
	if uid <= 0 || gotKind != kind || target == "" {
		return 0, "", ErrInvalid
	}
	var current int
	err = t.db.QueryRow(`SELECT token_version FROM users WHERE id = $1`, int(uid)).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && int(tv) != current) {
		return 0, "", ErrInvalid
	}
	if err != nil {
		return 0, "", err
	}
	return int(uid), target, nil
}
