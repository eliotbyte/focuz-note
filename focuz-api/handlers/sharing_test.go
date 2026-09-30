package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// eventually retries f for up to 3s (notifications are delivered off the request path).
func (s *E2ETestSuite) eventually(f func() bool, msg string) {
	for i := 0; i < 30; i++ {
		if f() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	s.Fail(msg)
}

func (s *E2ETestSuite) notificationsOf(token string) ([]map[string]any, int) {
	code, out := s.call("GET", "/notifications", token, nil)
	s.Require().Equal(http.StatusOK, code)
	d := out["data"].(map[string]any)
	var items []map[string]any
	for _, it := range d["items"].([]any) {
		items = append(items, it.(map[string]any))
	}
	return items, int(d["unread"].(float64))
}

func (s *E2ETestSuite) invite(token string, space int, identifier, role string) (int, map[string]any) {
	return s.call("POST", "/spaces/"+strconv.Itoa(space)+"/invitations", token, map[string]any{"identifier": identifier, "role": role})
}

func (s *E2ETestSuite) myInvitationID(token string, space int) int {
	code, out := s.call("GET", "/invitations", token, nil)
	s.Require().Equal(http.StatusOK, code)
	for _, it := range out["data"].([]any) {
		m := it.(map[string]any)
		if int(m["spaceId"].(float64)) == space {
			return int(m["id"].(float64))
		}
	}
	return 0
}

// join invites a new user with a role and accepts; returns their token.
func (s *E2ETestSuite) join(ownerTok string, space int, prefix, role string) string {
	tok, _ := s.newUser(prefix)
	code, _ := s.invite(ownerTok, space, s.usernameOf(tok), role)
	s.Require().Equal(http.StatusOK, code)
	id := s.myInvitationID(tok, space)
	s.Require().NotZero(id)
	code, _ = s.call("POST", "/invitations/"+strconv.Itoa(id)+"/accept", tok, nil)
	s.Require().Equal(http.StatusOK, code)
	return tok
}

func (s *E2ETestSuite) Test300_Sharing_InvitationsDoNotRevealAccounts() {
	ownerTok, _ := s.newUser("inviter")
	space := s.createSpace(ownerTok, "Team")
	bobTok, _ := s.newUser("bob")

	codeReal, real := s.invite(ownerTok, space, s.usernameOf(bobTok), "editor")
	codeGhost, ghost := s.invite(ownerTok, space, "nobody-"+uuid.NewString()[:8], "editor")
	s.Equal(http.StatusOK, codeReal)
	s.Equal(codeReal, codeGhost)
	rd, gd := real["data"].(map[string]any), ghost["data"].(map[string]any)
	s.Equal(rd["message"], gd["message"])
	keys := func(m map[string]any) []string {
		var k []string
		for key := range m {
			k = append(k, key)
		}
		return k
	}
	s.ElementsMatch(keys(rd), keys(gd))

	// Both show up the same way in the admin's pending list.
	code, out := s.call("GET", "/spaces/"+strconv.Itoa(space)+"/invitations", ownerTok, nil)
	s.Require().Equal(http.StatusOK, code)
	s.Len(out["data"].([]any), 2)
	b, _ := json.Marshal(out)
	s.NotContains(string(b), "invitee")

	// Only the invited person learns about it: a notification and an entry in /invitations.
	s.eventually(func() bool {
		items, unread := s.notificationsOf(bobTok)
		return unread == 1 && len(items) == 1 && items[0]["type"] == "space_invitation"
	}, "invitee should get a notification")
	items, _ := s.notificationsOf(bobTok)
	p := items[0]["payload"].(map[string]any)
	s.Equal("Team", p["spaceName"])
	s.Equal(s.usernameOf(ownerTok), p["inviterName"])
	s.Equal("pending", items[0]["invitationStatus"])

	// Inviting the same name again does not create a second invitation or notification.
	code, _ = s.invite(ownerTok, space, s.usernameOf(bobTok), "guest")
	s.Equal(http.StatusOK, code)
	time.Sleep(200 * time.Millisecond)
	_, unread := s.notificationsOf(bobTok)
	s.Equal(1, unread)

	// Accepting: membership with the latest role, the notification is resolved, the inviter is told.
	id := s.myInvitationID(bobTok, space)
	code, acc := s.call("POST", "/invitations/"+strconv.Itoa(id)+"/accept", bobTok, nil)
	s.Require().Equal(http.StatusOK, code)
	s.Equal("guest", acc["data"].(map[string]any)["role"])
	items, unread = s.notificationsOf(bobTok)
	s.Equal(0, unread)
	s.Equal("accepted", items[0]["invitationStatus"], "an answered invitation must not look pending")
	s.eventually(func() bool {
		items, _ := s.notificationsOf(ownerTok)
		return len(items) > 0 && items[0]["type"] == "invitation_accepted"
	}, "inviter should hear about the acceptance")
	code, _ = s.call("POST", "/invitations/"+strconv.Itoa(id)+"/accept", bobTok, nil)
	s.Equal(http.StatusNotFound, code)

	// Someone else's invitation can't be answered.
	malloryTok, _ := s.newUser("mallory")
	code, _ = s.call("POST", "/invitations/"+strconv.Itoa(id)+"/decline", malloryTok, nil)
	s.Equal(http.StatusNotFound, code)

	// A cancelled invitation shows as cancelled, not as waiting for an answer.
	code, _ = s.invite(ownerTok, space, s.usernameOf(malloryTok), "editor")
	s.Require().Equal(http.StatusOK, code)
	mid := s.myInvitationID(malloryTok, space)
	code, _ = s.call("DELETE", "/spaces/"+strconv.Itoa(space)+"/invitations/"+strconv.Itoa(mid), ownerTok, nil)
	s.Require().Equal(http.StatusOK, code)
	s.eventually(func() bool {
		items, _ := s.notificationsOf(malloryTok)
		return len(items) == 1 && items[0]["invitationStatus"] == "cancelled"
	}, "cancelled invitation should be reported as cancelled")

	code, _ = s.call("POST", "/notifications/read", ownerTok, map[string]any{"all": true})
	s.Equal(http.StatusOK, code)
	_, unread = s.notificationsOf(ownerTok)
	s.Equal(0, unread)
}

func (s *E2ETestSuite) Test301_Sharing_InvitationRateLimit() {
	ownerTok, _ := s.newUser("spammer")
	space := s.createSpace(ownerTok, "Spam")
	for i := 0; i < 20; i++ {
		code, _ := s.invite(ownerTok, space, "ghost"+strconv.Itoa(i)+uuid.NewString()[:6], "editor")
		s.Require().Equal(http.StatusOK, code)
	}
	code, _ := s.invite(ownerTok, space, "ghost-last", "editor")
	s.Equal(http.StatusTooManyRequests, code)
}

func (s *E2ETestSuite) Test302_Sharing_PersonalSpaceStaysPrivate() {
	tok, _ := s.newUser("solo")
	code, out := s.call("POST", "/spaces", tok, map[string]any{"name": "My Space", "personal": true})
	s.Require().Equal(http.StatusCreated, code)
	space := int(out["data"].(map[string]any)["id"].(float64))
	friendTok, _ := s.newUser("friend")

	code, _ = s.invite(tok, space, s.usernameOf(friendTok), "editor")
	s.Equal(http.StatusBadRequest, code)
	code, _ = s.call("POST", "/spaces/"+strconv.Itoa(space)+"/shares", tok, map[string]any{})
	s.Equal(http.StatusBadRequest, code)
	code, _ = s.call("PATCH", "/spaces/"+strconv.Itoa(space)+"/delete", tok, nil)
	s.Equal(http.StatusBadRequest, code)

	// Single notes from it can still be published.
	_, d := s.pushAs(tok, map[string]any{"notes": []any{noteChange(nil, space, "public recipe")}})
	note := int(d["versions"].([]any)[0].(map[string]any)["id"].(float64))
	code, _ = s.call("POST", "/spaces/"+strconv.Itoa(space)+"/shares", tok, map[string]any{"noteId": note})
	s.Equal(http.StatusOK, code)

	// Only one personal space per person.
	code, out = s.call("POST", "/spaces", tok, map[string]any{"name": "Another", "personal": true})
	s.Require().Equal(http.StatusCreated, code)
	other := int(out["data"].(map[string]any)["id"].(float64))
	code, _ = s.invite(tok, other, s.usernameOf(friendTok), "editor")
	s.Equal(http.StatusOK, code)
}

func (s *E2ETestSuite) Test303_Sharing_RolesManageMembers() {
	ownerTok, _ := s.newUser("boss")
	space := s.createSpace(ownerTok, "Org")
	sp := strconv.Itoa(space)
	adminTok := s.join(ownerTok, space, "adm", "admin")
	admin2Tok := s.join(ownerTok, space, "adm2", "admin")
	editorTok := s.join(adminTok, space, "ed", "editor")
	guestTok := s.join(adminTok, space, "gu", "guest")
	userID := func(tok string) string {
		_, out := s.call("GET", "/me", tok, nil)
		return strconv.Itoa(int(out["data"].(map[string]any)["id"].(float64)))
	}

	// Admins invite editors and guests but can't make admins; only the owner can.
	outsiderTok, _ := s.newUser("out")
	code, _ := s.invite(adminTok, space, s.usernameOf(outsiderTok), "admin")
	s.Equal(http.StatusForbidden, code)
	code, _ = s.invite(editorTok, space, s.usernameOf(outsiderTok), "guest")
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("PATCH", "/spaces/"+sp+"/members/"+userID(editorTok), adminTok, map[string]any{"role": "guest"})
	s.Equal(http.StatusOK, code)
	code, _ = s.call("PATCH", "/spaces/"+sp+"/members/"+userID(editorTok), adminTok, map[string]any{"role": "admin"})
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("PATCH", "/spaces/"+sp+"/members/"+userID(admin2Tok), adminTok, map[string]any{"role": "editor"})
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("PATCH", "/spaces/"+sp+"/members/"+userID(ownerTok), adminTok, map[string]any{"role": "editor"})
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("PATCH", "/spaces/"+sp+"/members/"+userID(editorTok), ownerTok, map[string]any{"role": "admin"})
	s.Equal(http.StatusOK, code)
	s.eventually(func() bool {
		items, _ := s.notificationsOf(editorTok)
		return len(items) > 0 && items[0]["type"] == "role_changed"
	}, "member should hear about the new role")

	// Admins remove guests, not other admins; guests leave on their own.
	code, _ = s.call("DELETE", "/spaces/"+sp+"/members/"+userID(admin2Tok), adminTok, nil)
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("DELETE", "/spaces/"+sp+"/members/"+userID(guestTok), guestTok, nil)
	s.Equal(http.StatusOK, code)
	code, _ = s.call("GET", "/spaces/"+sp+"/members", guestTok, nil)
	s.Equal(http.StatusNotFound, code)
	code, _ = s.call("DELETE", "/spaces/"+sp+"/members/"+userID(ownerTok), ownerTok, nil)
	s.Equal(http.StatusBadRequest, code)

	// Removing someone tells them; deleting the space is the owner's call.
	code, _ = s.call("DELETE", "/spaces/"+sp+"/members/"+userID(admin2Tok), ownerTok, nil)
	s.Equal(http.StatusOK, code)
	s.eventually(func() bool {
		items, _ := s.notificationsOf(admin2Tok)
		return len(items) > 0 && items[0]["type"] == "removed_from_space"
	}, "removed member should be told")
	code, _ = s.call("PATCH", "/spaces/"+sp+"/delete", adminTok, nil)
	s.Equal(http.StatusForbidden, code)

	// Everyone in the space sees the member list (usernames and roles, never e-mails) in the pull.
	code, out := s.call("GET", "/sync?since=1970-01-01T00:00:00Z", editorTok, nil)
	s.Require().Equal(http.StatusOK, code)
	d := out["data"].(map[string]any)
	var role string
	for _, m := range d["memberships"].([]any) {
		mm := m.(map[string]any)
		if int(mm["space_id"].(float64)) == space {
			role = mm["role"].(string)
			s.Equal(3.0, mm["member_count"])
		}
	}
	s.Equal("admin", role)
	b, _ := json.Marshal(d["members"])
	s.Contains(string(b), s.usernameOf(ownerTok))
	s.NotContains(string(b), "email")
}

func (s *E2ETestSuite) Test304_Sharing_FoldersArePersonal() {
	ownerTok, _ := s.newUser("fold")
	space := s.createSpace(ownerTok, "Folders")
	friendTok := s.join(ownerTok, space, "friendf", "editor")
	now := time.Now().UTC().Format(time.RFC3339)
	_, d := s.pushAs(ownerTok, map[string]any{"filters": []any{map[string]any{"clientId": uuid.NewString(), "space_id": space, "name": "Mine only", "params": map[string]any{}, "created_at": now, "modified_at": now}}})
	s.Empty(rejectedReasons(d))
	filterID := int(d["versions"].([]any)[0].(map[string]any)["id"].(float64))

	code, out := s.call("GET", "/sync?since=1970-01-01T00:00:00Z", friendTok, nil)
	s.Require().Equal(http.StatusOK, code)
	b, _ := json.Marshal(out["data"].(map[string]any)["filters"])
	s.NotContains(string(b), "Mine only")
	_, d = s.pushAs(friendTok, map[string]any{"filters": []any{map[string]any{"id": filterID, "space_id": space, "name": "taken", "params": map[string]any{}, "created_at": now, "modified_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}}})
	s.Equal([]string{"forbidden"}, rejectedReasons(d))
}

func (s *E2ETestSuite) Test305_Sharing_PublicLinks() {
	ownerTok, _ := s.newUser("pub")
	space := s.createSpace(ownerTok, "Garden")
	sp := strconv.Itoa(space)
	editorTok := s.join(ownerTok, space, "pubed", "editor")
	guestTok := s.join(ownerTok, space, "pubgu", "guest")

	push := func(tok string, parent *int, text string) int {
		n := noteChange(nil, space, text)
		if parent != nil {
			n["parent_id"] = *parent
		}
		_, d := s.pushAs(tok, map[string]any{"notes": []any{n}})
		s.Require().Empty(rejectedReasons(d))
		return int(d["versions"].([]any)[0].(map[string]any)["id"].(float64))
	}
	root := push(ownerTok, nil, "Tomatoes: how I grow them")
	reply := push(editorTok, &root, "Water in the morning")
	nested := push(ownerTok, &reply, "And mulch")
	secret := push(ownerTok, nil, "Private diary")

	// Editors publish only their own notes, guests nothing.
	code, _ := s.call("POST", "/spaces/"+sp+"/shares", editorTok, map[string]any{"noteId": root})
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/shares", guestTok, map[string]any{"noteId": root})
	s.Equal(http.StatusForbidden, code)
	code, _ = s.call("POST", "/spaces/"+sp+"/shares", editorTok, map[string]any{})
	s.Equal(http.StatusForbidden, code)

	code, out := s.call("POST", "/spaces/"+sp+"/shares", ownerTok, map[string]any{"noteId": root, "includeReplies": true})
	s.Require().Equal(http.StatusOK, code)
	token := out["data"].(map[string]any)["token"].(string)
	s.GreaterOrEqual(len(token), 32)

	publicIDs := func() (int, []int) {
		code, out := s.call("GET", "/public/"+token, "", nil)
		if code != http.StatusOK {
			return code, nil
		}
		var ids []int
		for _, n := range out["data"].(map[string]any)["notes"].([]any) {
			ids = append(ids, int(n.(map[string]any)["id"].(float64)))
		}
		b, _ := json.Marshal(out)
		s.NotContains(string(b), "Private diary")
		s.NotContains(string(b), "email")
		return code, ids
	}
	code, ids := publicIDs()
	s.Equal(http.StatusOK, code)
	s.ElementsMatch([]int{root, reply, nested}, ids)

	// Replies can be made private while the note stays public.
	code, _ = s.call("PATCH", "/shares/"+token, ownerTok, map[string]any{"includeReplies": false})
	s.Equal(http.StatusOK, code)
	_, ids = publicIDs()
	s.Equal([]int{root}, ids)

	// Members see the link in the pull; guests can't change it.
	code, pull := s.call("GET", "/sync?since=1970-01-01T00:00:00Z", guestTok, nil)
	s.Require().Equal(http.StatusOK, code)
	b, _ := json.Marshal(pull["data"].(map[string]any)["shares"])
	s.Contains(string(b), token)
	code, _ = s.call("DELETE", "/shares/"+token, guestTok, nil)
	s.Equal(http.StatusForbidden, code)

	// Files outside the link are never served.
	code, _ = s.call("GET", "/public/"+token+"/files/"+uuid.NewString(), "", nil)
	s.Equal(http.StatusNotFound, code)

	// Private again: the link stops working for good.
	code, _ = s.call("DELETE", "/shares/"+token, ownerTok, nil)
	s.Equal(http.StatusOK, code)
	code, _ = publicIDs()
	s.Equal(http.StatusNotFound, code)
	code, _ = s.call("GET", "/public/not-a-real-token", "", nil)
	s.Equal(http.StatusNotFound, code)

	// The whole space (admins): every note, still no e-mails.
	code, out = s.call("POST", "/spaces/"+sp+"/shares", ownerTok, map[string]any{})
	s.Require().Equal(http.StatusOK, code)
	spaceToken := out["data"].(map[string]any)["token"].(string)
	code, out = s.call("GET", "/public/"+spaceToken, "", nil)
	s.Require().Equal(http.StatusOK, code)
	data := out["data"].(map[string]any)
	s.Equal("space", data["kind"])
	s.Equal("Garden", data["spaceName"])
	s.Len(data["notes"].([]any), 4)
	_ = secret
}

func (s *E2ETestSuite) Test306_Sharing_AccountSettings() {
	tok, _ := s.newUser("settings")
	code, out := s.call("GET", "/me", tok, nil)
	s.Require().Equal(http.StatusOK, code)
	me := out["data"].(map[string]any)
	s.Equal(true, me["notifyEmail"])
	s.Equal(false, me["emailNotificationsAvailable"]) // username server: no e-mail
	code, out = s.call("PATCH", "/me", tok, map[string]any{"notifyEmail": false})
	s.Require().Equal(http.StatusOK, code)
	s.Equal(false, out["data"].(map[string]any)["notifyEmail"])

	code, _ = s.call("POST", "/me/password", tok, map[string]any{"currentPassword": "wrong", "newPassword": "NewPassword1"})
	s.Equal(http.StatusBadRequest, code)
	code, _ = s.call("POST", "/me/password", tok, map[string]any{"currentPassword": "Password123", "newPassword": "short"})
	s.Equal(http.StatusBadRequest, code)
	username := s.usernameOf(tok)
	code, out = s.call("POST", "/me/password", tok, map[string]any{"currentPassword": "Password123", "newPassword": "NewPassword1"})
	s.Require().Equal(http.StatusOK, code)
	// Tokens issued before the change (a stolen one included) stop working; this session goes on
	// with the fresh token from the response.
	code, _ = s.call("GET", "/me", tok, nil)
	s.Equal(http.StatusUnauthorized, code, "old token still works after a password change")
	fresh, _ := out["data"].(map[string]any)["token"].(string)
	s.Require().NotEmpty(fresh)
	code, _ = s.call("GET", "/me", fresh, nil)
	s.Equal(http.StatusOK, code)
	code, _ = s.call("POST", "/login", "", map[string]any{"username": username, "password": "NewPassword1"})
	s.Equal(http.StatusOK, code)
}

// Guests are read-only on the REST endpoints too, not only in /sync.
func (s *E2ETestSuite) Test307_Sharing_GuestCannotWriteViaREST() {
	ownerTok, _ := s.newUser("rog")
	space := s.createSpace(ownerTok, "Read only")
	guestTok := s.join(ownerTok, space, "guestr", "guest")

	code, out := s.call("POST", "/notes", ownerTok, map[string]any{"text": "owner note", "date": time.Now().UTC().Format(time.RFC3339), "spaceId": space})
	s.Require().Equal(http.StatusCreated, code, out)
	noteID := int(out["data"].(map[string]any)["id"].(float64))

	code, out = s.call("GET", "/spaces/"+strconv.Itoa(space)+"/activity-types", ownerTok, nil)
	s.Require().Equal(http.StatusOK, code)
	var typeID int
	for _, it := range out["data"].(map[string]any)["data"].([]any) {
		if m := it.(map[string]any); m["valueType"] == "integer" || m["value_type"] == "integer" {
			typeID = int(m["id"].(float64))
			break
		}
	}
	s.Require().NotZero(typeID)

	code, _ = s.call("POST", "/activities", guestTok, map[string]any{"typeId": typeID, "value": "5", "note_id": noteID})
	s.Equal(http.StatusForbidden, code, "guest created an activity")
	code, _ = s.call("POST", "/charts", guestTok, map[string]any{"spaceId": space, "kindId": 1, "activityTypeId": typeID, "periodId": 1, "name": "x"})
	s.Equal(http.StatusForbidden, code, "guest created a chart")

	code, _ = s.call("POST", "/activities", ownerTok, map[string]any{"typeId": typeID, "value": "5", "note_id": noteID})
	s.Require().Equal(http.StatusCreated, code)
	code, out = s.call("GET", "/sync?since=1970-01-01T00:00:00Z", ownerTok, nil)
	s.Require().Equal(http.StatusOK, code)
	var activityID int
	for _, n := range out["data"].(map[string]any)["notes"].([]any) {
		if nm := n.(map[string]any); int(nm["id"].(float64)) == noteID {
			for _, a := range nm["activities"].([]any) {
				activityID = int(a.(map[string]any)["id"].(float64))
			}
		}
	}
	s.Require().NotZero(activityID)
	code, _ = s.call("PATCH", "/activities/"+strconv.Itoa(activityID)+"/delete", guestTok, nil)
	s.Equal(http.StatusForbidden, code, "guest deleted an activity")

	req, _ := http.NewRequest("POST", s.baseURL+"/upload", strings.NewReader("note_id="+strconv.Itoa(noteID)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "Bearer "+guestTok)
	resp, err := http.DefaultClient.Do(req)
	s.Require().NoError(err)
	resp.Body.Close()
	s.Equal(http.StatusForbidden, resp.StatusCode, "guest uploaded a file")
}
