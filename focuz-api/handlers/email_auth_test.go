package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

// E-mail account flow against a server started with AUTH_MODE=email and MAIL_LOG_FILE.
// Run with: EMAIL_API_URL=http://localhost:8091 EMAIL_MAIL_LOG=/path/to/mail.log go test ./handlers -run TestEmailAccounts
func TestEmailAccounts(t *testing.T) {
	base, mailLog := os.Getenv("EMAIL_API_URL"), os.Getenv("EMAIL_MAIL_LOG")
	if base == "" || mailLog == "" {
		t.Skip("EMAIL_API_URL / EMAIL_MAIL_LOG not set")
	}
	call := func(method, path string, body any) (int, map[string]any) {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req, _ := http.NewRequest(method, base+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	lastMail := func(to string) (code, link string) {
		f, err := os.Open(mailLog)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		var text string
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		for sc.Scan() {
			var m struct{ To, Text string }
			if json.Unmarshal(sc.Bytes(), &m) == nil && m.To == to {
				text = m.Text
			}
		}
		if text == "" {
			t.Fatalf("no email to %s", to)
		}
		code = regexp.MustCompile(`\b(\d{6})\b`).FindString(text)
		link = regexp.MustCompile(`https?://\S+/auth/verify\?token=\S+`).FindString(text)
		return
	}

	code, cfg := call("GET", "/auth/config", nil)
	if code != 200 || cfg["data"].(map[string]any)["mode"] != "email" {
		t.Fatalf("config: %d %v", code, cfg)
	}

	email := fmt.Sprintf("Ann.%d@Example.org", time.Now().UnixNano())
	lower := strings.ToLower(email)

	// Invalid address is refused.
	if code, _ := call("POST", "/register", map[string]any{"email": "not-an-email", "password": "Password123"}); code != 400 {
		t.Fatalf("invalid email: %d", code)
	}
	code, out := call("POST", "/register", map[string]any{"email": email, "password": "Password123"})
	if code != 201 || out["data"].(map[string]any)["verificationRequired"] != true {
		t.Fatalf("register: %d %v", code, out)
	}
	// Cannot sign in before confirming (only revealed with the right password).
	code, out = call("POST", "/login", map[string]any{"email": email, "password": "Password123"})
	if code != 403 || out["error"].(map[string]any)["code"] != "EMAIL_NOT_VERIFIED" {
		t.Fatalf("login before verify: %d %v", code, out)
	}
	if code, _ := call("POST", "/login", map[string]any{"email": email, "password": "wrong-password"}); code != 401 {
		t.Fatalf("wrong password must stay 401, got %d", code)
	}

	good, _ := lastMail(lower)
	wrong := "000000"
	if good == wrong {
		wrong = "111111"
	}
	if code, _ := call("POST", "/auth/verify-email", map[string]any{"email": email, "code": wrong}); code != 400 {
		t.Fatalf("wrong code: %d", code)
	}
	code, out = call("POST", "/auth/verify-email", map[string]any{"email": email, "code": good})
	if code != 200 || out["data"].(map[string]any)["token"] == "" {
		t.Fatalf("verify: %d %v", code, out)
	}
	// Code is single use.
	if code, _ := call("POST", "/auth/verify-email", map[string]any{"email": email, "code": good}); code != 409 {
		t.Fatalf("reuse: %d", code)
	}
	code, out = call("POST", "/login", map[string]any{"email": strings.ToUpper(email), "password": "Password123"})
	if code != 200 {
		t.Fatalf("login after verify: %d %v", code, out)
	}
	// A confirmed address cannot be registered again.
	if code, _ := call("POST", "/register", map[string]any{"email": email, "password": "Other12345"}); code != 409 {
		t.Fatalf("duplicate: %d", code)
	}

	// Link confirmation (second account) and brute-force limit on codes (third account).
	email2 := fmt.Sprintf("link.%d@example.org", time.Now().UnixNano())
	call("POST", "/register", map[string]any{"email": email2, "password": "Password123"})
	_, link := lastMail(email2)
	if link == "" {
		t.Fatal("email has no confirmation link (is PUBLIC_API_URL set?)")
	}
	token := link[strings.Index(link, "token="):]
	resp, err := http.Get(base + "/auth/verify?" + token)
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(page), "Email confirmed") {
		t.Fatalf("link: %d %s", resp.StatusCode, page)
	}
	if code, _ := call("POST", "/login", map[string]any{"email": email2, "password": "Password123"}); code != 200 {
		t.Fatalf("login after link: %d", code)
	}
	resp, _ = http.Get(base + "/auth/verify?" + token)
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("link must be single use, got %d", resp.StatusCode)
	}

	email3 := fmt.Sprintf("brute.%d@example.org", time.Now().UnixNano())
	call("POST", "/register", map[string]any{"email": email3, "password": "Password123"})
	real3, _ := lastMail(email3)
	for i := 0; i < 5; i++ {
		guess := fmt.Sprintf("%06d", i)
		if guess == real3 {
			guess = "999999"
		}
		call("POST", "/auth/verify-email", map[string]any{"email": email3, "code": guess})
	}
	if code, _ := call("POST", "/auth/verify-email", map[string]any{"email": email3, "code": real3}); code != 429 {
		t.Fatalf("after 5 wrong codes the right one must be refused until a new code: %d", code)
	}
	// Someone who knows a pending address must not be able to set its password before the owner
	// confirms it.
	email4 := fmt.Sprintf("pending.%d@example.org", time.Now().UnixNano())
	call("POST", "/register", map[string]any{"email": email4, "password": "Password123"})
	if code, _ := call("POST", "/register", map[string]any{"email": email4, "password": "Attacker123"}); code != 201 {
		t.Fatalf("second sign-up of a pending address: %d", code)
	}
	code4, _ := lastMail(email4)
	if code, _ := call("POST", "/auth/verify-email", map[string]any{"email": email4, "code": code4}); code != 200 {
		t.Fatalf("verify pending: %d", code)
	}
	if code, _ := call("POST", "/login", map[string]any{"email": email4, "password": "Attacker123"}); code != 401 {
		t.Fatalf("second sign-up replaced the password of a pending account: %d", code)
	}
	if code, _ := call("POST", "/login", map[string]any{"email": email4, "password": "Password123"}); code != 200 {
		t.Fatalf("owner login: %d", code)
	}
	// Resend answers the same for unknown addresses.
	c1, _ := call("POST", "/auth/resend-verification", map[string]any{"email": "nobody@example.org"})
	c2, _ := call("POST", "/auth/resend-verification", map[string]any{"email": email3})
	if c1 != 200 || c2 != 200 {
		t.Fatalf("resend: %d %d", c1, c2)
	}
}

// Invitations on an e-mail server: by address, delivered by e-mail, and handed to an account that
// is created (and confirmed) later.
func TestEmailInvitations(t *testing.T) {
	base, mailLog := os.Getenv("EMAIL_API_URL"), os.Getenv("EMAIL_MAIL_LOG")
	if base == "" || mailLog == "" {
		t.Skip("EMAIL_API_URL / EMAIL_MAIL_LOG not set")
	}
	call := func(method, path, token string, body any) (int, map[string]any) {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req, _ := http.NewRequest(method, base+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	mails := func(to string) []string {
		var out []string
		data, _ := os.ReadFile(mailLog)
		for _, line := range strings.Split(string(data), "\n") {
			var m struct{ To, Subject, Text string }
			if json.Unmarshal([]byte(line), &m) == nil && m.To == to {
				out = append(out, m.Subject+"\n"+m.Text)
			}
		}
		return out
	}
	account := func(email string) string {
		if code, out := call("POST", "/register", "", map[string]any{"email": email, "password": "Password123"}); code != 201 {
			t.Fatalf("register %s: %d %v", email, code, out)
		}
		var code string
		for i := 0; i < 20 && code == ""; i++ {
			for _, m := range mails(email) {
				if c := regexp.MustCompile(`\b(\d{6})\b`).FindString(m); c != "" {
					code = c
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
		if st, out := call("POST", "/auth/verify-email", "", map[string]any{"email": email, "code": code}); st != 200 {
			t.Fatalf("verify %s: %d %v", email, st, out)
		}
		_, out := call("POST", "/login", "", map[string]any{"email": email, "password": "Password123"})
		return out["data"].(map[string]any)["token"].(string)
	}
	n := time.Now().UnixNano()
	owner := account(fmt.Sprintf("owner.%d@example.org", n))
	existing := fmt.Sprintf("carol.%d@example.org", n)
	carol := account(existing)
	later := fmt.Sprintf("dave.%d@example.org", n)

	code, out := call("POST", "/spaces", owner, map[string]any{"name": "Book club"})
	if code != 201 {
		t.Fatalf("space: %d %v", code, out)
	}
	space := int(out["data"].(map[string]any)["id"].(float64))
	path := fmt.Sprintf("/spaces/%d/invitations", space)
	if code, _ := call("POST", path, owner, map[string]any{"identifier": "carol", "role": "editor"}); code != 400 {
		t.Fatalf("a username is not accepted on an e-mail server: %d", code)
	}
	for _, who := range []string{existing, later} {
		if code, out := call("POST", path, owner, map[string]any{"identifier": who, "role": "editor"}); code != 200 {
			t.Fatalf("invite %s: %d %v", who, code, out)
		}
	}

	// Carol has an account: in-app invitation plus an e-mail (on by default).
	var got bool
	for i := 0; i < 30 && !got; i++ {
		for _, m := range mails(existing) {
			got = got || strings.Contains(m, "invited you to “Book club”")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !got {
		t.Fatal("carol should get an invitation e-mail")
	}
	if _, out := call("GET", "/invitations", carol, nil); len(out["data"].([]any)) != 1 {
		t.Fatalf("carol invitations: %v", out)
	}

	// Dave signs up later: the invitation waits for his confirmed address.
	dave := account(later)
	if _, out := call("GET", "/invitations", dave, nil); len(out["data"].([]any)) != 1 {
		t.Fatalf("dave should see the invitation after confirming: %v", out)
	}
	if code, out := call("PATCH", "/me", dave, map[string]any{"notifyEmail": false}); code != 200 || out["data"].(map[string]any)["emailNotificationsAvailable"] != true {
		t.Fatalf("settings: %d %v", code, out)
	}
}
