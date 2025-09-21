package main

import (
	"database/sql"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"

	"github.com/vanchonlee/slar/router"
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

	log.Println("🚀 Starting SLAR API Server...")

	// Initialize database connection (mock for now)
	var db *sql.DB
	var err error

	// Try to connect to database if URL is provided
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		db, err = sql.Open("postgres", dbURL)
		if err != nil {
			log.Printf("⚠️  Failed to connect to database: %v", err)
		} else {
			log.Println("✅ Connected to database successfully")
		}
	} else {
		log.Println("ℹ️  No DATABASE_URL provided, running without database")
	}

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

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

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
		log.Fatal("💥 Failed to start server: ", err)
	}
}
