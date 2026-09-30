package repository

import (
	"database/sql"
	"errors"
	"focuz-api/models"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type UsersRepository struct {
	db *sql.DB
}

func NewUsersRepository(db *sql.DB) *UsersRepository { return &UsersRepository{db: db} }

const userColumns = `id, username, email, email_verified_at, password_hash, created_at`

func scanUser(row interface{ Scan(...any) error }) (*models.User, error) {
	var u models.User
	var email sql.NullString
	var verified sql.NullTime
	if err := row.Scan(&u.ID, &u.Username, &email, &verified, &u.PasswordHash, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if email.Valid {
		e := email.String
		u.Email = &e
	}
	if verified.Valid {
		t := verified.Time
		u.EmailVerifiedAt = &t
	}
	return &u, nil
}

// Create stores a new account. With an e-mail the account starts unverified.
func (r *UsersRepository) Create(username, password string, email *string) (*models.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	return scanUser(r.db.QueryRow(`
		INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3)
		RETURNING `+userColumns, strings.ToLower(username), string(hash), email))
}

// FindByLogin looks an account up by username or e-mail (case-insensitive).
func (r *UsersRepository) FindByLogin(login string) (*models.User, error) {
	l := strings.ToLower(strings.TrimSpace(login))
	return scanUser(r.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE username = $1 OR LOWER(email) = $1 ORDER BY (username = $1) DESC LIMIT 1`, l))
}

func (r *UsersRepository) FindByEmail(email string) (*models.User, error) {
	return scanUser(r.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE LOWER(email) = $1`, strings.ToLower(strings.TrimSpace(email))))
}

func (r *UsersRepository) UsernameTaken(username string) (bool, error) {
	var taken bool
	err := r.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`, strings.ToLower(username)).Scan(&taken)
	return taken, err
}

// SetPassword stores a new password and invalidates all existing login tokens of the user.
func (r *UsersRepository) SetPassword(userID int, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	// A new password signs out every session: tokens carry the old token_version.
	_, err = r.db.Exec(`UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`, userID, string(hash))
	return err
}

type EmailVerification struct {
	UserID    int
	CodeHash  string
	TokenHash string
	Attempts  int
	ExpiresAt time.Time
	SentAt    time.Time
}

// PutVerification replaces the pending verification of a user (a new code invalidates the old one).
func (r *UsersRepository) PutVerification(v EmailVerification) error {
	_, err := r.db.Exec(`
		INSERT INTO email_verifications (user_id, code_hash, token_hash, attempts, expires_at, sent_at)
		VALUES ($1, $2, $3, 0, $4, NOW())
		ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, token_hash = EXCLUDED.token_hash,
			attempts = 0, expires_at = EXCLUDED.expires_at, sent_at = NOW()
	`, v.UserID, v.CodeHash, v.TokenHash, v.ExpiresAt)
	return err
}

func scanVerification(row *sql.Row) (*EmailVerification, error) {
	var v EmailVerification
	err := row.Scan(&v.UserID, &v.CodeHash, &v.TokenHash, &v.Attempts, &v.ExpiresAt, &v.SentAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, err
}

func (r *UsersRepository) GetVerification(userID int) (*EmailVerification, error) {
	return scanVerification(r.db.QueryRow(`SELECT user_id, code_hash, token_hash, attempts, expires_at, sent_at FROM email_verifications WHERE user_id = $1`, userID))
}

func (r *UsersRepository) GetVerificationByToken(tokenHash string) (*EmailVerification, error) {
	return scanVerification(r.db.QueryRow(`SELECT user_id, code_hash, token_hash, attempts, expires_at, sent_at FROM email_verifications WHERE token_hash = $1`, tokenHash))
}

// UseAttempt counts one code attempt; false when the limit was already reached.
func (r *UsersRepository) UseAttempt(userID, max int) (bool, error) {
	res, err := r.db.Exec(`UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = $1 AND attempts < $2`, userID, max)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// MarkVerified confirms the e-mail and removes the pending verification.
func (r *UsersRepository) MarkVerified(userID int) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`UPDATE users SET email_verified_at = NOW() WHERE id = $1 AND email_verified_at IS NULL`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM email_verifications WHERE user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit()
}
