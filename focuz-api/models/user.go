package models

import "time"

type User struct {
	ID              int        `json:"id"`
	Username        string     `json:"username"`
	Email           *string    `json:"email,omitempty"`
	EmailVerifiedAt *time.Time `json:"-"`
	PasswordHash    string     `json:"-"`
	CreatedAt       time.Time  `json:"createdAt"`
}

// NeedsEmailVerification is true for e-mail accounts whose address was not confirmed yet.
func (u *User) NeedsEmailVerification() bool {
	return u.Email != nil && u.EmailVerifiedAt == nil
}
