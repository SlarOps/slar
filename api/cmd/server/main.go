package main

import (
	"database/sql"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"

	"github.com/vanchonlee/slar/router"
	"github.com/vanchonlee/slar/services"
	"github.com/vanchonlee/slar/workers"
)

func main() {
	// Load .env file if it exists
	if err := godotenv.Load(); err != nil {
		log.Println("ℹ️  No .env file found, using system environment variables")
	} else {
		log.Println("✅ Loaded .env file successfully")
	}

	// Set Gin mode to debug to see more logs
	gin.SetMode(gin.DebugMode)

	log.Println("🚀 Starting SLAR API Server with Workers...")

	// Initialize database connection
	var db *sql.DB
	var err error

	// Database connection is required for workers
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("❌ DATABASE_URL environment variable is required")
	}

	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("❌ Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Test database connection
	if err := db.Ping(); err != nil {
		log.Fatalf("❌ Failed to ping database: %v", err)
	}

	// Set timezone to UTC for consistent time handling
	if _, err := db.Exec("SET TIME ZONE 'UTC'"); err != nil {
		log.Printf("⚠️  Failed to set timezone to UTC: %v", err)
	} else {
		log.Println("✅ Set database timezone to UTC")
	}

	log.Println("✅ Connected to database successfully")

	// Initialize Redis connection (optional)
	var redisClient *redis.Client
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			log.Printf("⚠️  Failed to parse Redis URL: %v", err)
		} else {
			redisClient = redis.NewClient(opt)
			// Test the connection
			if _, err := redisClient.Ping(redisClient.Context()).Result(); err != nil {
				log.Printf("⚠️  Redis connection failed: %v", err)
				redisClient = nil
			} else {
				log.Println("✅ Connected to Redis successfully")
			}
		}
	} else {
		// Try to connect to local Redis (optional)
		testClient := redis.NewClient(&redis.Options{
			Addr: "localhost:6379",
		})
		if _, err := testClient.Ping(testClient.Context()).Result(); err != nil {
			log.Printf("ℹ️  Redis not available (localhost:6379): %v", err)
			log.Println("ℹ️  Running without Redis - some features may be disabled")
		} else {
			redisClient = testClient
			log.Println("✅ Connected to local Redis successfully")
		}
	}

	// Initialize router
	r := router.NewGinRouter(db, redisClient)

	// Initialize services for workers
	fcmService, _ := services.NewFCMService(db)
	incidentService := services.NewIncidentService(db, redisClient, fcmService)

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
		log.Println("🔔 Starting notification worker...")
		notificationWorker.StartNotificationWorker()
	}()

	// Start incident escalation worker
	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Println("🚨 Starting incident escalation worker...")
		incidentWorker.StartIncidentWorker()
	}()

	log.Println("✅ Workers started successfully")

	// Start server in a goroutine
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("🌐 SLAR API Server ready on port %s", port)
		log.Printf("📋 Endpoints:")
		log.Printf("   • Health:         GET  http://localhost:%s/health", port)
		log.Printf("   • Dashboard:      GET  http://localhost:%s/dashboard (🔒 Auth required)", port)
		log.Printf("   • API Keys:       GET  http://localhost:%s/api-keys (🔒 Auth required)", port)
		log.Printf("   • Alerts:         GET  http://localhost:%s/alerts (🔒 Auth required)", port)
		log.Printf("   • Users:          GET  http://localhost:%s/users (🔒 Auth required)", port)
		log.Printf("   • Uptime:         GET  http://localhost:%s/uptime (🔒 Auth required)", port)
		log.Printf("   • Webhooks:       POST http://localhost:%s/webhooks/alertmanager (Public)", port)
		log.Printf("")
		log.Printf("🔐 Authentication: Supabase JWT tokens required for protected endpoints")
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
		log.Printf("\n🛑 Received signal: %v. Shutting down gracefully...", sig)
	case err := <-serverErrors:
		log.Printf("💥 Server error: %v", err)
	}

	log.Println("👋 Shutdown complete")
}
