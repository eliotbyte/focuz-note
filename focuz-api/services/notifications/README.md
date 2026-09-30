# Notifications Service (planned)

This service will handle real-time notifications via WebSocket and optional email delivery.

- Ingests domain events (e.g. InvitationCreated) from a broker (Redis/NATS)
- Pushes events to connected users using WebSocket rooms (user:{id}, space:{id})
- Optionally sends email notifications for offline users

Phase 1: in-process WS hub (done in main API)
Phase 2: extract as separate service and wire through broker 