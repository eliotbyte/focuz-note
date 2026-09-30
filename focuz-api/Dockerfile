FROM golang:1.24-alpine AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o focuz-api main.go

FROM golang:1.24-alpine AS test
WORKDIR /app
COPY --from=builder /app ./
CMD ["go", "test", "./..."]

FROM alpine:latest AS production
WORKDIR /root

COPY --from=builder /app/focuz-api .
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/config ./config

RUN apk --no-cache add postgresql-client

EXPOSE 8080
CMD ["./focuz-api"]
