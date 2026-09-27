package main

import (
	"database/sql"
	"focuz-api/handlers"
	"focuz-api/initializers"
	"focuz-api/middleware"
	"focuz-api/pkg/appenv"
	"focuz-api/pkg/authcfg"
	"focuz-api/pkg/mailer"
	"focuz-api/pkg/notify"
	"focuz-api/repository"
	"focuz-api/websocket"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/lib/pq"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if len(jwtSecret) < 32 {
		log.Fatal("JWT_SECRET must be set and at least 32 characters")
	}
	// Secrets published in this repository (compose defaults / examples): anyone can mint tokens
	// for any user with them. Not fatal, to avoid taking down existing installs on upgrade.
	for _, known := range []string{
		"dev-secret-change-me-please-0123456789abcdef",
		"test-secret-change-me-please-0123456789abcdef",
		"your_super_secret_jwt_key_at_least_32_chars_long",
	} {
		if jwtSecret == known {
			log.Printf("SECURITY WARNING: JWT_SECRET is a publicly known default value. Anyone can forge login tokens. Set a random JWT_SECRET (e.g. `openssl rand -hex 32`); all users will need to sign in again.")
		}
	}

	var db *sql.DB
	var err error
	for i := 0; i < 10; i++ {
		db, err = sql.Open("postgres", dbURL)
		if err == nil {
			err = db.Ping()
			if err == nil {
				break
			}
		}
		log.Printf("DB connection failed: %v, retrying in 2s...", err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatal("Could not connect to database:", err)
	}
	defer db.Close()

	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		log.Fatal("Migration driver error:", err)
	}
	m, err := migrate.NewWithDatabaseInstance("file://migrations", "postgres", driver)
	if err != nil {
		log.Fatal("Migration init error:", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatal("Migration failed:", err)
	}

	if err := initializers.InitDefaults(db); err != nil {
		log.Fatal("Failed to initialize default data:", err)
	}

	if err := initializers.InitMinio(); err != nil {
		log.Fatal("Failed to initialize Minio:", err)
	}

	spacesRepo := repository.NewSpacesRepository(db)
	notesRepo := repository.NewNotesRepository(db)
	rolesRepo := repository.NewRolesRepository(db)
	activityTypesRepo := repository.NewActivityTypesRepository(db)
	activitiesRepo := repository.NewActivitiesRepository(db)
	attachmentsRepo := repository.NewAttachmentsRepository(db)
	chartsRepo := repository.NewChartsRepository(db)
	notificationsRepo := repository.NewNotificationsRepository(db)
	filtersRepo := repository.NewFiltersRepository(db)

	// New repos for sync and tags
	syncRepo := repository.NewSyncRepository(db)
	tagsRepo := repository.NewTagsRepository(db)

	r := gin.New()
	// Structured request ID and JSON access logs
	r.Use(middleware.RequestIDMiddleware())
	r.Use(middleware.LoggerMiddleware())
	// Panic recovery
	r.Use(gin.Recovery())

	// Configure trusted proxies for correct client IP handling in production
	trustedProxies := os.Getenv("TRUSTED_PROXIES")
	if trustedProxies != "" {
		parts := strings.Split(trustedProxies, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		if err := r.SetTrustedProxies(parts); err != nil {
			log.Fatalf("Invalid TRUSTED_PROXIES: %v", err)
		}
	} else {
		// Default to loopback only; override via TRUSTED_PROXIES in production
		_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})
	}

	r.Use(middleware.CORSMiddleware())
	// Apply rate limiting globally after CORS but before routes
	r.Use(middleware.RateLimitMiddleware())

	// Initialize WebSocket hub and notifier
	hub := websocket.NewHub()
	notifier := &notify.WSNotifier{Hub: hub}

	// Public endpoints
	r.GET("/health", handlers.HealthCheck)
	r.GET("/ws", websocket.ServeWS(hub))

	// Handlers
	notesHandler := handlers.NewNotesHandler(notesRepo, spacesRepo)
	spacesHandler := handlers.NewSpacesHandler(spacesRepo, rolesRepo).WithNotifier(notifier).WithNotificationsRepo(notificationsRepo)
	activityTypesHandler := handlers.NewActivityTypesHandler(activityTypesRepo, spacesRepo)
	activitiesHandler := handlers.NewActivitiesHandler(
		activitiesRepo,
		spacesRepo,
		notesRepo,
		activityTypesRepo,
	)
	attachmentsHandler := handlers.NewAttachmentsHandler(attachmentsRepo, notesRepo, spacesRepo)
	chartsHandler := handlers.NewChartsHandler(chartsRepo, spacesRepo, activityTypesRepo, notesRepo)
	notificationsHandler := handlers.NewNotificationsHandler(notificationsRepo)
	filtersHandler := handlers.NewFiltersHandler(filtersRepo, spacesRepo)
	sharingRepo := repository.NewSharingRepository(db)
	syncHandler := handlers.NewSyncHandler(syncRepo, spacesRepo, tagsRepo, filtersRepo).
		WithNotifier(notifier).
		WithSharing(sharingRepo).
		WithLimits(
			parseInt64Env("SYNC_MAX_BODY_BYTES", 25*1024*1024),
			parseIntEnv("SYNC_MAX_BATCH_ITEMS", 10000),
		)

	// Set Gin to release mode in production
	if os.Getenv("GIN_MODE") == "release" || appenv.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	authConfig, err := authcfg.FromEnv()
	if err != nil {
		log.Fatal(err)
	}
	mail, err := mailer.FromEnv()
	if err != nil {
		log.Fatal("Mail configuration: ", err)
	}
	log.Printf("Accounts: mode=%s registration=%v mail=%s", authConfig.Mode, authConfig.RegistrationOpen, mail.Describe())
	if authConfig.Mode == authcfg.ModeEmail && authConfig.PublicAPIURL == "" {
		log.Printf("PUBLIC_API_URL is not set: confirmation emails will contain the code only, without a link")
	}
	usersRepo := repository.NewUsersRepository(db)
	sharingHandler := handlers.NewSharingHandler(sharingRepo, usersRepo, notificationsRepo, notifier, mail, authConfig)
	authHandler := handlers.NewAuthHandler(usersRepo, authConfig, mail, jwtSecret).OnEmailVerified(sharingHandler.OnEmailVerified)

	r.GET("/auth/config", authHandler.Config)
	// Public endpoints with stricter auth rate limit
	authPublic := r.Group("/", middleware.RateLimitAuthMiddleware())
	authPublic.POST("/register", authHandler.Register)
	authPublic.POST("/login", authHandler.Login)
	authPublic.POST("/auth/verify-email", authHandler.VerifyEmail)
	authPublic.POST("/auth/resend-verification", authHandler.ResendVerification)
	authPublic.GET("/auth/verify", authHandler.VerifyEmailLink)

	// Public read-only links (no sign-in); unguessable tokens, rate-limited like everything else.
	r.GET("/public/:token", sharingHandler.PublicView)
	r.GET("/public/:token/files/:fileId", sharingHandler.PublicFile)

	auth := r.Group("/", handlers.AuthMiddleware(jwtSecret))
	{
		auth.GET("/spaces", spacesHandler.GetAccessibleSpaces)
		auth.POST("/spaces", spacesHandler.CreateSpace)
		auth.PATCH("/spaces/:spaceId", sharingHandler.RenameSpace)
		auth.PATCH("/spaces/:spaceId/delete", sharingHandler.DeleteSpace)
		auth.PATCH("/spaces/:spaceId/restore", spacesHandler.RestoreSpace)
		auth.GET("/spaces/:spaceId/members", sharingHandler.ListMembers)
		auth.GET("/spaces/:spaceId/users", sharingHandler.ListMembers)
		auth.PATCH("/spaces/:spaceId/members/:userId", sharingHandler.SetMemberRole)
		auth.DELETE("/spaces/:spaceId/members/:userId", sharingHandler.RemoveMember)
		auth.DELETE("/spaces/:spaceId/users/:userId", sharingHandler.RemoveMember)
		auth.POST("/spaces/:spaceId/invitations", sharingHandler.Invite)
		auth.POST("/spaces/:spaceId/invite", sharingHandler.Invite)
		auth.GET("/spaces/:spaceId/invitations", sharingHandler.SpaceInvitations)
		auth.DELETE("/spaces/:spaceId/invitations/:invitationId", sharingHandler.CancelInvitation)
		auth.POST("/spaces/:spaceId/invitations/accept", sharingHandler.AcceptInvitationBySpace)
		auth.POST("/spaces/:spaceId/invitations/decline", sharingHandler.DeclineInvitationBySpace)
		auth.GET("/invitations", sharingHandler.MyInvitations)
		auth.POST("/invitations/:invitationId/accept", sharingHandler.AcceptInvitation)
		auth.POST("/invitations/:invitationId/decline", sharingHandler.DeclineInvitation)
		auth.POST("/spaces/:spaceId/shares", sharingHandler.CreateShare)
		auth.PATCH("/shares/:token", sharingHandler.UpdateShare)
		auth.DELETE("/shares/:token", sharingHandler.DeleteShare)
		auth.GET("/notes/:id/history", sharingHandler.NoteHistory)
		auth.GET("/notifications", sharingHandler.ListNotifications)
		auth.POST("/notifications/read", sharingHandler.ReadNotifications)
		auth.GET("/me", sharingHandler.GetMe)
		auth.PATCH("/me", sharingHandler.UpdateMe)
		auth.POST("/me/password", sharingHandler.ChangePassword)

		// notes (legacy, kept for backward compatibility during migration)
		auth.POST("/notes", notesHandler.CreateNote)
		auth.PATCH("/notes/:id/delete", notesHandler.DeleteNote)
		auth.PATCH("/notes/:id/restore", notesHandler.RestoreNote)
		auth.GET("/notes/:id", notesHandler.GetNote)
		auth.GET("/notes", notesHandler.GetNotes)
		auth.GET("/tags/autocomplete", notesHandler.GetTagAutocomplete)

		// charts
		auth.POST("/charts", chartsHandler.CreateChart)
		auth.PATCH("/charts/:id/delete", chartsHandler.DeleteChart)
		auth.PATCH("/charts/:id/restore", chartsHandler.RestoreChart)
		auth.PATCH("/charts/:id", chartsHandler.UpdateChart)
		auth.GET("/charts", chartsHandler.GetCharts)
		auth.GET("/chart-types", chartsHandler.GetChartTypes)
		auth.GET("/period-types", chartsHandler.GetPeriodTypes)
		auth.GET("/charts/:id/data", chartsHandler.GetChartData)

		auth.GET("/spaces/:spaceId/activity-types", activityTypesHandler.GetActivityTypesBySpace)
		auth.POST("/spaces/:spaceId/activity-types", activityTypesHandler.CreateActivityType)
		auth.PATCH("/spaces/:spaceId/activity-types/:typeId/delete", activityTypesHandler.DeleteActivityType)
		auth.PATCH("/spaces/:spaceId/activity-types/:typeId/restore", activityTypesHandler.RestoreActivityType)

		auth.POST("/activities", activitiesHandler.CreateActivity)
		auth.PATCH("/activities/:activityId/delete", activitiesHandler.DeleteActivity)
		auth.PATCH("/activities/:activityId/restore", activitiesHandler.RestoreActivity)
		auth.PATCH("/activities/:activityId", activitiesHandler.UpdateActivity)

		auth.GET("/activities", activitiesHandler.GetActivitiesAnalysis)

		auth.POST("/upload", attachmentsHandler.UploadFile)
		auth.GET("/files/:id", attachmentsHandler.GetFile)
		auth.GET("/files/:id/content", attachmentsHandler.GetFileContent)
		auth.GET("/notifications/unread", notificationsHandler.ListUnread)
		auth.POST("/notifications/mark-read", notificationsHandler.MarkRead)

		// filters
		auth.POST("/filters", filtersHandler.Create)
		auth.GET("/filters", filtersHandler.List)
		auth.PATCH("/filters/:id", filtersHandler.Update)
		auth.PATCH("/filters/:id/delete", filtersHandler.Delete)
		auth.PATCH("/filters/:id/restore", filtersHandler.Restore)

		// New sync and utility endpoints
		auth.GET("/sync", syncHandler.Pull)
		auth.POST("/sync", syncHandler.Push)
		auth.GET("/spaces/:spaceId/tags", syncHandler.GetTagsBySpace)
		auth.GET("/spaces/:spaceId/filters", syncHandler.GetFiltersBySpace)
	}

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	r.Run(":" + port)
}

func parseIntEnv(name string, def int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return def
	}
	return v
}

func parseInt64Env(name string, def int64) int64 {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		return def
	}
	return v
}
