package notify

import (
	"encoding/json"
	"log/slog"

	"focuz-api/websocket"
)

// Notifier defines a minimal interface for sending real-time notifications to users.
type Notifier interface {
	NotifyUser(userID int, event interface{})
}

// WSNotifier implements Notifier using a WebSocket Hub.
type WSNotifier struct {
	Hub *websocket.Hub
}

// NotifyUser serializes the event as JSON and delivers it to all connected clients of the user.
func (n *WSNotifier) NotifyUser(userID int, event interface{}) {
	if n == nil || n.Hub == nil {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		slog.Error("failed to marshal notification", "err", err)
		return
	}
	n.Hub.NotifyUser(userID, payload)
}
