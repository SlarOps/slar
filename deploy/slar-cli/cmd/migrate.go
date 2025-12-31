package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/spf13/cobra"
)

var (
	directDB       bool
	migrationsPath string
	dryRun         bool
)

var migrateCmd = &cobra.Command{
	Use:   "migrate",
	Short: "Run database migrations",
	Long: `Run database migrations using Supabase CLI or direct psql.

Environment Variables Required:
  DATABASE_URL    - PostgreSQL connection string
  SUPABASE_URL    - Supabase project URL (optional with --direct)

Examples:
  slar migrate                           # Auto-detect and run migrations
  slar migrate --direct                  # Use direct psql (skip Supabase CLI)
  slar migrate --path=./custom/migrations  # Custom migrations path
  slar migrate --dry-run                 # List migrations without applying`,
	Run: func(cmd *cobra.Command, args []string) {
		runMigrate()
	},
}

func init() {
	rootCmd.AddCommand(migrateCmd)

	migrateCmd.Flags().BoolVar(&directDB, "direct", false, "Use direct psql instead of Supabase CLI")
	migrateCmd.Flags().StringVar(&migrationsPath, "path", "", "Path to migrations directory (default: supabase/migrations)")
	migrateCmd.Flags().BoolVar(&dryRun, "dry-run", false, "List migrations without applying them")
}

func runMigrate() {
	printBanner("SLAR Database Migration Runner")

	// Validate environment variables
	databaseURL := os.Getenv("DATABASE_URL")
	supabaseURL := os.Getenv("SUPABASE_URL")

	if databaseURL == "" {
		migrateError("DATABASE_URL environment variable is required")
	}

	if !directDB && supabaseURL == "" {
		migrateError("SUPABASE_URL environment variable is required (use --direct to skip)")
	}

	migrateLog("[OK] Environment variables validated")

	// Determine migrations path
	migrationDir := migrationsPath
	if migrationDir == "" {
		// Default: look for supabase/migrations relative to project root
		migrationDir = findMigrationsDir()
	}

	if migrationDir == "" {
		migrateError("Could not find migrations directory. Use --path to specify.")
	}

	migrateLog(fmt.Sprintf("[OK] Migrations directory: %s", migrationDir))

	// Find migration files
	migrationFiles, err := findMigrationFiles(migrationDir)
	if err != nil {
		migrateError(fmt.Sprintf("Failed to find migration files: %v", err))
	}

	if len(migrationFiles) == 0 {
		migrateLog("WARNING: No migration files found, skipping migration")
		return
	}

	migrateLog(fmt.Sprintf("Found %d migration files", len(migrationFiles)))
	migrateLog("")
	migrateLog("Migration files:")
	for _, f := range migrationFiles {
		migrateLog(fmt.Sprintf("  - %s", filepath.Base(f)))
	}

	if dryRun {
		migrateLog("")
		migrateLog("[DRY-RUN] No changes applied")
		return
	}

	migrateLog("")
	migrateLog("Starting database migration...")
	printSeparator()

	// Determine whether to use direct DB or Supabase CLI
	useDirectDB := directDB
	if !useDirectDB && supabaseURL != "" {
		projectRef := extractProjectRef(supabaseURL)
		if projectRef == "" {
			migrateLog("WARNING: Could not extract project reference from SUPABASE_URL")
			migrateLog(fmt.Sprintf("SUPABASE_URL: %s", supabaseURL))
			migrateLog("Falling back to direct database connection")
			useDirectDB = true
		} else {
			migrateLog(fmt.Sprintf("[OK] Project reference: %s", projectRef))

			// Try Supabase CLI first
			if trySupabaseMigration(projectRef, databaseURL, migrationDir) {
				printSeparator()
				migrateLog("[OK] Database migrations completed successfully")
				printBanner("Migration Complete")
				return
			}

			migrateLog("WARNING: Supabase CLI migration failed, falling back to direct psql")
			useDirectDB = true
		}
	}

	if useDirectDB {
		migrateLog("Using direct database connection")
		applyMigrationsDirectly(databaseURL, migrationFiles)
	}

	printSeparator()
	migrateLog("[OK] Database migrations completed successfully")
	printBanner("Migration Complete")
}

func findMigrationsDir() string {
	// Try common locations relative to current directory
	possiblePaths := []string{
		"supabase/migrations",
		"../../supabase/migrations",
		"../../../supabase/migrations",
	}

	for _, p := range possiblePaths {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			absPath, _ := filepath.Abs(p)
			return absPath
		}
	}

	return ""
}

func findMigrationFiles(dir string) ([]string, error) {
	var files []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(path, ".sql") {
			files = append(files, path)
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	// Sort files to ensure consistent order
	sort.Strings(files)
	return files, nil
}

func extractProjectRef(supabaseURL string) string {
	// Format: https://xxx.supabase.co -> xxx
	re := regexp.MustCompile(`https://([^.]+)\.supabase\.co`)
	matches := re.FindStringSubmatch(supabaseURL)
	if len(matches) >= 2 {
		return matches[1]
	}
	return ""
}

func trySupabaseMigration(projectRef, databaseURL, migrationDir string) bool {
	migrateLog("Using Supabase CLI")

	// Get the directory containing supabase folder
	supabaseParentDir := filepath.Dir(filepath.Dir(migrationDir))

	// Try to link to project
	migrateLog("Linking to Supabase project...")
	linkCmd := exec.Command("supabase", "link", "--project-ref", projectRef)
	linkCmd.Dir = supabaseParentDir
	linkCmd.Stdout = os.Stdout
	linkCmd.Stderr = os.Stderr

	if err := linkCmd.Run(); err != nil {
		migrateLog(fmt.Sprintf("WARNING: Could not link to Supabase project: %v", err))
		return false
	}

	// Push migrations
	migrateLog("Pushing migrations...")
	pushCmd := exec.Command("supabase", "db", "push", "--db-url", databaseURL)
	pushCmd.Dir = supabaseParentDir
	pushCmd.Stdout = os.Stdout
	pushCmd.Stderr = os.Stderr

	if err := pushCmd.Run(); err != nil {
		migrateLog(fmt.Sprintf("WARNING: Failed to push migrations: %v", err))
		return false
	}

	return true
}

func applyMigrationsDirectly(databaseURL string, migrationFiles []string) {
	migrateLog("Applying migrations directly via psql...")

	for _, migrationFile := range migrationFiles {
		migrateLog(fmt.Sprintf("Applying: %s", filepath.Base(migrationFile)))

		cmd := exec.Command("psql", databaseURL, "-f", migrationFile)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr

		if err := cmd.Run(); err != nil {
			migrateError(fmt.Sprintf("Failed to apply migration: %s - %v", filepath.Base(migrationFile), err))
		}
	}
}

func printBanner(msg string) {
	line := strings.Repeat("=", 41)
	fmt.Println(line)
	fmt.Println(msg)
	fmt.Println(line)
}

func printSeparator() {
	fmt.Println(strings.Repeat("-", 40))
}

func migrateLog(msg string) {
	fmt.Println(msg)
}

func migrateError(msg string) {
	fmt.Fprintf(os.Stderr, "ERROR: %s\n", msg)
	os.Exit(1)
}
