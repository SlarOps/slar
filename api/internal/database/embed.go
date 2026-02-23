package database

import "embed"

// MigrationsFS contains embedded migration files from supabase/migrations
// The path is relative to the module root (api/)
//
//go:embed migrations/*.sql
var MigrationsFS embed.FS

// MigrationsDir is the directory within MigrationsFS containing migration files
const MigrationsDir = "migrations"
