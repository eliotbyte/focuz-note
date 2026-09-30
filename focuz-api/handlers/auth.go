package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"html/template"
	"log/slog"
	"math/big"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"focuz-api/models"
	"focuz-api/pkg/authcfg"
	"focuz-api/pkg/authtoken"
	"focuz-api/pkg/buildinfo"
	"focuz-api/pkg/mailer"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

const (
	verificationTTL         = time.Hour
	verificationMaxTries    = 5
	verificationResendWait  = 60 * time.Second
	errCodeEmailNotVerified = "EMAIL_NOT_VERIFIED"
)

// AuthHandler: accounts, sign-in and e-mail confirmation.
type AuthHandler struct {
	users *repository.UsersRepository
	cfg   authcfg.Config
	mail  mailer.Mailer
	// onVerified runs after an e-mail address is confirmed (e.g. to deliver pending invitations).
	onVerified func(userID int)
	tokens     *authtoken.Tokens
}

// OnEmailVerified registers a hook that runs after an address is confirmed.
func (h *AuthHandler) OnEmailVerified(f func(userID int)) *AuthHandler {
	h.onVerified = f
	return h
}

func NewAuthHandler(users *repository.UsersRepository, cfg authcfg.Config, m mailer.Mailer, tokens *authtoken.Tokens) *AuthHandler {
	return &AuthHandler{users: users, cfg: cfg, mail: m, tokens: tokens}
}

// Config is public: the web app reads it to show the right sign-in form for this server.
// GET /auth/config
func (h *AuthHandler) Config(c *gin.Context) {
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{
		"app":          "focuz",
		"version":      buildinfo.Version,
		"mode":         h.cfg.Mode,
		"registration": map[bool]string{true: "open", false: "closed"}[h.cfg.RegistrationOpen],
	}))
}

// POST /register  {username, password} or, in e-mail mode, {email, password}
func (h *AuthHandler) Register(c *gin.Context) {
	if !h.cfg.RegistrationOpen {
		c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, "Registration is closed on this server"))
		return
	}
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Password must be at least 8 characters"))
		return
	}
	if len(req.Password) > 72 {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Password must be at most 72 characters"))
		return
	}
	if h.cfg.Mode == authcfg.ModeEmail {
		h.registerWithEmail(c, req.Email, req.Password)
		return
	}

	username := strings.ToLower(strings.TrimSpace(req.Username))
	if len(username) < 3 || len(username) > 50 {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Username must be between 3 and 50 characters"))
		return
	}
	user, err := h.users.Create(username, req.Password, nil)
	if err != nil {
		if pgErr, ok := err.(*pq.Error); ok && string(pgErr.Code) == "23505" {
			c.JSON(http.StatusConflict, types.NewErrorResponse(types.ErrorCodeConflict, "Username already exists"))
			return
		}
		slog.Error("register failed", "err", err)
		c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, "Failed to register user"))
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(user))
}

func normalizeEmail(raw string) (string, bool) {
	e := strings.ToLower(strings.TrimSpace(raw))
	if len(e) < 3 || len(e) > 254 {
		return "", false
	}
	addr, err := mail.ParseAddress(e)
	if err != nil || addr.Address != e || !strings.Contains(e[strings.LastIndex(e, "@")+1:], ".") {
		return "", false
	}
	return e, true
}

var handleChars = regexp.MustCompile(`[^a-z0-9._-]+`)

// handleFor derives a free username (used for display and invites) from an e-mail address.
func (h *AuthHandler) handleFor(email string) (string, error) {
	base := handleChars.ReplaceAllString(strings.Split(email, "@")[0], "")
	if len(base) > 40 {
		base = base[:40]
	}
	for len(base) < 3 {
		base += "0"
	}
	candidate := base
	for i := 0; i < 8; i++ {
		taken, err := h.users.UsernameTaken(candidate)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
		n, _ := rand.Int(rand.Reader, big.NewInt(9000))
		candidate = fmt.Sprintf("%s%d", base, 1000+n.Int64())
	}
	return "", fmt.Errorf("could not find a free username for %s", email)
}

func (h *AuthHandler) registerWithEmail(c *gin.Context, rawEmail, password string) {
	email, ok := normalizeEmail(rawEmail)
	if !ok {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Enter a valid email address"))
		return
	}
	existing, err := h.users.FindByEmail(email)
	if err != nil {
		h.internal(c, "find user by email", err)
		return
	}
	var user *models.User
	switch {
	case existing != nil && !existing.NeedsEmailVerification():
		c.JSON(http.StatusConflict, types.NewErrorResponse(types.ErrorCodeConflict, "An account with this email already exists"))
		return
	case existing != nil:
		// Never confirmed. While its code is still valid the sign-up is not abandoned: replacing
		// the password then would let anyone who knows the address take the account over as
		// soon as its owner enters the code. Only resend the code.
		v, err := h.users.GetVerification(existing.ID)
		if err != nil {
			h.internal(c, "get verification", err)
			return
		}
		if v != nil && time.Now().Before(v.ExpiresAt) {
			if time.Since(v.SentAt) >= verificationResendWait {
				if err := h.sendVerification(existing, email); err != nil {
					slog.Error("resending verification email failed", "err", err)
				}
			}
			c.JSON(http.StatusCreated, types.NewSuccessResponse(gin.H{"verificationRequired": true, "email": email}))
			return
		}
		// Abandoned (code expired): the new sign-up with its password replaces it.
		if err := h.users.SetPassword(existing.ID, password); err != nil {
			h.internal(c, "reset unverified password", err)
			return
		}
		user = existing
	default:
		handle, err := h.handleFor(email)
		if err != nil {
			h.internal(c, "derive username", err)
			return
		}
		user, err = h.users.Create(handle, password, &email)
		if err != nil {
			if pgErr, ok := err.(*pq.Error); ok && string(pgErr.Code) == "23505" {
				c.JSON(http.StatusConflict, types.NewErrorResponse(types.ErrorCodeConflict, "An account with this email already exists"))
				return
			}
			h.internal(c, "create user", err)
			return
		}
	}
	if err := h.sendVerification(user, email); err != nil {
		slog.Error("sending verification email failed", "err", err)
		c.JSON(http.StatusBadGateway, types.NewErrorResponse("EMAIL_SEND_FAILED", "Your account was created, but the confirmation email could not be sent. Try “Send a new code” in a minute."))
		return
	}
	c.JSON(http.StatusCreated, types.NewSuccessResponse(gin.H{"verificationRequired": true, "email": email}))
}

func randomDigits(n int) (string, error) {
	var b strings.Builder
	for i := 0; i < n; i++ {
		d, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b.WriteByte(byte('0' + d.Int64()))
	}
	return b.String(), nil
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (h *AuthHandler) sendVerification(user *models.User, email string) error {
	code, err := randomDigits(6)
	if err != nil {
		return err
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return err
	}
	token := hex.EncodeToString(tokenBytes)
	if err := h.users.PutVerification(repository.EmailVerification{
		UserID: user.ID, CodeHash: sha256Hex(code), TokenHash: sha256Hex(token), ExpiresAt: time.Now().Add(verificationTTL),
	}); err != nil {
		return err
	}
	var body strings.Builder
	fmt.Fprintf(&body, "Hi,\n\nYour focuz confirmation code is:\n\n    %s\n\nEnter it in the app to finish creating your account. The code expires in %d minutes.\n", code, int(verificationTTL.Minutes()))
	if h.cfg.PublicAPIURL != "" {
		fmt.Fprintf(&body, "\nOr confirm with this link:\n%s/auth/verify?token=%s\n", h.cfg.PublicAPIURL, token)
	}
	body.WriteString("\nIf you did not sign up for focuz, you can ignore this email.\n")
	return h.mail.Send(mailer.Message{To: email, Subject: "Your focuz confirmation code: " + code, Text: body.String()})
}

// POST /login  {username | email, password}
func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	login := strings.ToLower(strings.TrimSpace(req.Username))
	if login == "" {
		login = strings.ToLower(strings.TrimSpace(req.Email))
	}
	if login == "" {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "username or email is required"))
		return
	}
	if failedLogins.Blocked(login) {
		c.JSON(http.StatusTooManyRequests, types.NewErrorResponse("RATE_LIMIT_EXCEEDED", "Too many failed attempts, try again later"))
		return
	}
	user, err := h.users.FindByLogin(login)
	hash := dummyHash
	if err == nil && user != nil {
		hash = []byte(user.PasswordHash)
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(req.Password)) != nil || err != nil || user == nil {
		failedLogins.Failed(login)
		c.JSON(http.StatusUnauthorized, types.NewErrorResponse(types.ErrorCodeUnauthorized, "Invalid username or password"))
		return
	}
	failedLogins.Succeeded(login)
	// Only revealed after the correct password, so it does not leak which addresses exist.
	if user.NeedsEmailVerification() {
		c.JSON(http.StatusForbidden, types.NewErrorResponseWithDetails(errCodeEmailNotVerified, "Confirm your email address to sign in", map[string]interface{}{"email": *user.Email}))
		return
	}
	token, err := h.tokens.Issue(user.ID)
	if err != nil {
		h.internal(c, "sign token", err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"token": token}))
}

// POST /auth/verify-email {email, code} -> signs the user in on success.
func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required"`
		Code  string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	wrong := func() {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse("INVALID_CODE", "That code is not correct"))
	}
	user, err := h.users.FindByEmail(req.Email)
	if err != nil {
		h.internal(c, "find user by email", err)
		return
	}
	if user == nil {
		wrong()
		return
	}
	if !user.NeedsEmailVerification() {
		c.JSON(http.StatusConflict, types.NewErrorResponse("ALREADY_VERIFIED", "This email is already confirmed. Sign in with your password."))
		return
	}
	v, err := h.users.GetVerification(user.ID)
	if err != nil {
		h.internal(c, "get verification", err)
		return
	}
	if v == nil || time.Now().After(v.ExpiresAt) {
		c.JSON(http.StatusGone, types.NewErrorResponse("CODE_EXPIRED", "This code has expired. Request a new one."))
		return
	}
	// Take one attempt atomically before comparing, so parallel guesses cannot exceed the limit.
	allowed, err := h.users.UseAttempt(user.ID, verificationMaxTries)
	if err != nil {
		h.internal(c, "count attempt", err)
		return
	}
	if !allowed {
		c.JSON(http.StatusTooManyRequests, types.NewErrorResponse("TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new one."))
		return
	}
	code := strings.Join(strings.Fields(req.Code), "")
	if subtle.ConstantTimeCompare([]byte(sha256Hex(code)), []byte(v.CodeHash)) != 1 {
		wrong()
		return
	}
	if err := h.users.MarkVerified(user.ID); err != nil {
		h.internal(c, "mark verified", err)
		return
	}
	if h.onVerified != nil {
		h.onVerified(user.ID)
	}
	token, err := h.tokens.Issue(user.ID)
	if err != nil {
		h.internal(c, "sign token", err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"token": token, "username": user.Username}))
}

// POST /auth/resend-verification {email}. Always answers the same way (no account enumeration).
func (h *AuthHandler) ResendVerification(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, err.Error()))
		return
	}
	ok := gin.H{"message": "If this address has an unconfirmed account, a new code is on its way.", "retryAfterSeconds": int(verificationResendWait.Seconds())}
	user, err := h.users.FindByEmail(req.Email)
	if err != nil || user == nil || !user.NeedsEmailVerification() {
		c.JSON(http.StatusOK, types.NewSuccessResponse(ok))
		return
	}
	if v, err := h.users.GetVerification(user.ID); err == nil && v != nil && time.Since(v.SentAt) < verificationResendWait {
		c.JSON(http.StatusOK, types.NewSuccessResponse(ok))
		return
	}
	if err := h.sendVerification(user, *user.Email); err != nil {
		slog.Error("resending verification email failed", "err", err)
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(ok))
}

var verifyPage = template.Must(template.New("verify").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}} · focuz</title>
<style>
:root{color-scheme:light dark;--bg:#eef0f3;--card:#fff;--text:#0f1720;--muted:#5a6673;--accent:#0284c7}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--card:#161616;--text:#f1f5f9;--muted:#9aa4af;--accent:#38bdf8}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{background:var(--card);border-radius:14px;padding:32px;max-width:420px;box-shadow:0 10px 30px -10px rgba(0,0,0,.35)}
h1{margin:0 0 8px;font-size:22px}p{margin:0;color:var(--muted)}.logo{font-weight:800;margin-bottom:20px;color:var(--accent)}
</style></head><body><main><div class="logo">focuz</div><h1>{{.Title}}</h1><p>{{.Text}}</p></main></body></html>`))

// GET /auth/verify?token=... (link from the e-mail). Works without the web app.
func (h *AuthHandler) VerifyEmailLink(c *gin.Context) {
	render := func(status int, title, text string) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		c.Header("Referrer-Policy", "no-referrer")
		c.Status(status)
		_ = verifyPage.Execute(c.Writer, struct{ Title, Text string }{title, text})
	}
	token := strings.TrimSpace(c.Query("token"))
	if token == "" {
		render(http.StatusBadRequest, "Link is incomplete", "Open the link from the email again, or enter the 6-digit code in the app.")
		return
	}
	v, err := h.users.GetVerificationByToken(sha256Hex(token))
	if err != nil {
		slog.Error("verify link lookup failed", "err", err)
		render(http.StatusInternalServerError, "Something went wrong", "Try the link again in a moment, or enter the code in the app.")
		return
	}
	if v == nil {
		render(http.StatusNotFound, "Link is no longer valid", "It was already used or a newer code was sent. If you cannot sign in yet, request a new code in the app.")
		return
	}
	if time.Now().After(v.ExpiresAt) {
		render(http.StatusGone, "Link has expired", "Request a new code in the app.")
		return
	}
	if err := h.users.MarkVerified(v.UserID); err != nil {
		slog.Error("mark verified failed", "err", err)
		render(http.StatusInternalServerError, "Something went wrong", "Try the link again in a moment, or enter the code in the app.")
		return
	}
	if h.onVerified != nil {
		h.onVerified(v.UserID)
	}
	render(http.StatusOK, "Email confirmed", "You can close this page and sign in to focuz with your email and password.")
}

func (h *AuthHandler) internal(c *gin.Context, what string, err error) {
	slog.Error("auth: "+what, "err", err)
	c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, "Something went wrong, try again"))
}
