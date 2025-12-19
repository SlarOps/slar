package main

import (
	"database/sql"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	_ "github.com/lib/pq"
	"github.com/vanchonlee/slar/internal/config"
	"github.com/vanchonlee/slar/services"
	"github.com/vanchonlee/slar/workers"
)

func main() {
	log.Println("Starting workers...")

	// Load Config
	configPath := os.Getenv("SLAR_CONFIG_PATH")


	if err := config.LoadConfig(configPath); err != nil {
		log.Fatalf("❌ Failed to load config: %v", err)
	}

	// Database connection
	if config.App.DatabaseURL == "" {
		log.Fatal("❌ DATABASE_URL environment variable (or config) is required")
	}

	pg, err := sql.Open("postgres", config.App.DatabaseURL)
	if err != nil {
		log.Fatalf("❌ Failed to connect to database: %v", err)
	}
	defer pg.Close()

	// Test database connection
	if err := pg.Ping(); err != nil {
		log.Fatalf("❌ Failed to ping database: %v", err)
	}

	// Set timezone to UTC for consistent time handling
	if _, err := pg.Exec("SET TIME ZONE 'UTC'"); err != nil {
		log.Printf("⚠️  Failed to set timezone to UTC: %v", err)
	} else {
		log.Println("✅ Set database timezone to UTC")
	}

	log.Println("✅ Connected to database successfully")

	// Initialize services
	fcmService, _ := services.NewFCMService(pg)
	incidentService := services.NewIncidentService(pg, nil, fcmService)

	// Initialize workers
	// Note: NotificationWorker no longer handles Slack (delegated to Python SlackWorker)
	notificationWorker := workers.NewNotificationWorker(pg, fcmService)

	// Set notification worker in incident service for sending notifications
	incidentService.SetNotificationWorker(notificationWorker)

	incidentWorker := workers.NewIncidentWorker(pg, incidentService, notificationWorker)
	// uptimeWorker := workers.NewUptimeWorker(pg, incidentService) // Disabled for now

	// Start workers in separate goroutines
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

	// Start uptime monitoring worker - DISABLED
	// wg.Add(1)
	// go func() {
	// 	defer wg.Done()
	// 	log.Println("Starting uptime monitoring worker...")
	// 	uptimeWorker.StartUptimeWorker()
	// }()

	// Wait for interrupt signal
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	log.Println("Workers started successfully. Press Ctrl+C to stop.")
	<-c

	log.Println("Shutting down workers...")
	// Workers will stop when main goroutine exits
	// In a production system, you might want to implement graceful shutdown
}
