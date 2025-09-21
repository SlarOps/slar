package services

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"

	"github.com/vanchonlee/slar/db"
)

type APIKeyService struct {
	DB *sql.DB
}

func NewAPIKeyService(database *sql.DB) *APIKeyService {
	return &APIKeyService{DB: database}
}

// GenerateAPIKey creates a new API key with the specified environment
func (s *APIKeyService) GenerateAPIKey(environment string) (string, error) {
	const keyLength = 24

	// Generate random bytes
	randomBytes := make([]byte, keyLength/2) // hex encoding doubles the length
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("failed to generate random key: %w", err)
	}

	// Convert to hex and take first keyLength characters
	randomString := hex.EncodeToString(randomBytes)[:keyLength]

	return fmt.Sprintf("%s_%s", environment, randomString), nil
}

// HashAPIKey creates a bcrypt hash of the API key
func (s *APIKeyService) HashAPIKey(apiKey string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(apiKey), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash API key: %w", err)
	}
	return string(hash), nil
}

// CreateAPIKey creates a new API key for a user
func (s *APIKeyService) CreateAPIKey(userID string, req *db.CreateAPIKeyRequest) (*db.CreateAPIKeyResponse, error) {
	// Validate permissions
	if err := s.validatePermissions(req.Permissions); err != nil {
		return nil, err
	}

	// Generate API key
	apiKey, err := s.GenerateAPIKey(req.Environment)
	if err != nil {
		return nil, err
	}

	// Hash the API key
	apiKeyHash, err := s.HashAPIKey(apiKey)
	if err != nil {
		return nil, err
	}

	// Set default rate limits if not provided
	rateLimitPerHour := req.RateLimitPerHour
	if rateLimitPerHour == 0 {
		rateLimitPerHour = 1000
	}

	rateLimitPerDay := req.RateLimitPerDay
	if rateLimitPerDay == 0 {
		rateLimitPerDay = 10000
	}

	// Insert into database
	query := `
		INSERT INTO api_keys (
			user_id, name, api_key, api_key_hash, permissions, 
			description, environment, expires_at, 
			rate_limit_per_hour, rate_limit_per_day, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at
	`

	var id string
	var createdAt time.Time
	err = s.DB.QueryRow(
		query,
		userID, req.Name, apiKey, apiKeyHash, pq.Array(req.Permissions),
		req.Description, req.Environment, req.ExpiresAt,
		rateLimitPerHour, rateLimitPerDay, userID,
	).Scan(&id, &createdAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create API key: %w", err)
	}

	return &db.CreateAPIKeyResponse{
		ID:          id,
		Name:        req.Name,
		APIKey:      apiKey, // Only shown once
		Environment: req.Environment,
		Permissions: req.Permissions,
		CreatedAt:   createdAt,
		ExpiresAt:   req.ExpiresAt,
		Message:     "API key created successfully. Please save it securely as it won't be shown again.",
	}, nil
}

// GetAPIKeyByKey retrieves an API key by its key value (for authentication)
func (s *APIKeyService) GetAPIKeyByKey(apiKey string) (*db.APIKey, error) {
	query := `
		SELECT id, user_id, name, api_key_hash, permissions, is_active,
			   last_used_at, created_at, updated_at, expires_at,
			   rate_limit_per_hour, rate_limit_per_day, total_requests,
			   total_alerts_created, description, environment, created_by
		FROM api_keys 
		WHERE api_key = $1
	`

	var key db.APIKey
	var permissions pq.StringArray
	var lastUsedAt, expiresAt sql.NullTime
	var createdBy sql.NullString

	err := s.DB.QueryRow(query, apiKey).Scan(
		&key.ID, &key.UserID, &key.Name, &key.APIKeyHash, &permissions,
		&key.IsActive, &lastUsedAt, &key.CreatedAt, &key.UpdatedAt,
		&expiresAt, &key.RateLimitPerHour, &key.RateLimitPerDay,
		&key.TotalRequests, &key.TotalAlertsCreated, &key.Description,
		&key.Environment, &createdBy,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("API key not found")
		}
		return nil, fmt.Errorf("failed to get API key: %w", err)
	}

	// Convert nullable fields
	if lastUsedAt.Valid {
		key.LastUsedAt = &lastUsedAt.Time
	}
	if expiresAt.Valid {
		key.ExpiresAt = &expiresAt.Time
	}
	if createdBy.Valid {
		key.CreatedBy = createdBy.String
	}

	key.Permissions = []string(permissions)

	// Verify the API key hash
	if err := bcrypt.CompareHashAndPassword([]byte(key.APIKeyHash), []byte(apiKey)); err != nil {
		return nil, errors.New("invalid API key")
	}

	return &key, nil
}

// ValidateAPIKey validates an API key and checks all constraints
func (s *APIKeyService) ValidateAPIKey(apiKey string) (*db.APIKey, error) {
	key, err := s.GetAPIKeyByKey(apiKey)
	if err != nil {
		return nil, err
	}

	// Check if active
	if !key.IsActive {
		return nil, errors.New("API key is disabled")
	}

	// Check expiration
	if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
		return nil, errors.New("API key has expired")
	}

	return key, nil
}

// HasPermission checks if an API key has a specific permission
func (s *APIKeyService) HasPermission(key *db.APIKey, permission db.Permission) bool {
	for _, p := range key.Permissions {
		if p == string(permission) {
			return true
		}
	}
	return false
}

// CheckRateLimit checks if the API key has exceeded its rate limits
func (s *APIKeyService) CheckRateLimit(apiKeyID string, key *db.APIKey) error {
	now := time.Now()

	// Check hourly limit
	hourStart := now.Truncate(time.Hour)
	hourlyCount, err := s.getRateLimitCount(apiKeyID, hourStart, db.WindowTypeHour)
	if err != nil {
		log.Printf("Error checking hourly rate limit: %v", err)
		// Don't fail the request due to rate limit check error
	} else if hourlyCount >= key.RateLimitPerHour {
		return fmt.Errorf("hourly rate limit of %d requests exceeded", key.RateLimitPerHour)
	}

	// Check daily limit
	dayStart := now.Truncate(24 * time.Hour)
	dailyCount, err := s.getRateLimitCount(apiKeyID, dayStart, db.WindowTypeDay)
	if err != nil {
		log.Printf("Error checking daily rate limit: %v", err)
		// Don't fail the request due to rate limit check error
	} else if dailyCount >= key.RateLimitPerDay {
		return fmt.Errorf("daily rate limit of %d requests exceeded", key.RateLimitPerDay)
	}

	return nil
}

// IncrementRateLimit increments the rate limit counters
func (s *APIKeyService) IncrementRateLimit(apiKeyID string) error {
	now := time.Now()

	// Increment hourly counter
	hourStart := now.Truncate(time.Hour)
	if err := s.incrementRateLimitCounter(apiKeyID, hourStart, db.WindowTypeHour); err != nil {
		log.Printf("Error incrementing hourly rate limit: %v", err)
	}

	// Increment daily counter
	dayStart := now.Truncate(24 * time.Hour)
	if err := s.incrementRateLimitCounter(apiKeyID, dayStart, db.WindowTypeDay); err != nil {
		log.Printf("Error incrementing daily rate limit: %v", err)
	}

	return nil
}

// UpdateLastUsed updates the last used timestamp and total requests
func (s *APIKeyService) UpdateLastUsed(apiKeyID string) error {
	query := `
		UPDATE api_keys 
		SET last_used_at = NOW(), total_requests = total_requests + 1
		WHERE id = $1
	`
	_, err := s.DB.Exec(query, apiKeyID)
	if err != nil {
		return fmt.Errorf("failed to update last used: %w", err)
	}
	return nil
}

// LogUsage logs API key usage
func (s *APIKeyService) LogUsage(log *db.APIKeyUsageLog) error {
	query := `
		INSERT INTO api_key_usage_logs (
			api_key_id, endpoint, method, ip_address, user_agent,
			request_size, response_status, response_time_ms,
			alert_id, alert_title, alert_severity, request_id, error_message
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`

	_, err := s.DB.Exec(
		query,
		log.APIKeyID, log.Endpoint, log.Method, log.IPAddress, log.UserAgent,
		log.RequestSize, log.ResponseStatus, log.ResponseTimeMs,
		log.AlertID, log.AlertTitle, log.AlertSeverity, log.RequestID, log.ErrorMessage,
	)

	if err != nil {
		return fmt.Errorf("failed to log usage: %w", err)
	}

	return nil
}

// ListAPIKeys lists API keys for a user
func (s *APIKeyService) ListAPIKeys(userID string) ([]db.APIKey, error) {
	query := `
		SELECT id, user_id, name, permissions, is_active,
			   last_used_at, created_at, updated_at, expires_at,
			   rate_limit_per_hour, rate_limit_per_day, total_requests,
			   total_alerts_created, description, environment, created_by
		FROM api_keys 
		WHERE user_id = $1
		ORDER BY created_at DESC
	`

	rows, err := s.DB.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list API keys: %w", err)
	}
	defer rows.Close()

	var keys []db.APIKey
	for rows.Next() {
		var key db.APIKey
		var permissions pq.StringArray
		var lastUsedAt, expiresAt sql.NullTime
		var createdBy sql.NullString

		err := rows.Scan(
			&key.ID, &key.UserID, &key.Name, &permissions, &key.IsActive,
			&lastUsedAt, &key.CreatedAt, &key.UpdatedAt, &expiresAt,
			&key.RateLimitPerHour, &key.RateLimitPerDay, &key.TotalRequests,
			&key.TotalAlertsCreated, &key.Description, &key.Environment, &createdBy,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan API key: %w", err)
		}

		// Convert nullable fields
		if lastUsedAt.Valid {
			key.LastUsedAt = &lastUsedAt.Time
		}
		if expiresAt.Valid {
			key.ExpiresAt = &expiresAt.Time
		}
		if createdBy.Valid {
			key.CreatedBy = createdBy.String
		}

		key.Permissions = []string(permissions)
		keys = append(keys, key)
	}

	return keys, nil
}

// GetAPIKey gets a specific API key by ID (for management)
func (s *APIKeyService) GetAPIKey(keyID, userID string) (*db.APIKey, error) {
	query := `
		SELECT id, user_id, name, permissions, is_active,
			   last_used_at, created_at, updated_at, expires_at,
			   rate_limit_per_hour, rate_limit_per_day, total_requests,
			   total_alerts_created, description, environment, created_by
		FROM api_keys 
		WHERE id = $1 AND user_id = $2
	`

	var key db.APIKey
	var permissions pq.StringArray
	var lastUsedAt, expiresAt sql.NullTime
	var createdBy sql.NullString

	err := s.DB.QueryRow(query, keyID, userID).Scan(
		&key.ID, &key.UserID, &key.Name, &permissions, &key.IsActive,
		&lastUsedAt, &key.CreatedAt, &key.UpdatedAt, &expiresAt,
		&key.RateLimitPerHour, &key.RateLimitPerDay, &key.TotalRequests,
		&key.TotalAlertsCreated, &key.Description, &key.Environment, &createdBy,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("API key not found")
		}
		return nil, fmt.Errorf("failed to get API key: %w", err)
	}

	// Convert nullable fields
	if lastUsedAt.Valid {
		key.LastUsedAt = &lastUsedAt.Time
	}
	if expiresAt.Valid {
		key.ExpiresAt = &expiresAt.Time
	}
	if createdBy.Valid {
		key.CreatedBy = createdBy.String
	}

	key.Permissions = []string(permissions)
	return &key, nil
}

// UpdateAPIKey updates an API key
func (s *APIKeyService) UpdateAPIKey(keyID, userID string, req *db.UpdateAPIKeyRequest) error {
	// Build dynamic query
	setParts := []string{}
	args := []interface{}{}
	argIndex := 1

	if req.Name != nil {
		setParts = append(setParts, fmt.Sprintf("name = $%d", argIndex))
		args = append(args, *req.Name)
		argIndex++
	}

	if req.Description != nil {
		setParts = append(setParts, fmt.Sprintf("description = $%d", argIndex))
		args = append(args, *req.Description)
		argIndex++
	}

	if req.IsActive != nil {
		setParts = append(setParts, fmt.Sprintf("is_active = $%d", argIndex))
		args = append(args, *req.IsActive)
		argIndex++
	}

	if req.Permissions != nil {
		if err := s.validatePermissions(req.Permissions); err != nil {
			return err
		}
		setParts = append(setParts, fmt.Sprintf("permissions = $%d", argIndex))
		args = append(args, pq.Array(req.Permissions))
		argIndex++
	}

	if req.ExpiresAt != nil {
		setParts = append(setParts, fmt.Sprintf("expires_at = $%d", argIndex))
		args = append(args, *req.ExpiresAt)
		argIndex++
	}

	if req.RateLimitPerHour != nil {
		setParts = append(setParts, fmt.Sprintf("rate_limit_per_hour = $%d", argIndex))
		args = append(args, *req.RateLimitPerHour)
		argIndex++
	}

	if req.RateLimitPerDay != nil {
		setParts = append(setParts, fmt.Sprintf("rate_limit_per_day = $%d", argIndex))
		args = append(args, *req.RateLimitPerDay)
		argIndex++
	}

	if len(setParts) == 0 {
		return errors.New("no fields to update")
	}

	// Add updated_at
	setParts = append(setParts, "updated_at = NOW()")

	// Add WHERE clause parameters
	args = append(args, keyID, userID)
	whereClause := fmt.Sprintf("WHERE id = $%d AND user_id = $%d", argIndex, argIndex+1)

	query := fmt.Sprintf("UPDATE api_keys SET %s %s", strings.Join(setParts, ", "), whereClause)

	result, err := s.DB.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("failed to update API key: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return errors.New("API key not found or no permission to update")
	}

	return nil
}

// DeleteAPIKey deletes an API key
func (s *APIKeyService) DeleteAPIKey(keyID, userID string) error {
	query := `DELETE FROM api_keys WHERE id = $1 AND user_id = $2`

	result, err := s.DB.Exec(query, keyID, userID)
	if err != nil {
		return fmt.Errorf("failed to delete API key: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return errors.New("API key not found or no permission to delete")
	}

	return nil
}

// RegenerateAPIKey generates a new API key for an existing key ID
func (s *APIKeyService) RegenerateAPIKey(keyID, userID string) (*db.CreateAPIKeyResponse, error) {
	// Get existing key info
	existingKey, err := s.GetAPIKey(keyID, userID)
	if err != nil {
		return nil, err
	}

	// Generate new API key
	newAPIKey, err := s.GenerateAPIKey(existingKey.Environment)
	if err != nil {
		return nil, err
	}

	// Hash the new API key
	newAPIKeyHash, err := s.HashAPIKey(newAPIKey)
	if err != nil {
		return nil, err
	}

	// Update the database
	query := `
		UPDATE api_keys 
		SET api_key = $1, api_key_hash = $2, updated_at = NOW()
		WHERE id = $3 AND user_id = $4
		RETURNING name, environment, permissions, created_at, expires_at
	`

	var name, environment string
	var permissions pq.StringArray
	var createdAt time.Time
	var expiresAt sql.NullTime

	err = s.DB.QueryRow(query, newAPIKey, newAPIKeyHash, keyID, userID).Scan(
		&name, &environment, &permissions, &createdAt, &expiresAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to regenerate API key: %w", err)
	}

	response := &db.CreateAPIKeyResponse{
		ID:          keyID,
		Name:        name,
		APIKey:      newAPIKey, // Only shown once
		Environment: environment,
		Permissions: []string(permissions),
		CreatedAt:   createdAt,
		Message:     "API key regenerated successfully. Please save it securely as it won't be shown again.",
	}

	if expiresAt.Valid {
		response.ExpiresAt = &expiresAt.Time
	}

	return response, nil
}

// GetAPIKeyStats gets statistics for API keys
func (s *APIKeyService) GetAPIKeyStats(userID string) ([]db.APIKeyStats, error) {
	query := `
		SELECT id, name, user_id, user_name, user_email, environment,
			   is_active, created_at, last_used_at, total_requests,
			   total_alerts_created, rate_limit_per_hour, rate_limit_per_day,
			   requests_last_24h, alerts_last_24h, errors_last_24h,
			   avg_response_time_ms, status
		FROM api_key_stats
		WHERE user_id = $1
		ORDER BY created_at DESC
	`

	rows, err := s.DB.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get API key stats: %w", err)
	}
	defer rows.Close()

	var stats []db.APIKeyStats
	for rows.Next() {
		var stat db.APIKeyStats
		var lastUsedAt sql.NullTime

		err := rows.Scan(
			&stat.ID, &stat.Name, &stat.UserID, &stat.UserName, &stat.UserEmail,
			&stat.Environment, &stat.IsActive, &stat.CreatedAt, &lastUsedAt,
			&stat.TotalRequests, &stat.TotalAlertsCreated, &stat.RateLimitPerHour,
			&stat.RateLimitPerDay, &stat.RequestsLast24h, &stat.AlertsLast24h,
			&stat.ErrorsLast24h, &stat.AvgResponseTimeMs, &stat.Status,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan API key stats: %w", err)
		}

		if lastUsedAt.Valid {
			stat.LastUsedAt = &lastUsedAt.Time
		}

		stats = append(stats, stat)
	}

	return stats, nil
}

// Helper methods

func (s *APIKeyService) validatePermissions(permissions []string) error {
	validPerms := make(map[string]bool)
	for _, perm := range db.ValidPermissions {
		validPerms[string(perm)] = true
	}

	for _, perm := range permissions {
		if !validPerms[perm] {
			return fmt.Errorf("invalid permission: %s", perm)
		}
	}

	return nil
}

func (s *APIKeyService) getRateLimitCount(apiKeyID string, windowStart time.Time, windowType string) (int, error) {
	query := `
		SELECT COALESCE(request_count, 0)
		FROM api_key_rate_limits
		WHERE api_key_id = $1 AND window_start = $2 AND window_type = $3
	`

	var count int
	err := s.DB.QueryRow(query, apiKeyID, windowStart, windowType).Scan(&count)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}

	return count, nil
}

func (s *APIKeyService) incrementRateLimitCounter(apiKeyID string, windowStart time.Time, windowType string) error {
	query := `
		INSERT INTO api_key_rate_limits (api_key_id, window_start, window_type, request_count)
		VALUES ($1, $2, $3, 1)
		ON CONFLICT (api_key_id, window_start, window_type)
		DO UPDATE SET request_count = api_key_rate_limits.request_count + 1, updated_at = NOW()
	`

	_, err := s.DB.Exec(query, apiKeyID, windowStart, windowType)
	return err
}
