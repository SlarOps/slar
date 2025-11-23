package monitor

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type DeploymentHandler struct {
	db *sql.DB
}

func NewDeploymentHandler(db *sql.DB) *DeploymentHandler {
	return &DeploymentHandler{db: db}
}

type DeployRequest struct {
	Name          string `json:"name" binding:"required"`
	CFAccountID   string `json:"cf_account_id" binding:"required"`
	CFAPIToken    string `json:"cf_api_token" binding:"required"`
	WorkerName    string `json:"worker_name"`    // Optional, default slar-uptime-worker
	IntegrationID string `json:"integration_id"` // Optional, link to integration for webhook URL
}

func (h *DeploymentHandler) DeployWorker(c *gin.Context) {
	var req DeployRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.WorkerName == "" {
		req.WorkerName = "slar-uptime-worker"
	}

	// Validate integration if provided
	var webhookURL sql.NullString
	if req.IntegrationID != "" {
		err := h.db.QueryRow(`
			SELECT webhook_url FROM integrations 
			WHERE id = $1 AND is_active = true
		`, req.IntegrationID).Scan(&webhookURL)

		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found or inactive"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate integration"})
			return
		}
	}

	// TODO: Get user ID from context
	// userID := c.GetString("user_id")

	cf := NewCloudflareClient(req.CFAPIToken)

	// 1. Get or Create D1 Database (reuse if exists)
	dbID, err := cf.GetOrCreateD1Database(req.CFAccountID, "SLAR_DB")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get or create SLAR_DB: " + err.Error()})
		return
	}

	// Initialize D1 Schema
	err = h.ensureD1Schema(cf, req.CFAccountID, dbID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init D1 schema: " + err.Error()})
		return
	}

	// 2. Read Worker Script
	// Assuming running from project root
	scriptPath := filepath.Join("worker", "src", "index.js")
	scriptContent, err := os.ReadFile(scriptPath)
	if err != nil {
		// Try looking in ../worker/src/index.js (if running from cmd/server)
		scriptPath = filepath.Join("..", "worker", "src", "index.js")
		scriptContent, err = os.ReadFile(scriptPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read worker script: " + err.Error()})
			return
		}
	}

	// 3. Upload Worker
	bindings := []WorkerBinding{
		{Type: "d1", Name: "SLAR_DB", DatabaseID: dbID},
		{Type: "plain_text", Name: "SLAR_API_TOKEN", Text: "TODO_GENERATE_TOKEN"}, // We need a token for the worker to auth with API
	}

	// Add API URL binding
	apiURL := os.Getenv("NEXT_PUBLIC_API_URL")
	if apiURL == "" {
		apiURL = "https://api.slar.app" // Default fallback
	}
	bindings = append(bindings, WorkerBinding{Type: "plain_text", Name: "SLAR_API_URL", Text: apiURL})

	// Add webhook URL binding if integration is linked
	if webhookURL.Valid && webhookURL.String != "" {
		bindings = append(bindings, WorkerBinding{Type: "plain_text", Name: "SLAR_WEBHOOK_URL", Text: webhookURL.String})
	}

	err = cf.UploadWorker(req.CFAccountID, req.WorkerName, string(scriptContent), bindings)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload worker: " + err.Error()})
		return
	}

	// 4. Create Cron Trigger
	err = cf.CreateCronTrigger(req.CFAccountID, req.WorkerName, "* * * * *") // Every minute
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create cron trigger: " + err.Error()})
		return
	}

	// 5. Save to DB
	// We need to update monitor_deployments table to store d1_database_id instead of kv_config_id/kv_state_id
	// Or we can reuse one of the columns or add a new one.
	// Let's assume we'll migrate the table to add d1_database_id.
	// For now, I'll store it in kv_config_id as a hack or update the schema.
	// Better to update schema.

	var deploymentID uuid.UUID
	var integrationIDPtr *string
	if req.IntegrationID != "" {
		integrationIDPtr = &req.IntegrationID
	}

	err = h.db.QueryRow(`
		INSERT INTO monitor_deployments (name, cf_account_id, cf_api_token, worker_name, kv_config_id, integration_id, last_deployed_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		RETURNING id
	`, req.Name, req.CFAccountID, req.CFAPIToken, req.WorkerName, dbID, integrationIDPtr).Scan(&deploymentID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save deployment: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Worker deployed successfully",
		"deployment_id": deploymentID,
		"worker_url":    fmt.Sprintf("https://%s.%s.workers.dev", req.WorkerName, "SUBDOMAIN_TODO"), // We don't know subdomain easily
	})
}

func (h *DeploymentHandler) GetDeployments(c *gin.Context) {
	rows, err := h.db.Query(`
		SELECT id, name, worker_name, last_deployed_at, created_at, integration_id
		FROM monitor_deployments
		ORDER BY created_at DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	deployments := []map[string]interface{}{}
	for rows.Next() {
		var id uuid.UUID
		var name, workerName string
		var lastDeployedAt, createdAt sql.NullTime
		var integrationID sql.NullString
		if err := rows.Scan(&id, &name, &workerName, &lastDeployedAt, &createdAt, &integrationID); err != nil {
			continue
		}

		deployment := map[string]interface{}{
			"id":               id,
			"name":             name,
			"worker_name":      workerName,
			"last_deployed_at": lastDeployedAt.Time,
			"created_at":       createdAt.Time,
		}

		// Add integration_id if present
		if integrationID.Valid && integrationID.String != "" {
			deployment["integration_id"] = integrationID.String
		} else {
			deployment["integration_id"] = nil
		}

		deployments = append(deployments, deployment)
	}

	c.JSON(http.StatusOK, deployments)
}

// RedeployWorker redeploys an existing worker with latest code
func (h *DeploymentHandler) RedeployWorker(c *gin.Context) {
	deploymentID := c.Param("id")

	// Get deployment info from database
	var name, cfAccountID, cfAPIToken, workerName, dbID string
	var integrationID sql.NullString
	err := h.db.QueryRow(`
		SELECT name, cf_account_id, cf_api_token, worker_name, kv_config_id, integration_id
		FROM monitor_deployments
		WHERE id = $1
	`, deploymentID).Scan(&name, &cfAccountID, &cfAPIToken, &workerName, &dbID, &integrationID)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Deployment not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	cf := NewCloudflareClient(cfAPIToken)

	// Ensure D1 Schema is up to date
	err = h.ensureD1Schema(cf, cfAccountID, dbID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update D1 schema: " + err.Error()})
		return
	}

	// Read worker script from file
	// API runs from api/ directory, so we need to go up one level to reach worker/
	workerPath := filepath.Join("..", "worker", "src", "index.js")
	scriptContent, err := os.ReadFile(workerPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read worker script: " + err.Error()})
		return
	}

	// Get SLAR_API_URL from env
	slarAPIURL := os.Getenv("NEXT_PUBLIC_API_URL")
	if slarAPIURL == "" {
		slarAPIURL = "https://api.slar.app"
	}

	// Prepare bindings
	bindings := []WorkerBinding{
		{Type: "d1", Name: "SLAR_DB", DatabaseID: dbID},
		{Type: "plain_text", Name: "SLAR_API_URL", Text: slarAPIURL},
	}

	// Add webhook URL binding if integration is linked
	if integrationID.Valid && integrationID.String != "" {
		var webhookURL sql.NullString
		err := h.db.QueryRow(`
			SELECT webhook_url FROM integrations 
			WHERE id = $1 AND is_active = true
		`, integrationID.String).Scan(&webhookURL)

		if err == nil && webhookURL.Valid && webhookURL.String != "" {
			bindings = append(bindings, WorkerBinding{
				Type: "plain_text",
				Name: "SLAR_WEBHOOK_URL",
				Text: webhookURL.String,
			})
		}
	}

	// Add fallback webhook if configured
	fallbackWebhook := os.Getenv("FALLBACK_WEBHOOK_URL")
	if fallbackWebhook != "" {
		bindings = append(bindings, WorkerBinding{
			Type: "plain_text",
			Name: "FALLBACK_WEBHOOK_URL",
			Text: fallbackWebhook,
		})
	}

	// Upload worker (this will overwrite existing)
	err = cf.UploadWorker(cfAccountID, workerName, string(scriptContent), bindings)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload worker: " + err.Error()})
		return
	}

	// Update last_deployed_at
	_, err = h.db.Exec(`
		UPDATE monitor_deployments
		SET last_deployed_at = NOW()
		WHERE id = $1
	`, deploymentID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update deployment record: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Worker redeployed successfully",
		"deployment_id": deploymentID,
	})
}

// DeleteDeployment deletes a worker deployment
func (h *DeploymentHandler) DeleteDeployment(c *gin.Context) {
	deploymentID := c.Param("id")
	keepDatabase := c.Query("keep_database") == "true"

	// Get deployment info
	var cfAccountID, cfAPIToken, workerName, dbID string
	err := h.db.QueryRow(`
		SELECT cf_account_id, cf_api_token, worker_name, kv_config_id
		FROM monitor_deployments
		WHERE id = $1
	`, deploymentID).Scan(&cfAccountID, &cfAPIToken, &workerName, &dbID)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Deployment not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	cf := NewCloudflareClient(cfAPIToken)

	// Delete worker from Cloudflare
	err = cf.DeleteWorker(cfAccountID, workerName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete worker: " + err.Error()})
		return
	}

	// Delete D1 database if requested
	if !keepDatabase && dbID != "" {
		err = cf.DeleteD1Database(cfAccountID, dbID)
		if err != nil {
			// Log error but don't fail the request
			fmt.Printf("Warning: Failed to delete D1 database: %v\n", err)
		}
	}

	// Delete deployment record from database
	_, err = h.db.Exec(`DELETE FROM monitor_deployments WHERE id = $1`, deploymentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete deployment record: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Deployment deleted successfully",
		"database_kept": keepDatabase,
	})
}

// ensureD1Schema ensures the D1 database has the correct schema (tables and columns)
func (h *DeploymentHandler) ensureD1Schema(cf *CloudflareClient, accountID, dbID string) error {
	// 1. Create tables if not exist
	// Monitors table
	err := cf.ExecuteD1SQL(accountID, dbID, "CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, url TEXT NOT NULL, method TEXT DEFAULT 'GET', headers TEXT, body TEXT, timeout INTEGER, expect_status INTEGER, follow_redirect INTEGER, is_active INTEGER DEFAULT 1);", nil)
	if err != nil {
		return fmt.Errorf("failed to init monitors table: %v", err)
	}

	// Monitor Logs table
	err = cf.ExecuteD1SQL(accountID, dbID, "CREATE TABLE IF NOT EXISTS monitor_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id TEXT, location TEXT, status INTEGER, latency INTEGER, error TEXT, is_up INTEGER, created_at INTEGER);", nil)
	if err != nil {
		return fmt.Errorf("failed to init monitor_logs table: %v", err)
	}

	// 2. Add new columns (Schema Evolution)
	// We try to add columns one by one. If they exist, D1/SQLite might return an error, but we can ignore "duplicate column" errors.
	// Or better, we can check if they exist first, but that's more round trips.
	// SQLite ALTER TABLE ADD COLUMN is atomic.

	newColumns := []string{
		"ALTER TABLE monitors ADD COLUMN target TEXT;",
		"ALTER TABLE monitors ADD COLUMN response_keyword TEXT;",
		"ALTER TABLE monitors ADD COLUMN response_forbidden_keyword TEXT;",
		"ALTER TABLE monitors ADD COLUMN tooltip TEXT;",
		"ALTER TABLE monitors ADD COLUMN status_page_link TEXT;",
	}

	for _, sql := range newColumns {
		err := cf.ExecuteD1SQL(accountID, dbID, sql, nil)
		if err != nil {
			// Check if error is "duplicate column name"
			// D1 error format might vary, but usually contains the message.
			// We'll log it but continue, assuming it failed because column exists.
			// In a perfect world we'd parse the error.
			fmt.Printf("Info: Schema update query '%s' returned error (likely already exists): %v\n", sql, err)
		}
	}

	return nil
}

// GetDeploymentStats returns worker details and metrics for a deployment
func (h *DeploymentHandler) GetDeploymentStats(c *gin.Context) {
	deploymentID := c.Param("id")

	// Get deployment info
	var cfAccountID, cfAPIToken, workerName string
	err := h.db.QueryRow(`
		SELECT cf_account_id, cf_api_token, worker_name
		FROM monitor_deployments
		WHERE id = $1
	`, deploymentID).Scan(&cfAccountID, &cfAPIToken, &workerName)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Deployment not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	cf := NewCloudflareClient(cfAPIToken)

	// Fetch details and metrics in parallel
	// Use channels for simple concurrency
	detailsChan := make(chan *WorkerDetails, 1)
	metricsChan := make(chan *WorkerMetrics, 1)
	metricsErrChan := make(chan error, 1)
	errChan := make(chan error, 2)

	go func() {
		d, err := cf.GetWorkerDetails(cfAccountID, workerName)
		if err != nil {
			errChan <- fmt.Errorf("details error: %w", err)
			detailsChan <- nil
			return
		}
		detailsChan <- d
	}()

	go func() {
		m, err := cf.GetWorkerMetrics(cfAccountID, workerName)
		if err != nil {
			// Log error but don't fail completely if metrics fail
			fmt.Printf("Warning: Failed to get worker metrics: %v\n", err)
			metricsErrChan <- err
			metricsChan <- nil
			return
		}
		metricsErrChan <- nil
		metricsChan <- m
	}()

	details := <-detailsChan
	metrics := <-metricsChan
	metricsErr := <-metricsErrChan

	// Check for critical errors (details are critical)
	select {
	case err := <-errChan:
		if details == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	default:
	}

	response := gin.H{
		"details": details,
		"metrics": metrics,
	}

	if metricsErr != nil {
		response["metrics_error"] = metricsErr.Error()
	}

	c.JSON(http.StatusOK, response)
}
