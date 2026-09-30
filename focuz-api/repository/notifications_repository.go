package repository

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"time"
)

type Notification struct {
	ID      int
	UserID  int
	Type    string
	Payload []byte
	IsRead  bool
	Sticky  bool
}

type NotificationsRepository struct {
	db *sql.DB
}

func NewNotificationsRepository(db *sql.DB) *NotificationsRepository {
	return &NotificationsRepository{db: db}
}

func (r *NotificationsRepository) Create(userID int, notifType string, payload []byte, sticky bool) error {
	_, err := r.db.Exec(`
		INSERT INTO notifications (user_id, type, payload, sticky)
		VALUES ($1, $2, $3, $4)
	`, userID, notifType, payload, sticky)
	return err
}

func (r *NotificationsRepository) ListUnread(userID int) ([]Notification, error) {
	rows, err := r.db.Query(`
		SELECT id, user_id, type, payload, is_read, sticky
		FROM notifications
		WHERE user_id = $1 AND is_read = FALSE
		ORDER BY sticky DESC, created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []Notification
	for rows.Next() {
		n := Notification{}
		var payload []byte
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &payload, &n.IsRead, &n.Sticky); err != nil {
			return nil, err
		}
		n.Payload = payload
		result = append(result, n)
	}
	return result, nil
}

func (r *NotificationsRepository) MarkRead(userID int, ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	// Simple approach: update in a loop to avoid SQL array binding complexity here
	for _, id := range ids {
		_, err := r.db.Exec(`
			UPDATE notifications SET is_read = TRUE, read_at = NOW()
			WHERE id = $1 AND user_id = $2
		`, id, userID)
		if err != nil {
			return err
		}
	}
	return nil
}

type NotificationItem struct {
	ID        int             `json:"id"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	IsRead    bool            `json:"isRead"`
	CreatedAt time.Time       `json:"createdAt"`
	// For space_invitation: pending | accepted | declined | cancelled | expired, so an old
	// invitation doesn't look like it is still waiting for an answer.
	InvitationStatus string `json:"invitationStatus,omitempty"`
}

// List returns the latest notifications (read and unread), newest first.
func (r *NotificationsRepository) List(userID, limit int) ([]NotificationItem, int, error) {
	// The invitation id is compared as text: payloads are JSON, a cast would fail the whole list on bad data.
	rows, err := r.db.Query(`
		SELECT n.id, n.type, n.payload, n.is_read, n.created_at,
		       CASE WHEN i.status = 'pending' AND i.expires_at < NOW() THEN 'expired' ELSE COALESCE(i.status, '') END
		FROM notifications n
		LEFT JOIN space_invitations i
		       ON n.type = 'space_invitation' AND i.id::text = n.payload->>'invitationId' AND i.invitee_id = n.user_id
		WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []NotificationItem{}
	for rows.Next() {
		var n NotificationItem
		var payload []byte
		if err := rows.Scan(&n.ID, &n.Type, &payload, &n.IsRead, &n.CreatedAt, &n.InvitationStatus); err != nil {
			return nil, 0, err
		}
		n.Payload = payload
		out = append(out, n)
	}
	var unread int
	if err := r.db.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE`, userID).Scan(&unread); err != nil {
		return nil, 0, err
	}
	return out, unread, rows.Err()
}

func (r *NotificationsRepository) MarkAllRead(userID int) error {
	_, err := r.db.Exec(`UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = $1 AND is_read = FALSE`, userID)
	return err
}

// ResolveInvitation marks the invitation's notification read once it was answered or cancelled.
func (r *NotificationsRepository) ResolveInvitation(userID, invitationID int) error {
	_, err := r.db.Exec(`
		UPDATE notifications SET is_read = TRUE, read_at = NOW()
		WHERE user_id = $1 AND type = 'space_invitation' AND payload->>'invitationId' = $2`, userID, strconv.Itoa(invitationID))
	return err
}
