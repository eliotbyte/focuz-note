package handlers

import (
	"fmt"
	"net/http"
)

// Personal API tokens: a read-scope token only reads (REST and MCP), no token can manage tokens,
// and a revoked token stops working at once.
func (s *E2ETestSuite) Test320_APITokens_ScopeAndRevoke() {
	newToken := func(scope string) (string, int) {
		code, out := s.call("POST", "/me/api-tokens", s.ownerToken, map[string]any{"name": "test " + scope, "scope": scope})
		s.Require().Equal(http.StatusCreated, code, out)
		data := out["data"].(map[string]any)
		return data["token"].(string), int(data["info"].(map[string]any)["id"].(float64))
	}
	readTok, readID := newToken("read")
	writeTok, writeID := newToken("write")
	note := fmt.Sprintf("/notes/%d", s.createdNoteID)

	code, _ := s.call("GET", note, readTok, nil)
	s.Equal(http.StatusOK, code)
	code, _ = s.call("PATCH", note, readTok, map[string]any{"text": "changed by a read token"})
	s.Equal(http.StatusForbidden, code)

	mcpCall := func(token string) map[string]any {
		code, out := s.call("POST", "/mcp", token, map[string]any{
			"jsonrpc": "2.0", "id": 1, "method": "tools/call",
			"params": map[string]any{"name": "create_note", "arguments": map[string]any{"spaceId": s.createdSpaceID, "text": "from mcp"}},
		})
		s.Require().Equal(http.StatusOK, code, out)
		return out["result"].(map[string]any)
	}
	s.Equal(true, mcpCall(readTok)["isError"])
	s.Equal(false, mcpCall(writeTok)["isError"])

	// Tokens are managed only with a sign-in.
	code, _ = s.call("GET", "/me/api-tokens", writeTok, nil)
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("POST", "/me/api-tokens", writeTok, map[string]any{"name": "minted by a token", "scope": "write"})
	s.Equal(http.StatusForbidden, code)

	code, _ = s.call("DELETE", fmt.Sprintf("/me/api-tokens/%d", readID), s.ownerToken, nil)
	s.Equal(http.StatusOK, code)
	code, _ = s.call("GET", note, readTok, nil)
	s.Equal(http.StatusUnauthorized, code)
	code, _ = s.call("GET", note, writeTok, nil)
	s.Equal(http.StatusOK, code)

	code, _ = s.call("DELETE", fmt.Sprintf("/me/api-tokens/%d", writeID), s.ownerToken, nil)
	s.Equal(http.StatusOK, code)
	code, _ = s.call("GET", note, writeTok, nil)
	s.Equal(http.StatusUnauthorized, code)
}
