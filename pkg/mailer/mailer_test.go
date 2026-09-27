package mailer

import (
	"bufio"
	"net"
	"strconv"
	"strings"
	"testing"
)

// fakeSMTP accepts one message over plain SMTP and returns what it received.
func fakeSMTP(t *testing.T) (port int, got chan string) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	got = make(chan string, 1)
	go func() {
		defer ln.Close()
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		w := func(s string) { _, _ = conn.Write([]byte(s + "\r\n")) }
		w("220 fake ESMTP")
		var transcript strings.Builder
		inData := false
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			if inData {
				if line == ".\r\n" {
					inData = false
					w("250 queued")
					continue
				}
				transcript.WriteString(line)
				continue
			}
			transcript.WriteString(line)
			cmd := strings.ToUpper(strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
				w("250 fake")
			case strings.HasPrefix(cmd, "DATA"):
				inData = true
				w("354 go ahead")
			case strings.HasPrefix(cmd, "QUIT"):
				w("221 bye")
				got <- transcript.String()
				return
			default:
				w("250 ok")
			}
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, got
}

func TestSMTPMailerSends(t *testing.T) {
	port, got := fakeSMTP(t)
	m := &SMTPMailer{Host: "127.0.0.1", Port: port, Security: "none", From: "Focuz <no-reply@example.org>"}
	if err := m.Send(Message{To: "ann@example.org", Subject: "Код: 123456", Text: "line 1\nline 2"}); err != nil {
		t.Fatal(err)
	}
	s := <-got
	for _, want := range []string{"MAIL FROM:<no-reply@example.org>", "RCPT TO:<ann@example.org>", "Subject: =?utf-8?q?", "line 1\r\nline 2"} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q in:\n%s", want, s)
		}
	}
}

func TestFromEnvValidates(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	if m, err := FromEnv(); err != nil || !strings.HasPrefix(m.Describe(), "log") {
		t.Fatalf("no SMTP_HOST must give the log mailer: %v %v", m, err)
	}
	t.Setenv("SMTP_HOST", "smtp.example.org")
	t.Setenv("SMTP_FROM", "")
	if _, err := FromEnv(); err == nil {
		t.Fatal("SMTP_FROM must be required")
	}
	t.Setenv("SMTP_FROM", "no-reply@example.org")
	t.Setenv("SMTP_PORT", "465")
	t.Setenv("SMTP_SECURITY", "tls")
	m, err := FromEnv()
	if err != nil || !strings.Contains(m.Describe(), "smtp.example.org:"+strconv.Itoa(465)) {
		t.Fatalf("%v %v", m, err)
	}
	t.Setenv("SMTP_SECURITY", "ssl3")
	if _, err := FromEnv(); err == nil {
		t.Fatal("bad SMTP_SECURITY must fail")
	}
}
