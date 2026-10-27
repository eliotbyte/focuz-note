package handlers

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestBaseURL(t *testing.T) {
	cases := []struct {
		name       string
		headers    map[string]string
		configured string
		want       string
	}{
		{"configured wins", map[string]string{"X-Forwarded-Prefix": "/api"}, "https://n.example/api", "https://n.example/api"},
		{"plain", nil, "", "http://api.local:8080"},
		{"proxy with prefix", map[string]string{"X-Forwarded-Proto": "https", "X-Forwarded-Host": "notes.example", "X-Forwarded-Prefix": "/api/"}, "", "https://notes.example/api"},
		{"first of a list", map[string]string{"X-Forwarded-Proto": "https, http", "X-Forwarded-Host": "a.example, b.example"}, "", "https://a.example"},
		{"odd prefix ignored", map[string]string{"X-Forwarded-Prefix": "//evil.example"}, "", "http://api.local:8080"},
		{"odd host ignored", map[string]string{"X-Forwarded-Host": "evil.example/x"}, "", "http://api.local:8080"},
	}
	for _, tc := range cases {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "http://api.local:8080/mcp", nil)
		for k, v := range tc.headers {
			c.Request.Header.Set(k, v)
		}
		if got := requestBaseURL(c, tc.configured); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
