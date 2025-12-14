package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoadConfig_EnvVars(t *testing.T) {
	// Set standard environment variables
	os.Setenv("DATABASE_URL", "postgres://test:test@localhost:5432/testdb")
	os.Setenv("PORT", "9999")
	os.Setenv("SLAR_CLOUD_URL", "https://api.slar.dev")

	// Clean up after test
	defer func() {
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("PORT")
		os.Unsetenv("SLAR_CLOUD_URL")
	}()

	// Load config (no file)
	err := LoadConfig("")
	assert.NoError(t, err)

	// Verify standard env vars are bound
	assert.Equal(t, "postgres://test:test@localhost:5432/testdb", App.DatabaseURL)
	assert.Equal(t, "9999", App.Port)
	
	// Verify mapped legacy/mapped env vars
	assert.Equal(t, "https://api.slar.dev", App.NotificationGatewayDetails.URL)
}
