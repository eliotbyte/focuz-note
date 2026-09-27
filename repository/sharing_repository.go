package repository

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/lib/pq"
)

// SharingRepository holds space membership, invitations, public links and note history.
type SharingRepository struct {
	db *sql.DB
}

func NewSharingRepository(db *sql.DB) *SharingRepository { return &SharingRepository{db: db} }

var ErrNotFound = errors.New("not found")

// ---- spaces & members ----

type SpaceInfo struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	OwnerID     int    `json:"ownerId"`
	IsPersonal  bool   `json:"isPersonal"`
	IsDeleted   bool   `json:"-"`
	MemberCount int    `json:"memberCount"`
}

func (r *SharingRepository) Space(spaceID int) (*SpaceInfo, error) {
	var s SpaceInfo
	var owner sql.NullInt64
	err := r.db.QueryRow(`
		SELECT s.id, s.name, s.owner_id, s.is_personal, COALESCE(s.is_deleted, FALSE),
		       (SELECT COUNT(*) FROM user_to_space u WHERE u.space_id = s.id AND u.is_pending = FALSE)
		FROM space s WHERE s.id = $1`, spaceID).Scan(&s.ID, &s.Name, &owner, &s.IsPersonal, &s.IsDeleted, &s.MemberCount)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.OwnerID = int(owner.Int64)
	return &s, nil
}

type Membership struct {
	SpaceID     int    `json:"space_id"`
	Name        string `json:"name"`
	RoleID      int    `json:"-"`
	Role        string `json:"role"`
	IsPersonal  bool   `json:"is_personal"`
	MemberCount int    `json:"member_count"`
	// IconVersion changes whenever the space picture changes (0 = none).
	IconVersion int64 `json:"icon_version"`
}

// Memberships lists the spaces the user is an active member of.
func (r *SharingRepository) Memberships(userID int) ([]Membership, error) {
	rows, err := r.db.Query(`
		SELECT s.id, s.name, u.role_id, s.is_personal,
		       (SELECT COUNT(*) FROM user_to_space x WHERE x.space_id = s.id AND x.is_pending = FALSE),
		       COALESCE((EXTRACT(EPOCH FROM s.icon_updated_at) * 1000)::BIGINT, 0)
		FROM user_to_space u JOIN space s ON s.id = u.space_id
		WHERE u.user_id = $1 AND u.is_pending = FALSE AND s.is_deleted = FALSE
		ORDER BY s.is_personal DESC, s.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Membership{}
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.SpaceID, &m.Name, &m.RoleID, &m.IsPersonal, &m.MemberCount, &m.IconVersion); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type Member struct {
	SpaceID  int    `json:"space_id"`
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	RoleID   int    `json:"-"`
	Role     string `json:"role"`
	// AvatarVersion changes whenever the person's picture changes (0 = none).
	AvatarVersion int64 `json:"avatar_version"`
}

// Members lists the members of the given spaces (usernames only, never e-mail addresses).
func (r *SharingRepository) Members(spaceIDs []int) ([]Member, error) {
	rows, err := r.db.Query(`
		SELECT u.space_id, us.id, us.username, u.role_id, COALESCE((EXTRACT(EPOCH FROM us.avatar_updated_at) * 1000)::BIGINT, 0)
		FROM user_to_space u JOIN users us ON us.id = u.user_id
		WHERE u.space_id = ANY($1) AND u.is_pending = FALSE
		ORDER BY u.space_id, u.role_id = (SELECT id FROM role WHERE name = 'owner') DESC, LOWER(us.username)`, pq.Array(spaceIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.SpaceID, &m.UserID, &m.Username, &m.RoleID, &m.AvatarVersion); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MemberIDs returns the distinct user ids of all members of the given spaces.
func (r *SharingRepository) MemberIDs(spaceIDs []int) ([]int, error) {
	rows, err := r.db.Query(`SELECT DISTINCT user_id FROM user_to_space WHERE space_id = ANY($1) AND is_pending = FALSE`, pq.Array(spaceIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *SharingRepository) RoleOf(userID, spaceID int) (int, error) {
	var roleID int
	err := r.db.QueryRow(`
		SELECT u.role_id FROM user_to_space u JOIN space s ON s.id = u.space_id
		WHERE u.user_id = $1 AND u.space_id = $2 AND u.is_pending = FALSE AND s.is_deleted = FALSE`, userID, spaceID).Scan(&roleID)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return roleID, err
}

func (r *SharingRepository) SetRole(spaceID, userID, roleID int) error {
	_, err := r.db.Exec(`UPDATE user_to_space SET role_id = $3 WHERE space_id = $1 AND user_id = $2`, spaceID, userID, roleID)
	if err == nil {
		_, err = r.db.Exec(`UPDATE space SET modified_at = NOW() WHERE id = $1`, spaceID)
	}
	return err
}

func (r *SharingRepository) RemoveMember(spaceID, userID int) error {
	_, err := r.db.Exec(`DELETE FROM user_to_space WHERE space_id = $1 AND user_id = $2`, spaceID, userID)
	return err
}

// ---- invitations ----

type Invitation struct {
	ID          int        `json:"id"`
	SpaceID     int        `json:"spaceId"`
	SpaceName   string     `json:"spaceName,omitempty"`
	InviterID   int        `json:"-"`
	InviterName string     `json:"inviterName"`
	InviteeID   *int       `json:"-"`
	Identifier  string     `json:"identifier,omitempty"`
	RoleID      int        `json:"-"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	ExpiresAt   time.Time  `json:"expiresAt"`
	RespondedAt *time.Time `json:"-"`
}

const invitationSelect = `
	SELECT i.id, i.space_id, s.name, i.inviter_id, us.username, i.invitee_id, i.identifier, i.role_id, i.status, i.created_at, i.expires_at, i.responded_at
	FROM space_invitations i JOIN space s ON s.id = i.space_id JOIN users us ON us.id = i.inviter_id`

func scanInvitations(rows *sql.Rows) ([]Invitation, error) {
	defer rows.Close()
	out := []Invitation{}
	for rows.Next() {
		var inv Invitation
		var invitee sql.NullInt64
		if err := rows.Scan(&inv.ID, &inv.SpaceID, &inv.SpaceName, &inv.InviterID, &inv.InviterName, &invitee, &inv.Identifier, &inv.RoleID, &inv.Status, &inv.CreatedAt, &inv.ExpiresAt, &inv.RespondedAt); err != nil {
			return nil, err
		}
		if invitee.Valid {
			id := int(invitee.Int64)
			inv.InviteeID = &id
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// CreateInvitation stores a pending invitation. Inviting the same identifier twice returns the
// existing pending one (refreshed), so repeated invites never reveal anything new.
func (r *SharingRepository) CreateInvitation(spaceID, inviterID int, inviteeID *int, identifier string, roleID int) (*Invitation, bool, error) {
	var id int
	var created bool
	err := r.db.QueryRow(`
		INSERT INTO space_invitations (space_id, inviter_id, invitee_id, identifier, role_id)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (space_id, LOWER(identifier)) WHERE status = 'pending'
		DO UPDATE SET role_id = EXCLUDED.role_id, inviter_id = EXCLUDED.inviter_id, expires_at = NOW() + INTERVAL '30 days'
		RETURNING id, (xmax = 0)`, spaceID, inviterID, inviteeID, identifier, roleID).Scan(&id, &created)
	if err != nil {
		return nil, false, err
	}
	inv, err := r.Invitation(id)
	return inv, created, err
}

func (r *SharingRepository) Invitation(id int) (*Invitation, error) {
	rows, err := r.db.Query(invitationSelect+` WHERE i.id = $1`, id)
	if err != nil {
		return nil, err
	}
	list, err := scanInvitations(rows)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, ErrNotFound
	}
	return &list[0], nil
}

func (r *SharingRepository) PendingForSpace(spaceID int) ([]Invitation, error) {
	rows, err := r.db.Query(invitationSelect+` WHERE i.space_id = $1 AND i.status = 'pending' AND i.expires_at > NOW() ORDER BY i.created_at DESC`, spaceID)
	if err != nil {
		return nil, err
	}
	return scanInvitations(rows)
}

func (r *SharingRepository) PendingForUser(userID int) ([]Invitation, error) {
	rows, err := r.db.Query(invitationSelect+` WHERE i.invitee_id = $1 AND i.status = 'pending' AND i.expires_at > NOW() AND s.is_deleted = FALSE ORDER BY i.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	return scanInvitations(rows)
}

// CountRecentInvitations counts invitations sent by a user since t (for rate limiting).
func (r *SharingRepository) CountRecentInvitations(inviterID int, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM space_invitations WHERE inviter_id = $1 AND created_at > $2`, inviterID, since).Scan(&n)
	return n, err
}

func (r *SharingRepository) SetInvitationStatus(id int, status string) error {
	_, err := r.db.Exec(`UPDATE space_invitations SET status = $2, responded_at = NOW() WHERE id = $1 AND status = 'pending'`, id, status)
	return err
}

// AcceptInvitation adds the invitee to the space. An existing member keeps their role.
func (r *SharingRepository) AcceptInvitation(inv *Invitation, userID int) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.Exec(`UPDATE space_invitations SET status = 'accepted', responded_at = NOW() WHERE id = $1 AND status = 'pending' AND invitee_id = $2 AND expires_at > NOW()`, inv.ID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(`
		INSERT INTO user_to_space (user_id, space_id, role_id, is_pending) VALUES ($1, $2, $3, FALSE)
		ON CONFLICT (user_id, space_id) DO UPDATE SET is_pending = FALSE`, userID, inv.SpaceID, inv.RoleID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE space SET modified_at = NOW() WHERE id = $1`, inv.SpaceID); err != nil {
		return err
	}
	return tx.Commit()
}

// AttachInvitationsByEmail links pending invitations addressed to an e-mail to the account that
// just confirmed it. Returns the invitations that were attached.
func (r *SharingRepository) AttachInvitationsByEmail(userID int, email string) ([]Invitation, error) {
	rows, err := r.db.Query(`
		UPDATE space_invitations SET invitee_id = $1
		WHERE invitee_id IS NULL AND status = 'pending' AND expires_at > NOW() AND LOWER(identifier) = LOWER($2)
		RETURNING id`, userID, email)
	if err != nil {
		return nil, err
	}
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	out := []Invitation{}
	for _, id := range ids {
		if inv, err := r.Invitation(id); err == nil {
			out = append(out, *inv)
		}
	}
	return out, nil
}

// ---- users ----

type UserInfo struct {
	ID            int
	Username      string
	Email         *string
	EmailVerified bool
	NotifyEmail   bool
}

func (r *SharingRepository) User(userID int) (*UserInfo, error) {
	var u UserInfo
	var email sql.NullString
	var verified sql.NullTime
	err := r.db.QueryRow(`SELECT id, username, email, email_verified_at, notify_email FROM users WHERE id = $1`, userID).
		Scan(&u.ID, &u.Username, &email, &verified, &u.NotifyEmail)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if email.Valid {
		u.Email = &email.String
	}
	u.EmailVerified = verified.Valid
	return &u, nil
}

// FindUserID looks a user up by username or e-mail (case-insensitive). 0 when there is none.
func (r *SharingRepository) FindUserID(identifier string, byEmail bool) (int, error) {
	q := `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`
	if byEmail {
		q = `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND email_verified_at IS NOT NULL`
	}
	var id int
	err := r.db.QueryRow(q, identifier).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return id, err
}

func (r *SharingRepository) SetNotifyEmail(userID int, on bool) error {
	_, err := r.db.Exec(`UPDATE users SET notify_email = $2 WHERE id = $1`, userID, on)
	return err
}

// ---- note history ----

type NoteEdit struct {
	Username string    `json:"username"`
	Action   string    `json:"action"`
	At       time.Time `json:"at"`
}

type NoteHistory struct {
	NoteID     int        `json:"noteId"`
	SpaceID    int        `json:"-"`
	CreatedBy  string     `json:"createdBy"`
	CreatedAt  time.Time  `json:"createdAt"`
	ModifiedBy string     `json:"modifiedBy"`
	ModifiedAt time.Time  `json:"modifiedAt"`
	Edits      []NoteEdit `json:"edits"`
}

func (r *SharingRepository) NoteHistory(noteID int) (*NoteHistory, error) {
	h := NoteHistory{NoteID: noteID, Edits: []NoteEdit{}}
	err := r.db.QueryRow(`
		SELECT n.space_id, a.username, n.created_at, COALESCE(m.username, a.username), n.modified_at
		FROM note n JOIN users a ON a.id = n.user_id LEFT JOIN users m ON m.id = n.modified_by
		WHERE n.id = $1`, noteID).Scan(&h.SpaceID, &h.CreatedBy, &h.CreatedAt, &h.ModifiedBy, &h.ModifiedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.db.Query(`
		SELECT u.username, e.action, e.edited_at FROM note_edits e JOIN users u ON u.id = e.user_id
		WHERE e.note_id = $1 ORDER BY e.edited_at DESC, e.id DESC LIMIT 100`, noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e NoteEdit
		if err := rows.Scan(&e.Username, &e.Action, &e.At); err != nil {
			return nil, err
		}
		h.Edits = append(h.Edits, e)
	}
	return &h, rows.Err()
}

// ---- public links ----

type Share struct {
	ID             int       `json:"-"`
	Token          string    `json:"token"`
	SpaceID        int       `json:"space_id"`
	NoteID         *int      `json:"note_id"`
	IncludeReplies bool      `json:"include_replies"`
	CreatedBy      int       `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
}

func newToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

const shareSelect = `SELECT id, token, space_id, note_id, include_replies, created_by, created_at FROM public_links`

func scanShare(row interface{ Scan(...any) error }) (*Share, error) {
	var s Share
	var note sql.NullInt64
	if err := row.Scan(&s.ID, &s.Token, &s.SpaceID, &note, &s.IncludeReplies, &s.CreatedBy, &s.CreatedAt); err != nil {
		return nil, err
	}
	if note.Valid {
		id := int(note.Int64)
		s.NoteID = &id
	}
	return &s, nil
}

// ActiveShare returns the active link for a space (noteID nil) or a note, or ErrNotFound.
func (r *SharingRepository) ActiveShare(spaceID int, noteID *int) (*Share, error) {
	s, err := scanShare(r.db.QueryRow(shareSelect+` WHERE space_id = $1 AND COALESCE(note_id, 0) = COALESCE($2, 0) AND revoked_at IS NULL`, spaceID, noteID))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return s, err
}

// Share creates the public link (or updates include_replies on the existing one).
func (r *SharingRepository) Share(spaceID int, noteID *int, includeReplies bool, userID int) (*Share, error) {
	if existing, err := r.ActiveShare(spaceID, noteID); err == nil {
		_, err := r.db.Exec(`UPDATE public_links SET include_replies = $2, modified_at = NOW() WHERE id = $1`, existing.ID, includeReplies)
		existing.IncludeReplies = includeReplies
		return existing, err
	} else if err != ErrNotFound {
		return nil, err
	}
	token, err := newToken()
	if err != nil {
		return nil, err
	}
	return scanShare(r.db.QueryRow(`
		INSERT INTO public_links (token, space_id, note_id, include_replies, created_by) VALUES ($1, $2, $3, $4, $5)
		RETURNING id, token, space_id, note_id, include_replies, created_by, created_at`, token, spaceID, noteID, includeReplies, userID))
}

func (r *SharingRepository) ShareByToken(token string) (*Share, error) {
	s, err := scanShare(r.db.QueryRow(shareSelect+` WHERE token = $1 AND revoked_at IS NULL`, token))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *SharingRepository) SetShareReplies(id int, includeReplies bool) error {
	_, err := r.db.Exec(`UPDATE public_links SET include_replies = $2, modified_at = NOW() WHERE id = $1`, id, includeReplies)
	return err
}

func (r *SharingRepository) RevokeShare(id int) error {
	_, err := r.db.Exec(`UPDATE public_links SET revoked_at = NOW(), modified_at = NOW() WHERE id = $1`, id)
	return err
}

// Shares lists active links in the given spaces.
func (r *SharingRepository) Shares(spaceIDs []int) ([]Share, error) {
	rows, err := r.db.Query(shareSelect+` WHERE space_id = ANY($1) AND revoked_at IS NULL ORDER BY id`, pq.Array(spaceIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Share{}
	for rows.Next() {
		s, err := scanShare(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

type PublicAttachment struct {
	ID       string `json:"id"`
	FileName string `json:"fileName"`
	FileType string `json:"fileType"`
}

type PublicNote struct {
	ID          int                `json:"id"`
	ParentID    *int               `json:"parentId"`
	Text        string             `json:"text"`
	Tags        []string           `json:"tags"`
	Author      string             `json:"author"`
	CreatedAt   time.Time          `json:"createdAt"`
	ModifiedAt  time.Time          `json:"modifiedAt"`
	Attachments []PublicAttachment `json:"attachments"`
}

const publicNoteLimit = 1000

// PublicNotes returns what a link shows: the whole space, or the note (and its replies, all levels).
func (r *SharingRepository) PublicNotes(s *Share) ([]PublicNote, error) {
	var rows *sql.Rows
	var err error
	cols := `n.id, n.parent_id, n.text, u.username, n.created_at, n.modified_at,
		COALESCE((SELECT ARRAY_AGG(t.name ORDER BY t.name) FROM note_to_tag nt JOIN tag t ON t.id = nt.tag_id WHERE nt.note_id = n.id), ARRAY[]::text[]),
		COALESCE((SELECT json_agg(json_build_object('id', a.id, 'fileName', a.file_name, 'fileType', a.file_type) ORDER BY a.modified_at, a.id)
		          FROM attachments a WHERE a.note_id = n.id), '[]'::json)`
	switch {
	case s.NoteID == nil:
		rows, err = r.db.Query(`SELECT `+cols+` FROM note n JOIN users u ON u.id = n.user_id
			WHERE n.space_id = $1 AND n.is_deleted = FALSE ORDER BY n.date DESC, n.id DESC LIMIT $2`, s.SpaceID, publicNoteLimit)
	case s.IncludeReplies:
		rows, err = r.db.Query(`
			WITH RECURSIVE thread AS (
				SELECT id FROM note WHERE id = $1 AND space_id = $2 AND is_deleted = FALSE
				UNION
				SELECT c.id FROM note c JOIN thread t ON c.parent_id = t.id WHERE c.is_deleted = FALSE AND c.space_id = $2
			)
			SELECT `+cols+` FROM note n JOIN users u ON u.id = n.user_id JOIN thread t ON t.id = n.id
			ORDER BY n.created_at, n.id LIMIT $3`, *s.NoteID, s.SpaceID, publicNoteLimit)
	default:
		rows, err = r.db.Query(`SELECT `+cols+` FROM note n JOIN users u ON u.id = n.user_id
			WHERE n.id = $1 AND n.space_id = $2 AND n.is_deleted = FALSE`, *s.NoteID, s.SpaceID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicNote{}
	for rows.Next() {
		var n PublicNote
		var parent sql.NullInt64
		var atts []byte
		if err := rows.Scan(&n.ID, &parent, &n.Text, &n.Author, &n.CreatedAt, &n.ModifiedAt, pq.Array(&n.Tags), &atts); err != nil {
			return nil, err
		}
		if parent.Valid {
			id := int(parent.Int64)
			n.ParentID = &id
		}
		n.Attachments = []PublicAttachment{}
		_ = json.Unmarshal(atts, &n.Attachments)
		out = append(out, n)
	}
	return out, rows.Err()
}

// NoteAuthorAndSpace returns who wrote a note and where it lives.
func (r *SharingRepository) NoteAuthorAndSpace(noteID int) (authorID, spaceID int, deleted bool, err error) {
	err = r.db.QueryRow(`SELECT user_id, space_id, COALESCE(is_deleted, FALSE) FROM note WHERE id = $1`, noteID).Scan(&authorID, &spaceID, &deleted)
	if err == sql.ErrNoRows {
		err = ErrNotFound
	}
	return
}

func (r *SharingRepository) RenameSpace(spaceID int, name string) error {
	_, err := r.db.Exec(`UPDATE space SET name = $2, modified_at = NOW() WHERE id = $1`, spaceID, name)
	return err
}

// DeleteSpace hides the space for everyone and turns off its public links.
func (r *SharingRepository) DeleteSpace(spaceID int) error {
	if _, err := r.db.Exec(`UPDATE space SET is_deleted = TRUE, modified_at = NOW() WHERE id = $1`, spaceID); err != nil {
		return err
	}
	_, err := r.db.Exec(`UPDATE public_links SET revoked_at = NOW() WHERE space_id = $1 AND revoked_at IS NULL`, spaceID)
	return err
}

// ---- pictures (space icons, avatars) ----

type Picture struct {
	Data      []byte
	Type      string
	UpdatedAt time.Time
}

func (r *SharingRepository) scanPicture(row *sql.Row) (*Picture, error) {
	var p Picture
	var t sql.NullString
	var at sql.NullTime
	if err := row.Scan(&p.Data, &t, &at); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if len(p.Data) == 0 {
		return nil, ErrNotFound
	}
	p.Type, p.UpdatedAt = t.String, at.Time
	return &p, nil
}

func (r *SharingRepository) SpaceIcon(spaceID int) (*Picture, error) {
	return r.scanPicture(r.db.QueryRow(`SELECT icon, icon_type, icon_updated_at FROM space WHERE id = $1`, spaceID))
}

// SetSpaceIcon stores (or with nil data removes) the picture; modified_at moves so members pull it.
func (r *SharingRepository) SetSpaceIcon(spaceID int, data []byte, contentType string) error {
	if data == nil {
		_, err := r.db.Exec(`UPDATE space SET icon = NULL, icon_type = NULL, icon_updated_at = NULL, modified_at = NOW() WHERE id = $1`, spaceID)
		return err
	}
	_, err := r.db.Exec(`UPDATE space SET icon = $2, icon_type = $3, icon_updated_at = NOW(), modified_at = NOW() WHERE id = $1`, spaceID, data, contentType)
	return err
}

func (r *SharingRepository) Avatar(userID int) (*Picture, error) {
	return r.scanPicture(r.db.QueryRow(`SELECT avatar, avatar_type, avatar_updated_at FROM users WHERE id = $1`, userID))
}

func (r *SharingRepository) SetAvatar(userID int, data []byte, contentType string) error {
	if data == nil {
		_, err := r.db.Exec(`UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_updated_at = NULL WHERE id = $1`, userID)
		return err
	}
	_, err := r.db.Exec(`UPDATE users SET avatar = $2, avatar_type = $3, avatar_updated_at = NOW() WHERE id = $1`, userID, data, contentType)
	return err
}

func (r *SharingRepository) AvatarVersion(userID int) int64 {
	var v int64
	_ = r.db.QueryRow(`SELECT COALESCE((EXTRACT(EPOCH FROM avatar_updated_at) * 1000)::BIGINT, 0) FROM users WHERE id = $1`, userID).Scan(&v)
	return v
}

// ShareASpace reports whether two people are members of at least one common space.
func (r *SharingRepository) ShareASpace(a, b int) (bool, error) {
	var ok bool
	err := r.db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM user_to_space x JOIN user_to_space y ON x.space_id = y.space_id JOIN space s ON s.id = x.space_id
			WHERE x.user_id = $1 AND y.user_id = $2 AND x.is_pending = FALSE AND y.is_pending = FALSE AND s.is_deleted = FALSE)`, a, b).Scan(&ok)
	return ok, err
}
