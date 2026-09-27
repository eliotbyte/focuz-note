// Package mailer sends transactional e-mail (account verification).
//
// Configuration (environment):
//
//	SMTP_HOST, SMTP_PORT (default 587), SMTP_USERNAME, SMTP_PASSWORD,
//	SMTP_FROM (e.g. "Focuz <no-reply@example.com>"),
//	SMTP_SECURITY: "starttls" (default), "tls" (implicit TLS, usually port 465) or "none".
//
// Without SMTP_HOST, messages are written to the server log instead (and appended to
// MAIL_LOG_FILE as JSON lines when set), which is enough for a single-user or test setup.
package mailer

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Message struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

type Mailer interface {
	Send(msg Message) error
	// Describe is a short, secret-free description for startup logs.
	Describe() string
}

func FromEnv() (Mailer, error) {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	if host == "" {
		return &LogMailer{File: strings.TrimSpace(os.Getenv("MAIL_LOG_FILE"))}, nil
	}
	port := 587
	if p := strings.TrimSpace(os.Getenv("SMTP_PORT")); p != "" {
		v, err := strconv.Atoi(p)
		if err != nil || v <= 0 {
			return nil, fmt.Errorf("invalid SMTP_PORT %q", p)
		}
		port = v
	}
	security := strings.ToLower(strings.TrimSpace(os.Getenv("SMTP_SECURITY")))
	if security == "" {
		security = "starttls"
	}
	if security != "starttls" && security != "tls" && security != "none" {
		return nil, fmt.Errorf("SMTP_SECURITY must be starttls, tls or none, got %q", security)
	}
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	if from == "" {
		return nil, errors.New("SMTP_FROM is required when SMTP_HOST is set")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return nil, fmt.Errorf("invalid SMTP_FROM: %w", err)
	}
	return &SMTPMailer{
		Host: host, Port: port, Security: security, From: from,
		Username: os.Getenv("SMTP_USERNAME"), Password: os.Getenv("SMTP_PASSWORD"),
	}, nil
}

// LogMailer prints messages instead of sending them.
type LogMailer struct {
	File string
	mu   sync.Mutex
}

func (m *LogMailer) Describe() string { return "log (SMTP_HOST not set: e-mails are written to the server log)" }

func (m *LogMailer) Send(msg Message) error {
	slog.Info("email (not sent: SMTP is not configured)", "to", msg.To, "subject", msg.Subject, "body", msg.Text)
	if m.File == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	f, err := os.OpenFile(m.File, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	b, _ := json.Marshal(struct {
		Message
		At time.Time `json:"at"`
	}{msg, time.Now().UTC()})
	_, err = f.Write(append(b, '\n'))
	return err
}

type SMTPMailer struct {
	Host, Security, From, Username, Password string
	Port                                     int
}

func (m *SMTPMailer) Describe() string {
	return fmt.Sprintf("smtp %s:%d (%s) from %s", m.Host, m.Port, m.Security, m.From)
}

func (m *SMTPMailer) Send(msg Message) error {
	fromAddr, err := mail.ParseAddress(m.From)
	if err != nil {
		return err
	}
	toAddr, err := mail.ParseAddress(msg.To)
	if err != nil {
		return err
	}
	body := buildMessage(m.From, toAddr.String(), msg, fromAddr.Address)

	addr := net.JoinHostPort(m.Host, strconv.Itoa(m.Port))
	tlsCfg := &tls.Config{ServerName: m.Host, MinVersion: tls.VersionTLS12}
	var conn net.Conn
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	if m.Security == "tls" {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	c, err := smtp.NewClient(conn, m.Host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if m.Security == "starttls" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("SMTP server does not support STARTTLS (set SMTP_SECURITY=tls or none)")
		}
		if err := c.StartTLS(tlsCfg); err != nil {
			return err
		}
	}
	if m.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", m.Username, m.Password, m.Host)); err != nil {
			return err
		}
	}
	if err := c.Mail(fromAddr.Address); err != nil {
		return err
	}
	if err := c.Rcpt(toAddr.Address); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func buildMessage(from, to string, msg Message, fromDomainAddr string) []byte {
	domain := "localhost"
	if i := strings.LastIndex(fromDomainAddr, "@"); i >= 0 {
		domain = fromDomainAddr[i+1:]
	}
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", msg.Subject) + "\r\n")
	b.WriteString("Date: " + time.Now().UTC().Format(time.RFC1123Z) + "\r\n")
	b.WriteString(fmt.Sprintf("Message-ID: <%d.focuz@%s>\r\n", time.Now().UnixNano(), domain))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(strings.ReplaceAll(msg.Text, "\n", "\r\n"))
	return []byte(b.String())
}
