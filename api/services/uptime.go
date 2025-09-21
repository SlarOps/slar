package services

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type UptimeService struct {
	PG    *sql.DB
	Redis *redis.Client
}

func NewUptimeService(pg *sql.DB, redis *redis.Client) *UptimeService {
	return &UptimeService{PG: pg, Redis: redis}
}

// Service Management
func (s *UptimeService) ListServices() ([]db.UptimeService, error) {
	rows, err := s.PG.Query(`
		SELECT id, name, url, type, method, interval_seconds, timeout_seconds, 
		       is_active, is_enabled, created_at, updated_at, expected_status, 
		       COALESCE(expected_body, ''), COALESCE(headers::text, '{}')
		FROM uptime_services 
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var services []db.UptimeService
	for rows.Next() {
		var service db.UptimeService
		var headersJSON string
		err := rows.Scan(
			&service.ID, &service.Name, &service.URL, &service.Type, &service.Method,
			&service.Interval, &service.Timeout, &service.IsActive, &service.IsEnabled,
			&service.CreatedAt, &service.UpdatedAt, &service.ExpectedStatus,
			&service.ExpectedBody, &headersJSON,
		)
		if err != nil {
			continue
		}

		// Parse headers JSON
		if headersJSON != "" && headersJSON != "{}" {
			json.Unmarshal([]byte(headersJSON), &service.Headers)
		}

		services = append(services, service)
	}
	return services, nil
}

func (s *UptimeService) GetService(id string) (db.UptimeService, error) {
	var service db.UptimeService
	var headersJSON string

	err := s.PG.QueryRow(`
		SELECT id, name, url, type, method, interval_seconds, timeout_seconds, 
		       is_active, is_enabled, created_at, updated_at, expected_status, 
		       COALESCE(expected_body, ''), COALESCE(headers::text, '{}')
		FROM uptime_services WHERE id = $1
	`, id).Scan(
		&service.ID, &service.Name, &service.URL, &service.Type, &service.Method,
		&service.Interval, &service.Timeout, &service.IsActive, &service.IsEnabled,
		&service.CreatedAt, &service.UpdatedAt, &service.ExpectedStatus,
		&service.ExpectedBody, &headersJSON,
	)

	if err != nil {
		return service, err
	}

	// Parse headers JSON
	if headersJSON != "" && headersJSON != "{}" {
		json.Unmarshal([]byte(headersJSON), &service.Headers)
	}

	return service, nil
}

func (s *UptimeService) CreateService(c *gin.Context) (db.UptimeService, error) {
	var service db.UptimeService
	if err := c.ShouldBindJSON(&service); err != nil {
		return service, err
	}

	service.ID = uuid.New().String()
	service.CreatedAt = time.Now()
	service.UpdatedAt = time.Now()
	service.IsActive = true
	service.IsEnabled = true

	// Set defaults
	if service.Type == "" {
		service.Type = "http"
	}
	if service.Method == "" {
		service.Method = "GET"
	}
	if service.Interval == 0 {
		service.Interval = 300 // 5 minutes
	}
	if service.Timeout == 0 {
		service.Timeout = 30
	}
	if service.ExpectedStatus == 0 {
		service.ExpectedStatus = 200
	}

	// Convert headers to JSON
	headersJSON := "{}"
	if service.Headers != nil {
		if b, err := json.Marshal(service.Headers); err == nil {
			headersJSON = string(b)
		}
	}

	_, err := s.PG.Exec(`
		INSERT INTO uptime_services (id, name, url, type, method, interval_seconds, timeout_seconds, 
		                     is_active, is_enabled, created_at, updated_at, expected_status, 
		                     expected_body, headers)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`, service.ID, service.Name, service.URL, service.Type, service.Method,
		service.Interval, service.Timeout, service.IsActive, service.IsEnabled,
		service.CreatedAt, service.UpdatedAt, service.ExpectedStatus,
		service.ExpectedBody, headersJSON)

	if err != nil {
		return service, err
	}

	// Initialize stats for new service
	s.initializeStatsForService(service.ID)

	return service, nil
}

// Service Checking Logic
func (s *UptimeService) CheckService(serviceID string) (db.ServiceCheck, error) {
	service, err := s.GetService(serviceID)
	if err != nil {
		return db.ServiceCheck{}, err
	}

	check := db.ServiceCheck{
		ID:        uuid.New().String(),
		ServiceID: serviceID,
		CheckedAt: time.Now(),
	}

	// Perform the actual check based on service type
	switch strings.ToLower(service.Type) {
	case "http", "https":
		s.performHTTPCheck(&service, &check)
	case "tcp":
		s.performTCPCheck(&service, &check)
	case "ping":
		s.performPingCheck(&service, &check)
	default:
		check.Status = "error"
		check.ErrorMessage = "Unsupported service type: " + service.Type
	}

	// Save check result to database
	err = s.saveServiceCheck(check)
	if err != nil {
		return check, err
	}

	// Update statistics
	s.updateServiceStats(serviceID)

	// Check for incidents (downtime, slow response)
	s.checkForIncidents(service, check)

	return check, nil
}

func (s *UptimeService) performHTTPCheck(service *db.UptimeService, check *db.ServiceCheck) {
	start := time.Now()

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: time.Duration(service.Timeout) * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
		},
	}

	// Create request
	req, err := http.NewRequest(service.Method, service.URL, nil)
	if err != nil {
		check.Status = "error"
		check.ErrorMessage = "Failed to create request: " + err.Error()
		return
	}

	// Add custom headers
	if service.Headers != nil {
		for key, value := range service.Headers {
			req.Header.Set(key, value)
		}
	}

	// Perform request
	resp, err := client.Do(req)
	if err != nil {
		check.Status = "down"
		check.ErrorMessage = err.Error()
		check.ResponseTime = int(time.Since(start).Milliseconds())
		return
	}
	defer resp.Body.Close()

	// Calculate response time
	check.ResponseTime = int(time.Since(start).Milliseconds())
	check.StatusCode = resp.StatusCode

	// Check if status code matches expected
	if resp.StatusCode == service.ExpectedStatus {
		check.Status = "up"
	} else {
		check.Status = "down"
		check.ErrorMessage = fmt.Sprintf("Expected status %d, got %d", service.ExpectedStatus, resp.StatusCode)
	}

	// Extract SSL certificate info for HTTPS
	if strings.ToLower(service.Type) == "https" && resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
		cert := resp.TLS.PeerCertificates[0]
		check.SSLExpiry = &cert.NotAfter
		check.SSLIssuer = cert.Issuer.CommonName
		check.SSLDaysLeft = int(time.Until(cert.NotAfter).Hours() / 24)
	}
}

func (s *UptimeService) performTCPCheck(service *db.UptimeService, check *db.ServiceCheck) {
	// TODO: Implement TCP check
	check.Status = "error"
	check.ErrorMessage = "TCP check not implemented yet"
}

func (s *UptimeService) performPingCheck(service *db.UptimeService, check *db.ServiceCheck) {
	// TODO: Implement ping check
	check.Status = "error"
	check.ErrorMessage = "Ping check not implemented yet"
}

func (s *UptimeService) saveServiceCheck(check db.ServiceCheck) error {
	_, err := s.PG.Exec(`
		INSERT INTO service_checks (id, service_id, status, response_time_ms, status_code, 
		                           response_body, error_message, checked_at, ssl_expiry, 
		                           ssl_issuer, ssl_days_left)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, check.ID, check.ServiceID, check.Status, check.ResponseTime, check.StatusCode,
		check.ResponseBody, check.ErrorMessage, check.CheckedAt, check.SSLExpiry,
		check.SSLIssuer, check.SSLDaysLeft)
	return err
}

// Statistics and Analytics
func (s *UptimeService) GetServiceStats(serviceID string, period string) (db.UptimeStats, error) {
	var stats db.UptimeStats
	err := s.PG.QueryRow(`
		SELECT service_id, period, uptime_percentage, total_checks, successful_checks, 
		       failed_checks, avg_response_time_ms, min_response_time_ms, max_response_time_ms, 
		       last_updated
		FROM uptime_stats 
		WHERE service_id = $1 AND period = $2
	`, serviceID, period).Scan(
		&stats.ServiceID, &stats.Period, &stats.UptimePercentage, &stats.TotalChecks,
		&stats.SuccessfulChecks, &stats.FailedChecks, &stats.AvgResponseTime,
		&stats.MinResponseTime, &stats.MaxResponseTime, &stats.LastUpdated,
	)
	return stats, err
}

func (s *UptimeService) GetServiceHistory(serviceID string, hours int) ([]db.ServiceCheck, error) {
	rows, err := s.PG.Query(`
		SELECT id, service_id, status, response_time_ms, status_code, error_message, 
		       checked_at, COALESCE(ssl_expiry, '1970-01-01'::timestamp), 
		       COALESCE(ssl_issuer, ''), COALESCE(ssl_days_left, 0)
		FROM service_checks 
		WHERE service_id = $1 AND checked_at > NOW() - INTERVAL '%d hours'
		ORDER BY checked_at DESC
		LIMIT 100
	`, serviceID, hours)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var checks []db.ServiceCheck
	for rows.Next() {
		var check db.ServiceCheck
		var sslExpiry time.Time
		err := rows.Scan(
			&check.ID, &check.ServiceID, &check.Status, &check.ResponseTime,
			&check.StatusCode, &check.ErrorMessage, &check.CheckedAt,
			&sslExpiry, &check.SSLIssuer, &check.SSLDaysLeft,
		)
		if err != nil {
			continue
		}

		// Handle SSL expiry
		if !sslExpiry.IsZero() && sslExpiry.Year() > 1970 {
			check.SSLExpiry = &sslExpiry
		}

		checks = append(checks, check)
	}
	return checks, nil
}

func (s *UptimeService) updateServiceStats(serviceID string) {
	periods := []string{"1h", "24h", "7d", "30d"}

	for _, period := range periods {
		var hours int
		switch period {
		case "1h":
			hours = 1
		case "24h":
			hours = 24
		case "7d":
			hours = 24 * 7
		case "30d":
			hours = 24 * 30
		}

		// Calculate stats for this period
		var totalChecks, successfulChecks, failedChecks int
		var avgResponseTime, minResponseTime, maxResponseTime float64

		err := s.PG.QueryRow(`
			SELECT 
				COUNT(*) as total_checks,
				COUNT(CASE WHEN status = 'up' THEN 1 END) as successful_checks,
				COUNT(CASE WHEN status != 'up' THEN 1 END) as failed_checks,
				COALESCE(AVG(response_time_ms), 0) as avg_response_time,
				COALESCE(MIN(response_time_ms), 0) as min_response_time,
				COALESCE(MAX(response_time_ms), 0) as max_response_time
			FROM service_checks 
			WHERE service_id = $1 AND checked_at > NOW() - INTERVAL '%d hours'
		`, serviceID, hours).Scan(
			&totalChecks, &successfulChecks, &failedChecks,
			&avgResponseTime, &minResponseTime, &maxResponseTime,
		)

		if err != nil {
			continue
		}

		// Calculate uptime percentage
		uptimePercentage := 0.0
		if totalChecks > 0 {
			uptimePercentage = (float64(successfulChecks) / float64(totalChecks)) * 100
		}

		// Update or insert stats
		_, err = s.PG.Exec(`
			INSERT INTO uptime_stats (id, service_id, period, uptime_percentage, total_checks, 
			                         successful_checks, failed_checks, avg_response_time_ms, 
			                         min_response_time_ms, max_response_time_ms, last_updated)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
			ON CONFLICT (service_id, period) 
			DO UPDATE SET 
				uptime_percentage = $4,
				total_checks = $5,
				successful_checks = $6,
				failed_checks = $7,
				avg_response_time_ms = $8,
				min_response_time_ms = $9,
				max_response_time_ms = $10,
				last_updated = NOW()
		`, uuid.New().String(), serviceID, period, uptimePercentage, totalChecks,
			successfulChecks, failedChecks, avgResponseTime, int(minResponseTime), int(maxResponseTime))
	}
}

func (s *UptimeService) checkForIncidents(service db.UptimeService, check db.ServiceCheck) {
	// Check for downtime incident
	if check.Status != "up" {
		s.handleDowntimeIncident(service.ID, check)
	} else {
		s.resolveDowntimeIncident(service.ID)
	}

	// Check for slow response incident (if response time > 5 seconds)
	if check.ResponseTime > 5000 {
		s.handleSlowResponseIncident(service.ID, check)
	}

	// Check for SSL expiry incident (if SSL expires in < 30 days)
	if check.SSLExpiry != nil && check.SSLDaysLeft < 30 && check.SSLDaysLeft > 0 {
		s.handleSSLExpiryIncident(service.ID, check)
	}
}

func (s *UptimeService) handleDowntimeIncident(serviceID string, check db.ServiceCheck) {
	// Check if there's already an ongoing downtime incident
	var existingID string
	err := s.PG.QueryRow(`
		SELECT id FROM service_incidents 
		WHERE service_id = $1 AND type = 'downtime' AND status = 'ongoing'
		ORDER BY started_at DESC LIMIT 1
	`, serviceID).Scan(&existingID)

	if err != nil {
		// No existing incident, create new one
		incidentID := uuid.New().String()
		description := fmt.Sprintf("Service is down: %s", check.ErrorMessage)

		_, err = s.PG.Exec(`
			INSERT INTO service_incidents (id, service_id, type, status, started_at, description)
			VALUES ($1, $2, 'downtime', 'ongoing', $3, $4)
		`, incidentID, serviceID, check.CheckedAt, description)

		if err == nil {
			// Create alert for downtime
			s.createDowntimeAlert(serviceID, incidentID, description)
		}
	}
}

func (s *UptimeService) resolveDowntimeIncident(serviceID string) {
	// Resolve any ongoing downtime incidents
	_, err := s.PG.Exec(`
		UPDATE service_incidents 
		SET status = 'resolved', 
		    resolved_at = NOW(),
		    duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
		WHERE service_id = $1 AND type = 'downtime' AND status = 'ongoing'
	`, serviceID)

	if err == nil {
		// TODO: Send resolution notification
	}
}

func (s *UptimeService) handleSlowResponseIncident(serviceID string, check db.ServiceCheck) {
	// Similar logic for slow response incidents
	// Implementation details...
}

func (s *UptimeService) handleSSLExpiryIncident(serviceID string, check db.ServiceCheck) {
	// Similar logic for SSL expiry incidents
	// Implementation details...
}

func (s *UptimeService) createDowntimeAlert(serviceID, incidentID, description string) {
	// Get service info
	service, err := s.GetService(serviceID)
	if err != nil {
		return
	}

	alert := db.Alert{
		ID:          uuid.New().String(),
		Title:       fmt.Sprintf("[UPTIME] Service Down: %s", service.Name),
		Description: description,
		Status:      "new",
		Severity:    "high",
		Source:      "uptime_monitor",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// Auto-assign to current on-call user
	userService := NewUserService(s.PG, s.Redis)
	onCallUser, err := userService.GetCurrentOnCallUser()
	if err == nil {
		alert.AssignedTo = onCallUser.ID
		now := time.Now()
		alert.AssignedAt = &now
	}

	// Save alert
	_, err = s.PG.Exec(`
		INSERT INTO alerts (id, title, description, status, created_at, updated_at, severity, source, assigned_to, assigned_at) 
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, alert.ID, alert.Title, alert.Description, alert.Status, alert.CreatedAt, alert.UpdatedAt,
		alert.Severity, alert.Source, alert.AssignedTo, alert.AssignedAt)

	if err == nil {
		// Add to worker queue
		b, _ := json.Marshal(alert)
		s.Redis.RPush(context.Background(), "alerts:queue", b)

		// Update incident with alert ID
		s.PG.Exec(`UPDATE service_incidents SET alert_id = $1 WHERE id = $2`, alert.ID, incidentID)
	}
}

func (s *UptimeService) initializeStatsForService(serviceID string) {
	periods := []string{"1h", "24h", "7d", "30d"}
	for _, period := range periods {
		_, err := s.PG.Exec(`
			INSERT INTO uptime_stats (id, service_id, period, uptime_percentage, total_checks, successful_checks, failed_checks)
			VALUES ($1, $2, $3, 100.00, 0, 0, 0)
			ON CONFLICT (service_id, period) DO NOTHING
		`, uuid.New().String(), serviceID, period)
		if err != nil {
			// Log error but continue
		}
	}
}
