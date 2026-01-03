package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

// Config holds all application configuration
type Config struct {
	DatabaseURL       string `mapstructure:"database_url"`
	RedisURL          string `mapstructure:"redis_url"`
	Port              string `mapstructure:"port"`
	SlarAPIURL        string `mapstructure:"slar_api_url"`
	SlarWebURL        string `mapstructure:"slar_web_url"`
	PublicURL         string `mapstructure:"public_url"`
	AgentURL          string `mapstructure:"agent_url"`
	BackendURL        string `mapstructure:"backend_url"`
	WebhookAPIBaseURL string `mapstructure:"webhook_api_base_url"`

	// Data storage
	DataDir string `mapstructure:"data_dir"`

	// Supabase
	SupabaseURL            string `mapstructure:"supabase_url"`
	MobileSupabaseURL      string `mapstructure:"mobile_supabase_url"`
	SupabaseAnonKey        string `mapstructure:"supabase_anon_key"`
	SupabaseServiceRoleKey string `mapstructure:"supabase_service_role_key"`
	SupabaseJWTSecret      string `mapstructure:"supabase_jwt_secret"`

	// Notification Gateway
	NotificationGatewayDetails NotificationGatewayConfig `mapstructure:"notification_gateway"`

	// External Services
	AnthropicAPIKey string `mapstructure:"anthropic_api_key"`
	SlackBotToken   string `mapstructure:"slack_bot_token"`
	SlackAppToken   string `mapstructure:"slack_app_token"`
}

type NotificationGatewayConfig struct {
	URL        string `mapstructure:"url"`
	InstanceID string `mapstructure:"instance_id"`
	APIToken   string `mapstructure:"api_token"`
}

// App holds the global config instance
var App Config

// LoadConfig loads configuration from file and environment variables
func LoadConfig(path string) error {
	// Auto-load .env file if present (Local Development Convenience)
	// This makes 'go run' work without manually exporting env vars
	if err := godotenv.Load(); err != nil {
		// Ignore error if .env doesn't exist (e.g. in Production/Docker)
		// But if it fails for other reasons, it's fine, we continue
	} else {
		log.Println("✅ Loaded .env file")
	}

	v := viper.New()

	// Set default values
	v.SetDefault("port", "8080")

	// Config file settings
	if path != "" {
		v.SetConfigFile(path)
	} else {
		// Try to find config file in multiple locations
		v.AddConfigPath("./config")     // api/config/
		v.AddConfigPath("./cmd/server") // api/cmd/server/ (legacy)
		v.AddConfigPath(".")            // current directory
		v.SetConfigName("dev.config")   // Look for dev.config.yaml
		v.SetConfigType("yaml")
	}

	// Environment variable settings
	v.SetEnvPrefix("SLAR") // Legacy support
	v.SetDefault("backend_url", "http://localhost:8080")
	v.SetDefault("data_dir", "./data")

	// Bind standard environment variables (Docker/deploy compatibility)
	// This allows using standard keys like DATABASE_URL instead of SLAR_DATABASE_URL
	v.BindEnv("database_url", "DATABASE_URL")
	v.BindEnv("redis_url", "REDIS_URL")
	v.BindEnv("port", "PORT")

	// Bind Supabase Env Vars
	v.BindEnv("supabase_url", "SUPABASE_URL")
	v.BindEnv("mobile_supabase_url", "MOBILE_SUPABASE_URL")
	v.BindEnv("supabase_anon_key", "SUPABASE_ANON_KEY")
	v.BindEnv("supabase_service_role_key", "SUPABASE_SERVICE_ROLE_KEY")
	v.BindEnv("supabase_jwt_secret", "SUPABASE_JWT_SECRET")

	// Bind External Services Env Vars
	v.BindEnv("anthropic_api_key", "ANTHROPIC_API_KEY")
	v.BindEnv("slack_bot_token", "SLACK_BOT_TOKEN")
	v.BindEnv("slack_app_token", "SLACK_APP_TOKEN")

	// Bind Notification Gateway Env Vars
	v.BindEnv("notification_gateway.url", "SLAR_CLOUD_URL")
	v.BindEnv("notification_gateway.api_token", "SLAR_CLOUD_TOKEN")
	v.BindEnv("notification_gateway.instance_id", "SLAR_INSTANCE_ID")
	v.BindEnv("webhook_api_base_url", "WEBHOOK_API_BASE_URL")

	v.AutomaticEnv()

	// 1. Read config file
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			log.Println("ℹ️  No config file found, using defaults and environment variables")
		} else {
			return err
		}
	} else {
		log.Printf("✅ Loaded config from: %s", v.ConfigFileUsed())
	}

	// 2. Unmarshal into struct
	if err := v.Unmarshal(&App); err != nil {
		return err
	}

	// 3. Backfill environment variables for legacy code compatibility
	// Many existing services (FCM, Router, etc.) still use os.Getenv()
	// This ensures they work without refactoring the entire codebase immediately.
	setEnvIfEmpty("DATABASE_URL", App.DatabaseURL)
	setEnvIfEmpty("REDIS_URL", App.RedisURL)
	setEnvIfEmpty("PORT", App.Port)

	setEnvIfEmpty("SUPABASE_URL", App.SupabaseURL)
	setEnvIfEmpty("MOBILE_SUPABASE_URL", App.MobileSupabaseURL)
	setEnvIfEmpty("AGENT_URL", App.AgentURL)
	setEnvIfEmpty("SUPABASE_ANON_KEY", App.SupabaseAnonKey)
	setEnvIfEmpty("SUPABASE_SERVICE_ROLE_KEY", App.SupabaseServiceRoleKey)
	setEnvIfEmpty("SUPABASE_JWT_SECRET", App.SupabaseJWTSecret)

	setEnvIfEmpty("SLAR_CLOUD_URL", App.NotificationGatewayDetails.URL)
	setEnvIfEmpty("SLAR_INSTANCE_ID", App.NotificationGatewayDetails.InstanceID)
	setEnvIfEmpty("SLAR_CLOUD_TOKEN", App.NotificationGatewayDetails.APIToken)

	setEnvIfEmpty("ANTHROPIC_API_KEY", App.AnthropicAPIKey)
	setEnvIfEmpty("SLACK_BOT_TOKEN", App.SlackBotToken)
	setEnvIfEmpty("SLACK_APP_TOKEN", App.SlackAppToken)

	setEnvIfEmpty("SLAR_PUBLIC_URL", App.PublicURL)
	setEnvIfEmpty("SLAR_AGENT_URL", App.AgentURL)
	setEnvIfEmpty("SLAR_BACKEND_URL", App.BackendURL)
	setEnvIfEmpty("WEBHOOK_API_BASE_URL", App.WebhookAPIBaseURL)
	setEnvIfEmpty("SLAR_DATA_DIR", App.DataDir)

	return nil
}

func setEnvIfEmpty(key, value string) {
	if value != "" && os.Getenv(key) == "" {
		os.Setenv(key, value)
	}
}
