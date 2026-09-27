package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"focuz-api/pkg/access"
	"focuz-api/pkg/authcfg"
	"focuz-api/pkg/mailer"
	"focuz-api/pkg/notify"
	"focuz-api/repository"
	"focuz-api/types"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// SharingHandler: members, invitations, notifications, account settings, note history and
// public links.
type SharingHandler struct {
	repo     *repository.SharingRepository
	users    *repository.UsersRepository
	notes    *repository.NotificationsRepository
	notifier notify.Notifier
	mail     mailer.Mailer
	cfg      authcfg.Config
	webURL   string
	// InviteLimit is how many invitations one person may send per hour.
	InviteLimit int
	// async runs side effects (notifications, e-mail) off the request path so a response takes
	// the same time whether or not the invited account exists. Tests replace it.
	async func(func())
}

func NewSharingHandler(repo *repository.SharingRepository, users *repository.UsersRepository, notes *repository.NotificationsRepository, n notify.Notifier, m mailer.Mailer, cfg authcfg.Config) *SharingHandler {
	return &SharingHandler{
		repo: repo, users: users, notes: notes, notifier: n, mail: m, cfg: cfg,
		webURL:      strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_WEB_URL")), "/"),
		InviteLimit: 20,
		async:       func(f func()) { go f() },
	}
}

// WithSyncRunner makes side effects synchronous (for tests).
func (h *SharingHandler) WithSyncRunner() *SharingHandler {
	h.async = func(f func()) { f() }
	return h
}

func (h *SharingHandler) fail(c *gin.Context, what string, err error) {
	slog.Error("sharing: "+what, "err", err)
	c.JSON(http.StatusInternalServerError, types.NewErrorResponse(types.ErrorCodeInternal, "Something went wrong, try again"))
}

func badRequest(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeInvalidRequest, msg))
}

func forbidden(c *gin.Context, msg string) {
	c.JSON(http.StatusForbidden, types.NewErrorResponse(types.ErrorCodeForbidden, msg))
}

func notFound(c *gin.Context, msg string) {
	c.JSON(http.StatusNotFound, types.NewErrorResponse(types.ErrorCodeNotFound, msg))
}

// member loads the space and the caller's role; it answers 404/403 itself and returns ok=false.
func (h *SharingHandler) member(c *gin.Context) (space *repository.SpaceInfo, role int, ok bool) {
	spaceID, err := strconv.Atoi(c.Param("spaceId"))
	if err != nil {
		badRequest(c, "Invalid space id")
		return nil, 0, false
	}
	role, err = h.repo.RoleOf(c.GetInt("userId"), spaceID)
	if err != nil {
		h.fail(c, "role", err)
		return nil, 0, false
	}
	if role == 0 {
		// Same answer for "no such space" and "not yours".
		notFound(c, "Space not found")
		return nil, 0, false
	}
	space, err = h.repo.Space(spaceID)
	if err != nil || space.IsDeleted {
		notFound(c, "Space not found")
		return nil, 0, false
	}
	return space, role, true
}

// ---- notifications ----

type notification struct {
	userID  int
	kind    string
	payload map[string]any
	subject string
	text    string
}

// deliver stores a notification, pings the user's open apps and, if they opted in, sends an e-mail.
func (h *SharingHandler) deliver(n notification) {
	body, _ := json.Marshal(n.payload)
	if err := h.notes.Create(n.userID, n.kind, body, n.kind == "space_invitation"); err != nil {
		slog.Error("sharing: store notification", "err", err)
		return
	}
	if h.notifier != nil {
		h.notifier.NotifyUser(n.userID, map[string]any{"type": "Notification", "kind": n.kind})
	}
	if h.mail == nil || n.subject == "" || h.cfg.Mode != authcfg.ModeEmail {
		return
	}
	u, err := h.repo.User(n.userID)
	if err != nil || u.Email == nil || !u.EmailVerified || !u.NotifyEmail {
		return
	}
	text := n.text
	if h.webURL != "" {
		text += "\n\nOpen focuz: " + h.webURL + "\n"
	}
	text += "\nYou get these e-mails because they are turned on in focuz Settings → Notifications.\n"
	if err := h.mail.Send(mailer.Message{To: *u.Email, Subject: n.subject, Text: text}); err != nil {
		slog.Error("sharing: send notification e-mail", "err", err)
	}
}

func (h *SharingHandler) username(userID int) string {
	if u, err := h.repo.User(userID); err == nil {
		return u.Username
	}
	return "Someone"
}

// GET /notifications?limit=50
func (h *SharingHandler) ListNotifications(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	items, unread, err := h.notes.List(c.GetInt("userId"), limit)
	if err != nil {
		h.fail(c, "list notifications", err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"items": items, "unread": unread}))
}

// POST /notifications/read  {ids:[...]} or {all:true}
func (h *SharingHandler) ReadNotifications(c *gin.Context) {
	var req struct {
		IDs []int `json:"ids"`
		All bool  `json:"all"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || (!req.All && len(req.IDs) == 0) {
		badRequest(c, "ids or all is required")
		return
	}
	userID := c.GetInt("userId")
	var err error
	if req.All {
		err = h.notes.MarkAllRead(userID)
	} else {
		err = h.notes.MarkRead(userID, req.IDs)
	}
	if err != nil {
		h.fail(c, "read notifications", err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"ok": true}))
}

// ---- account ----

func (h *SharingHandler) meJSON(u *repository.UserInfo) gin.H {
	return gin.H{
		"id": u.ID, "username": u.Username, "email": u.Email,
		"notifyEmail": u.NotifyEmail,
		// E-mail notifications need an e-mail server mode and a confirmed address.
		"emailNotificationsAvailable": h.cfg.Mode == authcfg.ModeEmail && u.Email != nil && u.EmailVerified,
		"authMode":                    h.cfg.Mode,
	}
}

// GET /me
func (h *SharingHandler) GetMe(c *gin.Context) {
	u, err := h.repo.User(c.GetInt("userId"))
	if err != nil {
		h.fail(c, "me", err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(h.meJSON(u)))
}

// PATCH /me  {notifyEmail}
func (h *SharingHandler) UpdateMe(c *gin.Context) {
	var req struct {
		NotifyEmail *bool `json:"notifyEmail"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "Invalid settings")
		return
	}
	userID := c.GetInt("userId")
	if req.NotifyEmail != nil {
		if err := h.repo.SetNotifyEmail(userID, *req.NotifyEmail); err != nil {
			h.fail(c, "update me", err)
			return
		}
	}
	h.GetMe(c)
}

// POST /me/password  {currentPassword, newPassword}
func (h *SharingHandler) ChangePassword(c *gin.Context) {
	var req struct {
		Current string `json:"currentPassword"`
		New     string `json:"newPassword"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "Current and new password are required")
		return
	}
	if len(req.New) < 8 || len(req.New) > 128 {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "New password must be 8 to 128 characters"))
		return
	}
	u, err := h.repo.User(c.GetInt("userId"))
	if err != nil {
		h.fail(c, "password user", err)
		return
	}
	full, err := h.users.FindByLogin(u.Username)
	if err != nil || full == nil || full.ID != u.ID {
		h.fail(c, "password lookup", fmt.Errorf("user %d not found by username", u.ID))
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(full.PasswordHash), []byte(req.Current)) != nil {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Current password is wrong"))
		return
	}
	if err := h.users.SetPassword(u.ID, req.New); err != nil {
		h.fail(c, "set password", err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"ok": true}))
}

// ---- spaces ----

// PATCH /spaces/:spaceId  {name}
func (h *SharingHandler) RenameSpace(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	if !access.CanManage(role) {
		forbidden(c, "Only admins can rename the space")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	_ = c.ShouldBindJSON(&req)
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Name must be 1 to 100 characters"))
		return
	}
	if err := h.repo.RenameSpace(space.ID, name); err != nil {
		h.fail(c, "rename space", err)
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"id": space.ID, "name": name}))
}

// PATCH /spaces/:spaceId/delete — owner only; the personal space can't be deleted.
func (h *SharingHandler) DeleteSpace(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	if access.Name(role) != access.Owner {
		forbidden(c, "Only the owner can delete the space")
		return
	}
	if space.IsPersonal {
		badRequest(c, "Your personal space can't be deleted")
		return
	}
	members, err := h.repo.Members([]int{space.ID})
	if err != nil {
		h.fail(c, "delete space members", err)
		return
	}
	if err := h.repo.DeleteSpace(space.ID); err != nil {
		h.fail(c, "delete space", err)
		return
	}
	actor := c.GetInt("userId")
	actorName := h.username(actor)
	h.async(func() {
		for _, m := range members {
			if m.UserID == actor {
				continue
			}
			h.deliver(notification{userID: m.UserID, kind: "space_deleted", payload: map[string]any{"spaceId": space.ID, "spaceName": space.Name, "actorName": actorName}})
		}
	})
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"ok": true}))
}

// GET /spaces/:spaceId/members
func (h *SharingHandler) ListMembers(c *gin.Context) {
	space, _, ok := h.member(c)
	if !ok {
		return
	}
	members, err := h.repo.Members([]int{space.ID})
	if err != nil {
		h.fail(c, "members", err)
		return
	}
	for i := range members {
		members[i].Role = access.Name(members[i].RoleID)
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(members))
}

func targetUser(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		badRequest(c, "Invalid user id")
		return 0, false
	}
	return id, true
}

// PATCH /spaces/:spaceId/members/:userId  {role}
func (h *SharingHandler) SetMemberRole(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	target, ok := targetUser(c)
	if !ok {
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	_ = c.ShouldBindJSON(&req)
	newRole := access.ID(req.Role)
	targetRole, err := h.repo.RoleOf(target, space.ID)
	if err != nil {
		h.fail(c, "target role", err)
		return
	}
	if targetRole == 0 {
		notFound(c, "Not a member of this space")
		return
	}
	if !access.CanAssign(role, targetRole, newRole) {
		forbidden(c, "You can't give this role")
		return
	}
	if err := h.repo.SetRole(space.ID, target, newRole); err != nil {
		h.fail(c, "set role", err)
		return
	}
	actorName := h.username(c.GetInt("userId"))
	if target != c.GetInt("userId") {
		h.async(func() {
			h.deliver(notification{userID: target, kind: "role_changed", payload: map[string]any{"spaceId": space.ID, "spaceName": space.Name, "role": req.Role, "actorName": actorName}})
		})
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"userId": target, "role": req.Role}))
}

// DELETE /spaces/:spaceId/members/:userId — remove someone, or leave when it is yourself.
func (h *SharingHandler) RemoveMember(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	target, ok := targetUser(c)
	if !ok {
		return
	}
	actor := c.GetInt("userId")
	if target == actor {
		if access.Name(role) == access.Owner {
			badRequest(c, "The owner can't leave. Delete the space instead")
			return
		}
		if err := h.repo.RemoveMember(space.ID, actor); err != nil {
			h.fail(c, "leave", err)
			return
		}
		c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"left": true}))
		return
	}
	targetRole, err := h.repo.RoleOf(target, space.ID)
	if err != nil {
		h.fail(c, "target role", err)
		return
	}
	if targetRole == 0 {
		notFound(c, "Not a member of this space")
		return
	}
	if !access.CanRemove(role, targetRole) {
		forbidden(c, "You can't remove this member")
		return
	}
	if err := h.repo.RemoveMember(space.ID, target); err != nil {
		h.fail(c, "remove member", err)
		return
	}
	actorName := h.username(actor)
	h.async(func() {
		h.deliver(notification{userID: target, kind: "removed_from_space", payload: map[string]any{"spaceId": space.ID, "spaceName": space.Name, "actorName": actorName}})
	})
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"removed": target}))
}

// ---- invitations ----

func (h *SharingHandler) byEmail() bool { return h.cfg.Mode == authcfg.ModeEmail }

// POST /spaces/:spaceId/invitations  {identifier, role}
//
// The answer is the same whether or not an account with that name exists, so invitations can't
// be used to find out who has an account. Only the person invited learns about it.
func (h *SharingHandler) Invite(c *gin.Context) {
	var req struct {
		Identifier string `json:"identifier"`
		Username   string `json:"username"` // older clients
		Role       string `json:"role"`
	}
	_ = c.ShouldBindJSON(&req)
	if req.Identifier == "" {
		req.Identifier = req.Username
	}
	if req.Role == "" {
		req.Role = access.Editor
	}
	h.invite(c, req.Identifier, req.Role)
}

func (h *SharingHandler) invite(c *gin.Context, rawIdentifier, roleName string) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	if !access.CanManage(role) {
		forbidden(c, "Only admins can invite people")
		return
	}
	if space.IsPersonal {
		badRequest(c, "Your personal space can't be shared. Create a shared space and invite people there")
		return
	}
	newRole := access.ID(roleName)
	if !access.CanAssign(role, 0, newRole) {
		forbidden(c, "You can't give this role")
		return
	}
	identifier := strings.ToLower(strings.TrimSpace(rawIdentifier))
	if h.byEmail() {
		if a, err := mail.ParseAddress(identifier); err != nil || a.Address != identifier || len(identifier) > 254 {
			c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Enter an e-mail address"))
			return
		}
	} else if n := utf8.RuneCountInString(identifier); n < 3 || n > 50 {
		c.JSON(http.StatusBadRequest, types.NewErrorResponse(types.ErrorCodeValidation, "Enter a username (3 to 50 characters)"))
		return
	}
	actor := c.GetInt("userId")
	if n, err := h.repo.CountRecentInvitations(actor, time.Now().Add(-time.Hour)); err != nil {
		h.fail(c, "count invitations", err)
		return
	} else if n >= h.InviteLimit {
		c.JSON(http.StatusTooManyRequests, types.NewErrorResponse("RATE_LIMIT_EXCEEDED", "Too many invitations in the last hour, try again later"))
		return
	}
	inviteeID, err := h.repo.FindUserID(identifier, h.byEmail())
	if err != nil {
		h.fail(c, "find invitee", err)
		return
	}
	if inviteeID == actor {
		badRequest(c, "You are already in this space")
		return
	}
	if inviteeID != 0 {
		// Members are listed in the space anyway, so saying so reveals nothing new.
		if r, err := h.repo.RoleOf(inviteeID, space.ID); err != nil {
			h.fail(c, "invitee role", err)
			return
		} else if r != 0 {
			c.JSON(http.StatusConflict, types.NewErrorResponse(types.ErrorCodeConflict, "Already a member of this space"))
			return
		}
	}
	var invitee *int
	if inviteeID != 0 {
		invitee = &inviteeID
	}
	inv, created, err := h.repo.CreateInvitation(space.ID, actor, invitee, identifier, newRole)
	if err != nil {
		h.fail(c, "create invitation", err)
		return
	}
	if inviteeID != 0 && created {
		inviterName := h.username(actor)
		h.async(func() {
			h.deliver(notification{
				userID: inviteeID, kind: "space_invitation",
				payload: map[string]any{"invitationId": inv.ID, "spaceId": space.ID, "spaceName": space.Name, "inviterName": inviterName, "role": roleName},
				subject: fmt.Sprintf("%s invited you to “%s” on focuz", inviterName, space.Name),
				text:    fmt.Sprintf("%s invited you to the space “%s” as %s.\nOpen focuz to accept or decline the invitation.", inviterName, space.Name, roleName),
			})
		})
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{
		"id": inv.ID, "identifier": identifier, "role": roleName, "createdAt": inv.CreatedAt, "expiresAt": inv.ExpiresAt,
		"message": "Invitation sent. If there is an account with this name, they will see it in focuz.",
	}))
}

// GET /spaces/:spaceId/invitations — pending invitations (admins).
func (h *SharingHandler) SpaceInvitations(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	if !access.CanManage(role) {
		forbidden(c, "Only admins can see invitations")
		return
	}
	list, err := h.repo.PendingForSpace(space.ID)
	if err != nil {
		h.fail(c, "space invitations", err)
		return
	}
	for i := range list {
		list[i].Role = access.Name(list[i].RoleID)
		list[i].SpaceName = ""
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(list))
}

// DELETE /spaces/:spaceId/invitations/:invitationId
func (h *SharingHandler) CancelInvitation(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	if !access.CanManage(role) {
		forbidden(c, "Only admins can cancel invitations")
		return
	}
	id, _ := strconv.Atoi(c.Param("invitationId"))
	inv, err := h.repo.Invitation(id)
	if err != nil || inv.SpaceID != space.ID || inv.Status != "pending" {
		notFound(c, "Invitation not found")
		return
	}
	if err := h.repo.SetInvitationStatus(inv.ID, "cancelled"); err != nil {
		h.fail(c, "cancel invitation", err)
		return
	}
	if inv.InviteeID != nil {
		_ = h.notes.ResolveInvitation(*inv.InviteeID, inv.ID)
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"cancelled": inv.ID}))
}

// GET /invitations — invitations addressed to me.
func (h *SharingHandler) MyInvitations(c *gin.Context) {
	list, err := h.repo.PendingForUser(c.GetInt("userId"))
	if err != nil {
		h.fail(c, "my invitations", err)
		return
	}
	for i := range list {
		list[i].Role = access.Name(list[i].RoleID)
		list[i].Identifier = ""
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(list))
}

func (h *SharingHandler) myInvitation(c *gin.Context) *repository.Invitation {
	id, _ := strconv.Atoi(c.Param("invitationId"))
	inv, err := h.repo.Invitation(id)
	userID := c.GetInt("userId")
	if err != nil || inv.InviteeID == nil || *inv.InviteeID != userID || inv.Status != "pending" || time.Now().After(inv.ExpiresAt) {
		notFound(c, "Invitation not found or no longer valid")
		return nil
	}
	return inv
}

// POST /invitations/:invitationId/accept
func (h *SharingHandler) AcceptInvitation(c *gin.Context) {
	inv := h.myInvitation(c)
	if inv == nil {
		return
	}
	h.accept(c, inv)
}

func (h *SharingHandler) accept(c *gin.Context, inv *repository.Invitation) {
	userID := c.GetInt("userId")
	if s, err := h.repo.Space(inv.SpaceID); err != nil || s.IsDeleted {
		notFound(c, "This space no longer exists")
		return
	}
	if err := h.repo.AcceptInvitation(inv, userID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "Invitation not found or no longer valid")
			return
		}
		h.fail(c, "accept invitation", err)
		return
	}
	_ = h.notes.ResolveInvitation(userID, inv.ID)
	name := h.username(userID)
	h.async(func() {
		h.deliver(notification{userID: inv.InviterID, kind: "invitation_accepted", payload: map[string]any{"spaceId": inv.SpaceID, "spaceName": inv.SpaceName, "userName": name}})
	})
	if h.notifier != nil {
		h.notifier.NotifyUser(userID, map[string]any{"type": "SpacesChanged"})
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"spaceId": inv.SpaceID, "spaceName": inv.SpaceName, "role": access.Name(inv.RoleID)}))
}

// POST /invitations/:invitationId/decline
func (h *SharingHandler) DeclineInvitation(c *gin.Context) {
	inv := h.myInvitation(c)
	if inv == nil {
		return
	}
	h.decline(c, inv)
}

func (h *SharingHandler) decline(c *gin.Context, inv *repository.Invitation) {
	if err := h.repo.SetInvitationStatus(inv.ID, "declined"); err != nil {
		h.fail(c, "decline invitation", err)
		return
	}
	_ = h.notes.ResolveInvitation(c.GetInt("userId"), inv.ID)
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"declined": inv.ID}))
}

// Older clients answer invitations by space id.
func (h *SharingHandler) invitationForSpace(c *gin.Context) *repository.Invitation {
	spaceID, _ := strconv.Atoi(c.Param("spaceId"))
	list, err := h.repo.PendingForUser(c.GetInt("userId"))
	if err == nil {
		for i := range list {
			if list[i].SpaceID == spaceID {
				return &list[i]
			}
		}
	}
	notFound(c, "Invitation not found or no longer valid")
	return nil
}

func (h *SharingHandler) AcceptInvitationBySpace(c *gin.Context) {
	if inv := h.invitationForSpace(c); inv != nil {
		h.accept(c, inv)
	}
}

func (h *SharingHandler) DeclineInvitationBySpace(c *gin.Context) {
	if inv := h.invitationForSpace(c); inv != nil {
		h.decline(c, inv)
	}
}

// OnEmailVerified hands invitations sent to an address to the account that just confirmed it.
func (h *SharingHandler) OnEmailVerified(userID int) {
	u, err := h.repo.User(userID)
	if err != nil || u.Email == nil {
		return
	}
	list, err := h.repo.AttachInvitationsByEmail(userID, *u.Email)
	if err != nil {
		slog.Error("sharing: attach invitations", "err", err)
		return
	}
	for _, inv := range list {
		h.deliver(notification{userID: userID, kind: "space_invitation", payload: map[string]any{
			"invitationId": inv.ID, "spaceId": inv.SpaceID, "spaceName": inv.SpaceName, "inviterName": inv.InviterName, "role": access.Name(inv.RoleID),
		}})
	}
}

// ---- note history ----

// GET /notes/:id/history
func (h *SharingHandler) NoteHistory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		badRequest(c, "Invalid note id")
		return
	}
	hist, err := h.repo.NoteHistory(id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			notFound(c, "Note not found")
			return
		}
		h.fail(c, "history", err)
		return
	}
	if role, err := h.repo.RoleOf(c.GetInt("userId"), hist.SpaceID); err != nil || role == 0 {
		notFound(c, "Note not found")
		return
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(hist))
}

// ---- public links ----

// POST /spaces/:spaceId/shares  {noteId?, includeReplies}
func (h *SharingHandler) CreateShare(c *gin.Context) {
	space, role, ok := h.member(c)
	if !ok {
		return
	}
	var req struct {
		NoteID         *int  `json:"noteId"`
		IncludeReplies *bool `json:"includeReplies"`
	}
	_ = c.ShouldBindJSON(&req)
	include := req.IncludeReplies == nil || *req.IncludeReplies
	userID := c.GetInt("userId")
	if req.NoteID == nil {
		if !access.CanManage(role) {
			forbidden(c, "Only admins can make the whole space public")
			return
		}
		if space.IsPersonal {
			badRequest(c, "Your personal space can't be public as a whole. Share single notes, or use a shared space")
			return
		}
	} else {
		author, noteSpace, deleted, err := h.repo.NoteAuthorAndSpace(*req.NoteID)
		if err != nil || noteSpace != space.ID || deleted {
			notFound(c, "Note not found")
			return
		}
		if !access.CanPublishNote(role, author, userID) {
			forbidden(c, "You can publish only your own notes here")
			return
		}
	}
	share, err := h.repo.Share(space.ID, req.NoteID, include, userID)
	if err != nil {
		h.fail(c, "share", err)
		return
	}
	h.pingSpace(space.ID)
	c.JSON(http.StatusOK, types.NewSuccessResponse(share))
}

// shareForManage loads a link by token and checks the caller may change it.
func (h *SharingHandler) shareForManage(c *gin.Context) *repository.Share {
	share, err := h.repo.ShareByToken(c.Param("token"))
	if err != nil {
		notFound(c, "Link not found")
		return nil
	}
	userID := c.GetInt("userId")
	role, err := h.repo.RoleOf(userID, share.SpaceID)
	if err != nil || role == 0 {
		notFound(c, "Link not found")
		return nil
	}
	allowed := access.CanManage(role)
	if share.NoteID != nil && !allowed {
		author, _, _, err := h.repo.NoteAuthorAndSpace(*share.NoteID)
		allowed = err == nil && (access.CanPublishNote(role, author, userID) || (access.CanWrite(role) && share.CreatedBy == userID))
	}
	if !allowed {
		forbidden(c, "You can't change this link")
		return nil
	}
	return share
}

// PATCH /shares/:token  {includeReplies}
func (h *SharingHandler) UpdateShare(c *gin.Context) {
	share := h.shareForManage(c)
	if share == nil {
		return
	}
	var req struct {
		IncludeReplies *bool `json:"includeReplies"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.IncludeReplies == nil {
		badRequest(c, "includeReplies is required")
		return
	}
	if err := h.repo.SetShareReplies(share.ID, *req.IncludeReplies); err != nil {
		h.fail(c, "update share", err)
		return
	}
	share.IncludeReplies = *req.IncludeReplies
	h.pingSpace(share.SpaceID)
	c.JSON(http.StatusOK, types.NewSuccessResponse(share))
}

// DELETE /shares/:token — make it private again. The old link stops working.
func (h *SharingHandler) DeleteShare(c *gin.Context) {
	share := h.shareForManage(c)
	if share == nil {
		return
	}
	if err := h.repo.RevokeShare(share.ID); err != nil {
		h.fail(c, "revoke share", err)
		return
	}
	h.pingSpace(share.SpaceID)
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{"revoked": true}))
}

// pingSpace tells members' open apps to pull (share state is part of the pull).
func (h *SharingHandler) pingSpace(spaceID int) {
	if h.notifier == nil {
		return
	}
	ids, err := h.repo.MemberIDs([]int{spaceID})
	if err != nil {
		return
	}
	for _, id := range ids {
		h.notifier.NotifyUser(id, map[string]any{"type": "SyncPushed"})
	}
}

// GET /public/:token — no sign-in. Shows only what the link covers; never e-mails or user ids.
func (h *SharingHandler) PublicView(c *gin.Context) {
	share, err := h.repo.ShareByToken(c.Param("token"))
	c.Header("Cache-Control", "no-store")
	if err != nil {
		notFound(c, "This link does not work any more")
		return
	}
	space, err := h.repo.Space(share.SpaceID)
	if err != nil || space.IsDeleted {
		notFound(c, "This link does not work any more")
		return
	}
	notes, err := h.repo.PublicNotes(share)
	if err != nil {
		h.fail(c, "public notes", err)
		return
	}
	if share.NoteID != nil && len(notes) == 0 {
		notFound(c, "This link does not work any more")
		return
	}
	kind := "space"
	if share.NoteID != nil {
		kind = "note"
	}
	c.JSON(http.StatusOK, types.NewSuccessResponse(gin.H{
		"kind": kind, "spaceName": space.Name, "rootNoteId": share.NoteID, "includeReplies": share.IncludeReplies, "notes": notes,
	}))
}

// GET /public/:token/files/:fileId — only files of notes the link covers.
func (h *SharingHandler) PublicFile(c *gin.Context) {
	share, err := h.repo.ShareByToken(c.Param("token"))
	if err != nil {
		notFound(c, "Not found")
		return
	}
	notes, err := h.repo.PublicNotes(share)
	if err != nil {
		h.fail(c, "public file notes", err)
		return
	}
	fileID := c.Param("fileId")
	for _, n := range notes {
		for _, a := range n.Attachments {
			if a.ID == fileID {
				serveAttachmentContent(c, a.ID, a.FileType, "public, max-age=300")
				return
			}
		}
	}
	notFound(c, "Not found")
}
