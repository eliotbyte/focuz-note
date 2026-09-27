// Package authcfg holds how accounts are identified on this server.
//
//	AUTH_MODE=username (default): sign up with a username, no e-mail involved.
//	AUTH_MODE=email: sign up with an e-mail address; the address must be confirmed before the
//	                 first sign-in. Accounts created earlier with a username keep working.
//	PUBLIC_API_URL: the address users reach this API at (e.g. https://notes.example.com/api).
//	                Used for the confirmation link in e-mails; without it the e-mail only
//	                contains the code.
//	REGISTRATION=open (default) | closed: whether new accounts can be created.
package authcfg

import (
	"fmt"
	"os"
	"strings"
)

type Mode string

const (
	ModeUsername Mode = "username"
	ModeEmail    Mode = "email"
)

type Config struct {
	Mode             Mode
	PublicAPIURL     string
	RegistrationOpen bool
}

func FromEnv() (Config, error) {
	c := Config{Mode: ModeUsername, RegistrationOpen: true}
	switch m := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_MODE"))); m {
	case "", "username":
	case "email":
		c.Mode = ModeEmail
	default:
		return c, fmt.Errorf("AUTH_MODE must be username or email, got %q", m)
	}
	switch r := strings.ToLower(strings.TrimSpace(os.Getenv("REGISTRATION"))); r {
	case "", "open":
	case "closed":
		c.RegistrationOpen = false
	default:
		return c, fmt.Errorf("REGISTRATION must be open or closed, got %q", r)
	}
	c.PublicAPIURL = strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_API_URL")), "/")
	return c, nil
}
