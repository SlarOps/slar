package main

import (
	"database/sql"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"

	"github.com/vanchonlee/slar/internal/config"
	"github.com/vanchonlee/slar/internal/database"
	"github.com/vanchonlee/slar/router"
	"github.com/vanchonlee/slar/services"
	"github.com/vanchonlee/slar/workers"
)

func main() {
	// Load Config
	configPath := os.Getenv("SLAR_CONFIG_PATH")


	if err := config.LoadConfig(configPath); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Set Gin mode
	gin.SetMode(gin.DebugMode)

	log.Println("Starting SLAR API Server with Workers...")

	// Initialize database connection
	var db *sql.DB
	var err error

	// Database connection is required for workers
	if config.App.DatabaseURL == "" {
		log.Fatal("DATABASE_URL environment variable (or config) is required")
	}

	db, err = sql.Open("postgres", config.App.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Test database connection
	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	// Set timezone to UTC for consistent time handling
	if _, err := db.Exec("SET TIME ZONE 'UTC'"); err != nil {
		log.Printf("Failed to set timezone to UTC: %v", err)
	} else {
		log.Println("Set database timezone to UTC")
	}

	log.Println("Connected to database successfully")

	// Run database migrations
	migrator := database.NewMigrator(db, database.MigrationConfig{
		MigrationsFS:  database.MigrationsFS,
		MigrationsDir: database.MigrationsDir,
	})

	if config.App.MigrateBaseline {
		// Baseline mode: mark all migrations as applied without running them
		// Use this for existing databases that already have the schema
		log.Println("Running migration baseline (marking all as applied)...")
		if err := migrator.MarkAllAsApplied(); err != nil {
			log.Fatalf("Failed to baseline migrations: %v", err)
		}
	} else if config.App.AutoMigrate {
		log.Println("Running database migrations...")
		if err := migrator.Run(); err != nil {
			log.Fatalf("Failed to run migrations: %v", err)
		}
	} else {
		log.Println("Auto-migration disabled (set AUTO_MIGRATE=true to enable)")
	}

	// Initialize router
	r := router.NewGinRouter(db)

	// Initialize services for workers
	fcmService, _ := services.NewFCMService(db)
	incidentService := services.NewIncidentService(db, fcmService)

	// Initialize workers
	notificationWorker := workers.NewNotificationWorker(db, fcmService)
	incidentService.SetNotificationWorker(notificationWorker)
	incidentWorker := workers.NewIncidentWorker(db, incidentService, notificationWorker)

	// Start workers in background goroutines
	var wg sync.WaitGroup

	// Start notification worker
	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Println("Starting notification worker...")
		notificationWorker.StartNotificationWorker()
	}()

	// Start incident escalation worker
	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Println("Starting incident escalation worker...")
		incidentWorker.StartIncidentWorker()
	}()

	log.Println("Workers started successfully")

	// Start server in a goroutine
	port := config.App.Port

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("SLAR API Server ready on port %s", port)
		log.Printf("Endpoints:")
		log.Printf("   • Health:         GET  http://localhost:%s/health", port)
		log.Printf("   • Dashboard:      GET  http://localhost:%s/dashboard (🔒 Auth required)", port)
		log.Printf("   • API Keys:       GET  http://localhost:%s/api-keys (🔒 Auth required)", port)
		log.Printf("   • Alerts:         GET  http://localhost:%s/alerts (🔒 Auth required)", port)
		log.Printf("   • Users:          GET  http://localhost:%s/users (🔒 Auth required)", port)
		log.Printf("   • Uptime:         GET  http://localhost:%s/uptime (🔒 Auth required)", port)
		log.Printf("   • Webhooks:       POST http://localhost:%s/webhooks/alertmanager (Public)", port)
		log.Printf("")
		log.Printf("Authentication: Supabase JWT tokens required for protected endpoints")
		log.Printf("")

		if err := r.Run(":" + port); err != nil {
			serverErrors <- err
		}
	}()

	// Wait for interrupt signal or server error
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	select {
	case sig := <-shutdown:
		log.Printf("Received signal: %v. Shutting down gracefully...", sig)
	case err := <-serverErrors:
		log.Printf("Server error: %v", err)
	}

	log.Println("Shutdown complete")
}
