package repository

import (
	"database/sql"
	"errors"
	"time"
)

type APITokensRepository struct {
	db *sql.DB
}

func NewAPITokensRepository(db *sql.DB) *APITokensRepository {
	return &APITokensRepository{db: db}
}

// APIToken is a stored token without its secret.
type APIToken struct {
	ID         int        `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Scope      string     `json:"scope"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
}

func (r *APITokensRepository) Create(userID int, name, scope, prefix, hash string) (*APIToken, error) {
	var t APIToken
	var lastUsed sql.NullTime
	err := r.db.QueryRow(`
		INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, scope)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, name, token_prefix, scope, created_at, last_used_at
	`, userID, name, prefix, hash, scope).Scan(&t.ID, &t.Name, &t.Prefix, &t.Scope, &t.CreatedAt, &lastUsed)
	if err != nil {
		return nil, err
	}
	if lastUsed.Valid {
		v := lastUsed.Time
		t.LastUsedAt = &v
	}
	return &t, nil
}

// List returns the user's tokens that are not revoked, newest first.
func (r *APITokensRepository) List(userID int) ([]APIToken, error) {
	rows, err := r.db.Query(`
		SELECT id, name, token_prefix, scope, created_at, last_used_at
		FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY created_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []APIToken{}
	for rows.Next() {
		var t APIToken
		var lastUsed sql.NullTime
		if err := rows.Scan(&t.ID, &t.Name, &t.Prefix, &t.Scope, &t.CreatedAt, &lastUsed); err != nil {
			return nil, err
		}
		if lastUsed.Valid {
			v := lastUsed.Time
			t.LastUsedAt = &v
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Revoke stops one of the user's tokens. ErrNotFound when it does not exist or is already revoked.
func (r *APITokensRepository) Revoke(userID, id int) error {
	res, err := r.db.Exec(`UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Authenticate returns the owner and scope of an active token and records that it was used.
func (r *APITokensRepository) Authenticate(hash string) (userID int, scope string, err error) {
	var tokenID int
	err = r.db.QueryRow(`
		SELECT id, user_id, scope FROM api_tokens
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, hash).Scan(&tokenID, &userID, &scope)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", ErrNotFound
	}
	if err != nil {
		return 0, "", err
	}
	// Best effort: a failed "last used" update must not fail the request.
	_, _ = r.db.Exec(`UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1`, tokenID)
	return userID, scope, nil
}
