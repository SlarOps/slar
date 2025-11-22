package monitor

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Monitor struct {
	ID                       uuid.UUID       `json:"id"`
	DeploymentID             uuid.UUID       `json:"deployment_id"`
	Name                     string          `json:"name"`
	Description              string          `json:"description"`
	Method                   string          `json:"method"`
	URL                      string          `json:"url"`
	Target                   *string         `json:"target"`
	Headers                  json.RawMessage `json:"headers"`
	Body                     string          `json:"body"`
	Timeout                  int             `json:"timeout"`
	ExpectStatus             *int            `json:"expect_status"`
	FollowRedirect           bool            `json:"follow_redirect"`
	ResponseKeyword          *string         `json:"response_keyword"`
	ResponseForbiddenKeyword *string         `json:"response_forbidden_keyword"`
	Tooltip                  *string         `json:"tooltip"`
	StatusPageLink           *string         `json:"status_page_link"`
	IntervalSeconds          int             `json:"interval_seconds"`
	IsActive                 bool            `json:"is_active"`
	LastCheckAt              *time.Time      `json:"last_check_at"`
	LastStatus               *int            `json:"last_status"`
	LastLatency              *int            `json:"last_latency"`
	LastError                *string         `json:"last_error"`
	IsUp                     *bool           `json:"is_up"`
	CreatedAt                time.Time       `json:"created_at"`
	UpdatedAt                time.Time       `json:"updated_at"`
}

type MonitorHandler struct {
	db *sql.DB
}

func NewMonitorHandler(db *sql.DB) *MonitorHandler {
	return &MonitorHandler{db: db}
}

func (h *MonitorHandler) GetMonitors(c *gin.Context) {
	deploymentID := c.Query("deployment_id")

	var query string
	var args []interface{}

	if deploymentID != "" {
		query = `
			SELECT id, deployment_id, name, description, method, url, target, headers, body, timeout, expect_status, follow_redirect, response_keyword, response_forbidden_keyword, tooltip, status_page_link, interval_seconds, is_active, last_check_at, last_status, last_latency, last_error, is_up, created_at, updated_at
			FROM monitors
			WHERE deployment_id = $1
			ORDER BY created_at DESC
		`
		args = append(args, deploymentID)
	} else {
		query = `
			SELECT id, deployment_id, name, description, method, url, target, headers, body, timeout, expect_status, follow_redirect, response_keyword, response_forbidden_keyword, tooltip, status_page_link, interval_seconds, is_active, last_check_at, last_status, last_latency, last_error, is_up, created_at, updated_at
			FROM monitors
			ORDER BY created_at DESC
		`
	}

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	monitors := []Monitor{}
	for rows.Next() {
		var m Monitor
		var headers []byte
		err := rows.Scan(
			&m.ID, &m.DeploymentID, &m.Name, &m.Description, &m.Method, &m.URL, &m.Target, &headers, &m.Body, &m.Timeout, &m.ExpectStatus, &m.FollowRedirect, &m.ResponseKeyword, &m.ResponseForbiddenKeyword, &m.Tooltip, &m.StatusPageLink, &m.IntervalSeconds, &m.IsActive, &m.LastCheckAt, &m.LastStatus, &m.LastLatency, &m.LastError, &m.IsUp, &m.CreatedAt, &m.UpdatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		m.Headers = json.RawMessage(headers)
		monitors = append(monitors, m)
	}

	c.JSON(http.StatusOK, monitors)
}

func (h *MonitorHandler) CreateMonitor(c *gin.Context) {
	var m Monitor
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate required fields
	if m.DeploymentID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deployment_id is required"})
		return
	}
	if m.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	// Validate required fields based on method type
	if m.Method == "TCP_PING" || m.Method == "DNS" || m.Method == "CERT_CHECK" {
		// These methods use 'target' field instead of 'url'
		if m.Target == nil || *m.Target == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "target is required for " + m.Method})
			return
		}
		// Set URL to target for consistency if not provided
		if m.URL == "" {
			m.URL = *m.Target
		}
	} else {
		// HTTP methods require 'url'
		if m.URL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "url is required"})
			return
		}
		// Set target to url for consistency if not provided
		if m.Target == nil || *m.Target == "" {
			m.Target = &m.URL
		}
	}

	// Set defaults
	if m.Method == "" {
		m.Method = "GET"
	}
	if m.Timeout == 0 {
		m.Timeout = 10000
	}
	if m.IntervalSeconds == 0 {
		m.IntervalSeconds = 60
	}
	m.IsActive = true

	// Ensure headers is valid JSON
	if len(m.Headers) == 0 {
		m.Headers = json.RawMessage("{}")
	}

	// Insert into DB
	err := h.db.QueryRow(`
		INSERT INTO monitors (deployment_id, name, description, method, url, target, headers, body, timeout, expect_status, follow_redirect, response_keyword, response_forbidden_keyword, tooltip, status_page_link, interval_seconds, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		RETURNING id, created_at, updated_at
	`, m.DeploymentID, m.Name, m.Description, m.Method, m.URL, m.Target, m.Headers, m.Body, m.Timeout, m.ExpectStatus, m.FollowRedirect, m.ResponseKeyword, m.ResponseForbiddenKeyword, m.Tooltip, m.StatusPageLink, m.IntervalSeconds, m.IsActive).Scan(&m.ID, &m.CreatedAt, &m.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Sync to D1
	go h.syncMonitorToD1(m.DeploymentID, m)

	c.JSON(http.StatusCreated, m)
}

func (h *MonitorHandler) UpdateMonitor(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var m Monitor
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m.ID = id // Ensure ID is set for sync

	// Ensure headers is valid JSON
	if len(m.Headers) == 0 {
		m.Headers = json.RawMessage("{}")
	}

	_, err = h.db.Exec(`
		UPDATE monitors
		SET name = $1, description = $2, method = $3, url = $4, target = $5, headers = $6, body = $7, timeout = $8, expect_status = $9, follow_redirect = $10, response_keyword = $11, response_forbidden_keyword = $12, tooltip = $13, status_page_link = $14, interval_seconds = $15, is_active = $16, updated_at = NOW()
		WHERE id = $17
	`, m.Name, m.Description, m.Method, m.URL, m.Target, m.Headers, m.Body, m.Timeout, m.ExpectStatus, m.FollowRedirect, m.ResponseKeyword, m.ResponseForbiddenKeyword, m.Tooltip, m.StatusPageLink, m.IntervalSeconds, m.IsActive, id)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get deployment ID for sync
	var deploymentID uuid.UUID
	h.db.QueryRow("SELECT deployment_id FROM monitors WHERE id = $1", id).Scan(&deploymentID)
	m.DeploymentID = deploymentID

	go h.syncMonitorToD1(deploymentID, m)

	c.JSON(http.StatusOK, gin.H{"message": "Monitor updated"})
}

func (h *MonitorHandler) DeleteMonitor(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	// Get deployment ID before delete
	var deploymentID uuid.UUID
	h.db.QueryRow("SELECT deployment_id FROM monitors WHERE id = $1", id).Scan(&deploymentID)

	_, err = h.db.Exec("DELETE FROM monitors WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Sync delete to D1
	go h.deleteMonitorFromD1(deploymentID, id)

	c.JSON(http.StatusOK, gin.H{"message": "Monitor deleted"})
}

func (h *MonitorHandler) syncMonitorToD1(deploymentID uuid.UUID, m Monitor) {
	// 1. Get Cloudflare credentials
	var accountID, apiToken, dbID string
	err := h.db.QueryRow(`
		SELECT cf_account_id, cf_api_token, kv_config_id 
		FROM monitor_deployments WHERE id = $1
	`, deploymentID).Scan(&accountID, &apiToken, &dbID)

	if err != nil {
		// Log error
		return
	}

	cf := NewCloudflareClient(apiToken)

	// 2. Execute SQL on D1
	// UPSERT logic: DELETE then INSERT (simplest for SQLite without conflict clause complexity if ID exists)
	// Or INSERT OR REPLACE

	sql := `
		INSERT OR REPLACE INTO monitors (id, url, method, target, headers, body, timeout, expect_status, follow_redirect, response_keyword, response_forbidden_keyword, is_active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	headersStr := "{}"
	if len(m.Headers) > 0 {
		headersStr = string(m.Headers)
	}

	isActive := 0
	if m.IsActive {
		isActive = 1
	}

	followRedirect := 0
	if m.FollowRedirect {
		followRedirect = 1
	}

	targetStr := ""
	if m.Target != nil {
		targetStr = *m.Target
	}

	responseKeyword := ""
	if m.ResponseKeyword != nil {
		responseKeyword = *m.ResponseKeyword
	}

	responseForbiddenKeyword := ""
	if m.ResponseForbiddenKeyword != nil {
		responseForbiddenKeyword = *m.ResponseForbiddenKeyword
	}

	params := []interface{}{
		m.ID.String(),
		m.URL,
		m.Method,
		targetStr,
		headersStr,
		m.Body,
		m.Timeout,
		m.ExpectStatus,
		followRedirect,
		responseKeyword,
		responseForbiddenKeyword,
		isActive,
	}

	cf.ExecuteD1SQL(accountID, dbID, sql, params)
}

func (h *MonitorHandler) deleteMonitorFromD1(deploymentID uuid.UUID, monitorID uuid.UUID) {
	var accountID, apiToken, dbID string
	err := h.db.QueryRow(`
		SELECT cf_account_id, cf_api_token, kv_config_id 
		FROM monitor_deployments WHERE id = $1
	`, deploymentID).Scan(&accountID, &apiToken, &dbID)

	if err != nil {
		return
	}

	cf := NewCloudflareClient(apiToken)
	cf.ExecuteD1SQL(accountID, dbID, "DELETE FROM monitors WHERE id = ?", []interface{}{monitorID.String()})
}

// GetMonitorStats returns overall statistics for a monitor from D1
func (h *MonitorHandler) GetMonitorStats(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	// Get deployment info to access D1
	var deploymentID uuid.UUID
	var accountID, apiToken, dbID string
	err = h.db.QueryRow(`
		SELECT m.deployment_id, d.cf_account_id, d.cf_api_token, d.kv_config_id
		FROM monitors m
		JOIN monitor_deployments d ON m.deployment_id = d.id
		WHERE m.id = $1
	`, id).Scan(&deploymentID, &accountID, &apiToken, &dbID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Monitor not found"})
		return
	}

	cf := NewCloudflareClient(apiToken)

	// Query D1 for statistics (last 30 days)
	thirtyDaysAgo := time.Now().AddDate(0, 0, -30).Unix()
	results, err := cf.QueryD1SQL(accountID, dbID, `
		SELECT 
			COUNT(*) as total_checks,
			SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) as up_checks,
			AVG(CASE WHEN latency > 0 THEN latency ELSE NULL END) as avg_latency
		FROM monitor_logs
		WHERE monitor_id = ? AND created_at >= ?
	`, []interface{}{id.String(), thirtyDaysAgo})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	uptimePercent := 0.0
	avgLatency := 0.0
	totalChecks := 0

	if len(results) > 0 {
		if val, ok := results[0]["total_checks"].(float64); ok {
			totalChecks = int(val)
		}
		if val, ok := results[0]["up_checks"].(float64); ok && totalChecks > 0 {
			uptimePercent = (val / float64(totalChecks)) * 100
		}
		if val, ok := results[0]["avg_latency"].(float64); ok {
			avgLatency = val
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"uptime_percent": uptimePercent,
		"avg_latency_ms": avgLatency,
		"total_checks":   totalChecks,
	})
}

// GetUptimeHistory returns daily uptime status for the last 90 days from D1
func (h *MonitorHandler) GetUptimeHistory(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	// Get deployment info
	var accountID, apiToken, dbID string
	err = h.db.QueryRow(`
		SELECT d.cf_account_id, d.cf_api_token, d.kv_config_id
		FROM monitors m
		JOIN monitor_deployments d ON m.deployment_id = d.id
		WHERE m.id = $1
	`, id).Scan(&accountID, &apiToken, &dbID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Monitor not found"})
		return
	}

	cf := NewCloudflareClient(apiToken)

	// Query D1 for 90-day history
	ninetyDaysAgo := time.Now().AddDate(0, 0, -90).Unix()
	results, err := cf.QueryD1SQL(accountID, dbID, `
		SELECT 
			DATE(created_at, 'unixepoch') as check_date,
			COUNT(*) as total_checks,
			SUM(CASE WHEN is_up = 1 THEN 1 ELSE 0 END) as up_checks
		FROM monitor_logs
		WHERE monitor_id = ? AND created_at >= ?
		GROUP BY check_date
		ORDER BY check_date ASC
	`, []interface{}{id.String(), ninetyDaysAgo})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	history := []map[string]interface{}{}
	for _, row := range results {
		totalChecks := 0.0
		upChecks := 0.0

		if val, ok := row["total_checks"].(float64); ok {
			totalChecks = val
		}
		if val, ok := row["up_checks"].(float64); ok {
			upChecks = val
		}

		uptimePercent := 0.0
		if totalChecks > 0 {
			uptimePercent = (upChecks / totalChecks) * 100
		}

		status := "up"
		if uptimePercent < 95 {
			status = "down"
		} else if totalChecks == 0 {
			status = "no-data"
		}

		history = append(history, map[string]interface{}{
			"date":           row["check_date"],
			"status":         status,
			"uptime_percent": uptimePercent,
		})
	}

	c.JSON(http.StatusOK, history)
}

// GetResponseTimes returns response time data for charting from D1
func (h *MonitorHandler) GetResponseTimes(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	period := c.DefaultQuery("period", "24h")
	var duration int64
	var bucketSize int64 // Downsampling bucket size in seconds

	switch period {
	case "4h":
		duration = 4 * 3600
		bucketSize = 0 // No aggregation
	case "24h":
		duration = 24 * 3600
		bucketSize = 180 // 3 minutes
	case "7d":
		duration = 7 * 24 * 3600
		bucketSize = 3600 // 1 hour
	case "30d":
		duration = 30 * 24 * 3600
		bucketSize = 14400 // 4 hours
	default:
		duration = 24 * 3600
		bucketSize = 180
	}

	// Get deployment info
	var accountID, apiToken, dbID string
	err = h.db.QueryRow(`
		SELECT d.cf_account_id, d.cf_api_token, d.kv_config_id
		FROM monitors m
		JOIN monitor_deployments d ON m.deployment_id = d.id
		WHERE m.id = $1
	`, id).Scan(&accountID, &apiToken, &dbID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Monitor not found"})
		return
	}

	cf := NewCloudflareClient(apiToken)

	startTime := time.Now().Unix() - duration

	// Build query based on bucket size
	var query string
	if bucketSize == 0 {
		// No aggregation - return raw data
		query = `
			SELECT 
				created_at,
				latency,
				is_up,
				status,
				error
			FROM monitor_logs
			WHERE monitor_id = ? AND created_at >= ?
			ORDER BY created_at ASC
		`
	} else {
		// Aggregate data into time buckets
		query = fmt.Sprintf(`
			SELECT 
				(created_at / %d) * %d as created_at,
				AVG(latency) as latency,
				MAX(is_up) as is_up,
				MAX(status) as status,
				'' as error
			FROM monitor_logs
			WHERE monitor_id = ? AND created_at >= ?
			GROUP BY (created_at / %d)
			ORDER BY created_at ASC
		`, bucketSize, bucketSize, bucketSize)
	}

	results, err := cf.QueryD1SQL(accountID, dbID, query, []interface{}{id.String(), startTime})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	data := []map[string]interface{}{}
	for _, row := range results {
		timestamp := int64(0)
		latency := 0.0
		status := 0
		errorMsg := ""

		if val, ok := row["created_at"].(float64); ok {
			timestamp = int64(val)
		}
		if val, ok := row["latency"].(float64); ok {
			latency = val
		}
		if val, ok := row["status"].(float64); ok {
			status = int(val)
		}
		if val, ok := row["error"].(string); ok {
			errorMsg = val
		}

		t := time.Unix(timestamp, 0)
		data = append(data, map[string]interface{}{
			"timestamp": timestamp,
			"time":      t.Format("3PM"),
			"latency":   latency,
			"is_up":     row["is_up"],
			"status":    status,
			"error":     errorMsg,
		})
	}

	c.JSON(http.StatusOK, data)
}
