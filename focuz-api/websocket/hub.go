package websocket

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"focuz-api/pkg/appenv"
	"focuz-api/pkg/authtoken"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Client represents a websocket connection bound to a user.
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	userID int
}

// Hub manages active clients and broadcasts.
type Hub struct {
	register   chan *Client
	unregister chan *Client
	// Map of userID to set of clients
	clientsByUser map[int]map[*Client]bool
}

// NewHub creates and starts a new Hub loop.
func NewHub() *Hub {
	h := &Hub{
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		clientsByUser: make(map[int]map[*Client]bool),
	}
	go h.run()
	return h
}

func (h *Hub) run() {
	for {
		select {
		case c := <-h.register:
			set, ok := h.clientsByUser[c.userID]
			if !ok {
				set = make(map[*Client]bool)
				h.clientsByUser[c.userID] = set
			}
			set[c] = true
		case c := <-h.unregister:
			if set, ok := h.clientsByUser[c.userID]; ok {
				if _, exists := set[c]; exists {
					delete(set, c)
					close(c.send)
					if len(set) == 0 {
						delete(h.clientsByUser, c.userID)
					}
				}
			}
		}
	}
}

func (h *Hub) NotifyUser(userID int, payload []byte) {
	if h == nil {
		return
	}
	if set, ok := h.clientsByUser[userID]; ok {
		for c := range set {
			select {
			case c.send <- payload:
			default:
				close(c.send)
				delete(set, c)
			}
		}
		if len(set) == 0 {
			delete(h.clientsByUser, userID)
		}
	}
}

var upgrader = websocket.Upgrader{
	Subprotocols:    []string{Subprotocol},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// In production, only allow origins explicitly listed in ALLOWED_ORIGINS (comma-separated).
	CheckOrigin: func(r *http.Request) bool {
		if appenv.IsProduction() || gin.Mode() == gin.ReleaseMode {
			allowed := map[string]struct{}{}
			for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
				origin := strings.TrimSpace(o)
				if origin != "" {
					allowed[origin] = struct{}{}
				}
			}
			origin := r.Header.Get("Origin")
			_, ok := allowed[origin]
			_, any := allowed["*"]
			return ok || any
		}
		return true
	},
}

// Subprotocol the web app offers next to "bearer.<token>". The server answers with it: browsers
// cannot set an Authorization header on a WebSocket, and a token in the URL would end up in proxy
// and server logs.
const Subprotocol = "focuz.v1"

// bearerFromProtocols returns the token offered as the "bearer.<token>" subprotocol.
func bearerFromProtocols(r *http.Request) string {
	for _, p := range websocket.Subprotocols(r) {
		if strings.HasPrefix(p, "bearer.") {
			return strings.TrimPrefix(p, "bearer.")
		}
	}
	return ""
}

// ServeWS upgrades HTTP connection to WebSocket and registers the client.
// The login token comes in the Sec-WebSocket-Protocol header (see Subprotocol).
func ServeWS(h *Hub, tokens *authtoken.Tokens) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, err := tokens.Verify(bearerFromProtocols(c.Request))
		if err != nil {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			slog.Error("websocket upgrade failed", "err", err)
			return
		}
		client := &Client{hub: h, conn: conn, send: make(chan []byte, 256), userID: userID}
		h.register <- client

		// Reader goroutine
		go func() {
			defer func() {
				h.unregister <- client
				_ = conn.Close()
			}()
			conn.SetReadLimit(1024)
			_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			conn.SetPongHandler(func(string) error {
				return conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			})
			for {
				_, _, err := conn.ReadMessage()
				if err != nil {
					break
				}
			}
		}()

		// Writer loop (same goroutine). Pings keep the connection alive: the reader drops it after
		// 60s without a pong.
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		// Closing on a write error also ends the reader, which unregisters the client.
		defer conn.Close()
		for {
			select {
			case msg, ok := <-client.send:
				if !ok {
					return
				}
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-ping.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)); err != nil {
					return
				}
			}
		}
	}
}
