package database

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// MigrationConfig holds configuration for the migrator
type MigrationConfig struct {
	MigrationsFS  embed.FS
	MigrationsDir string // subdirectory within the embed.FS
}

// Migrator handles database migrations
type Migrator struct {
	db     *sql.DB
	config MigrationConfig
}

// NewMigrator creates a new Migrator instance
func NewMigrator(db *sql.DB, config MigrationConfig) *Migrator {
	return &Migrator{
		db:     db,
		config: config,
	}
}

// MigrationFile represents a single migration
type MigrationFile struct {
	Version  string
	Name     string
	FilePath string
	Content  string
}

// Run executes all pending migrations
func (m *Migrator) Run() error {
	// Ensure schema_migrations table exists
	if err := m.ensureMigrationsTable(); err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	// Get list of applied migrations
	applied, err := m.getAppliedMigrations()
	if err != nil {
		return fmt.Errorf("failed to get applied migrations: %w", err)
	}

	// Get all migration files
	migrations, err := m.loadMigrations()
	if err != nil {
		return fmt.Errorf("failed to load migrations: %w", err)
	}

	// Apply pending migrations
	pendingCount := 0
	for _, migration := range migrations {
		if applied[migration.Version] {
			continue
		}

		log.Printf("[migrate] Applying migration: %s_%s", migration.Version, migration.Name)
		if err := m.applyMigration(migration); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", migration.Version, err)
		}
		pendingCount++
	}

	if pendingCount == 0 {
		log.Println("[migrate] No pending migrations")
	} else {
		log.Printf("[migrate] Applied %d migration(s)", pendingCount)
	}

	return nil
}

// MarkAllAsApplied marks all migrations as applied without executing them.
// This is useful for existing databases where migrations were applied via other means.
func (m *Migrator) MarkAllAsApplied() error {
	if err := m.ensureMigrationsTable(); err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	applied, err := m.getAppliedMigrations()
	if err != nil {
		return fmt.Errorf("failed to get applied migrations: %w", err)
	}

	migrations, err := m.loadMigrations()
	if err != nil {
		return fmt.Errorf("failed to load migrations: %w", err)
	}

	markedCount := 0
	for _, migration := range migrations {
		if applied[migration.Version] {
			continue
		}

		if _, err := m.db.Exec("INSERT INTO schema_migrations (version) VALUES ($1)", migration.Version); err != nil {
			return fmt.Errorf("failed to mark migration %s as applied: %w", migration.Version, err)
		}
		log.Printf("[migrate] Marked as applied: %s_%s", migration.Version, migration.Name)
		markedCount++
	}

	if markedCount == 0 {
		log.Println("[migrate] All migrations already marked as applied")
	} else {
		log.Printf("[migrate] Marked %d migration(s) as applied", markedCount)
	}

	return nil
}

// ensureMigrationsTable creates the schema_migrations table if it doesn't exist
func (m *Migrator) ensureMigrationsTable() error {
	query := `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`
	_, err := m.db.Exec(query)
	return err
}

// getAppliedMigrations returns a map of applied migration versions
func (m *Migrator) getAppliedMigrations() (map[string]bool, error) {
	applied := make(map[string]bool)

	rows, err := m.db.Query("SELECT version FROM schema_migrations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		applied[version] = true
	}

	return applied, rows.Err()
}

// loadMigrations reads all migration files from the embedded filesystem
func (m *Migrator) loadMigrations() ([]MigrationFile, error) {
	var migrations []MigrationFile

	// Pattern: {timestamp}_{name}.sql (e.g., 20251106100000_create_table.sql)
	pattern := regexp.MustCompile(`^(\d+)_(.+)\.sql$`)

	err := fs.WalkDir(m.config.MigrationsFS, m.config.MigrationsDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() {
			return nil
		}

		filename := filepath.Base(path)
		matches := pattern.FindStringSubmatch(filename)
		if matches == nil {
			return nil // Skip non-migration files
		}

		content, err := m.config.MigrationsFS.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read migration %s: %w", path, err)
		}

		migrations = append(migrations, MigrationFile{
			Version:  matches[1],
			Name:     strings.TrimSuffix(matches[2], ".sql"),
			FilePath: path,
			Content:  string(content),
		})

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Sort by version (timestamp)
	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})

	return migrations, nil
}

// applyMigration executes a single migration within a transaction
func (m *Migrator) applyMigration(migration MigrationFile) error {
	tx, err := m.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Execute migration SQL
	if _, err := tx.Exec(migration.Content); err != nil {
		return fmt.Errorf("failed to execute migration SQL: %w", err)
	}

	// Record migration as applied
	if _, err := tx.Exec("INSERT INTO schema_migrations (version) VALUES ($1)", migration.Version); err != nil {
		return fmt.Errorf("failed to record migration: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetStatus returns the status of all migrations
func (m *Migrator) GetStatus() ([]MigrationStatus, error) {
	applied, err := m.getAppliedMigrations()
	if err != nil {
		return nil, err
	}

	migrations, err := m.loadMigrations()
	if err != nil {
		return nil, err
	}

	var statuses []MigrationStatus
	for _, migration := range migrations {
		statuses = append(statuses, MigrationStatus{
			Version: migration.Version,
			Name:    migration.Name,
			Applied: applied[migration.Version],
		})
	}

	return statuses, nil
}

// MigrationStatus represents the status of a single migration
type MigrationStatus struct {
	Version string
	Name    string
	Applied bool
}
