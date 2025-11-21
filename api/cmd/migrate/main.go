package main

import (
	"database/sql"
	"log"
	"os"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

func main() {
	// Load .env file
	if err := godotenv.Load("../../.env"); err != nil {
		log.Println("No .env file found, checking current dir")
		if err := godotenv.Load(".env"); err != nil {
			log.Println("No .env file found")
		}
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping DB: %v", err)
	}

	// Read migration file
	// Assuming running from api/cmd/migrate
	migrationPath := "../../migrations/create_monitors_tables.sql"
	content, err := os.ReadFile(migrationPath)
	if err != nil {
		// Try absolute path if relative fails (or adjust based on where we run it)
		// Let's try to find it relative to where we are
		cwd, _ := os.Getwd()
		log.Printf("Current working directory: %s", cwd)
		log.Fatalf("Failed to read migration file: %v", err)
	}

	log.Println("Running migration...")
	_, err = db.Exec(string(content))
	if err != nil {
		log.Fatalf("Migration failed: %v", err)
	}

	log.Println("Migration applied successfully!")
}
