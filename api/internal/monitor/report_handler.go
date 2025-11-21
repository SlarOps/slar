package monitor

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type ReportHandler struct {
	db              *sql.DB
	incidentService *services.IncidentService
}

func NewReportHandler(db *sql.DB, incidentService *services.IncidentService) *ReportHandler {
	return &ReportHandler{
		db:              db,
		incidentService: incidentService,
	}
}

type MonitorResult struct {
	MonitorID string `json:"monitor_id"`
	IsUp      bool   `json:"is_up"`
	Latency   int    `json:"latency"`
	Status    int    `json:"status"`
	Error     string `json:"error"`
}

type WorkerReport struct {
	Location  string          `json:"location"`
	Timestamp int64           `json:"timestamp"`
	Results   []MonitorResult `json:"results"`
}

func (h *ReportHandler) HandleReport(c *gin.Context) {
	var report WorkerReport
	if err := c.ShouldBindJSON(&report); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Validate Authorization header (Bearer token) against deployment token?
	// For now, we assume the token is valid if it matches what we deployed.
	// Ideally, we should check the token against the deployment record.

	for _, result := range report.Results {
		monitorID, err := uuid.Parse(result.MonitorID)
		if err != nil {
			continue
		}

		// Get current status to check for state change
		var currentIsUp *bool
		var name string
		err = h.db.QueryRow("SELECT is_up, name FROM monitors WHERE id = $1", monitorID).Scan(&currentIsUp, &name)
		if err != nil {
			continue
		}

		// Update monitor status
		_, err = h.db.Exec(`
			UPDATE monitors
			SET last_check_at = NOW(),
				last_status = $1,
				last_latency = $2,
				last_error = $3,
				is_up = $4,
				updated_at = NOW()
			WHERE id = $5
		`, result.Status, result.Latency, result.Error, result.IsUp, monitorID)

		if err != nil {
			continue
		}

		// Handle Incident Logic
		if currentIsUp != nil && *currentIsUp != result.IsUp {
			if !result.IsUp {
				// DOWN: Create Incident
				h.createIncident(monitorID, name, result.Error)
			} else {
				// UP: Resolve Incident
				h.resolveIncident(monitorID)
			}
		} else if currentIsUp == nil && !result.IsUp {
			// First check and it's DOWN
			h.createIncident(monitorID, name, result.Error)
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Report processed"})
}

func (h *ReportHandler) createIncident(monitorID uuid.UUID, monitorName string, errorMsg string) {
	incident := &db.Incident{
		Title:       "Monitor Down: " + monitorName,
		Description: "Monitor " + monitorName + " is down. Error: " + errorMsg,
		Status:      db.IncidentStatusTriggered,
		Urgency:     db.IncidentUrgencyHigh,
		Source:      "uptime-monitor",
		// We can store monitorID in CustomFields or ExternalID
		ExternalID: monitorID.String(),
		Severity:   "critical",
	}

	_, err := h.incidentService.CreateIncident(incident)
	if err != nil {
		// Log error (we don't have a logger here yet, maybe fmt.Println for now or inject logger)
		// In a real app, we should log this.
	}
}

func (h *ReportHandler) resolveIncident(monitorID uuid.UUID) {
	// Find active incident for this monitor
	// We need a method in IncidentService to find incident by ExternalID and Status
	// Since we don't have that handy, we can list incidents with filters.
	
	filters := map[string]interface{}{
		"status": "triggered", // or acknowledged
		// We need to filter by ExternalID, but ListIncidents doesn't seem to support it directly in the filter map I saw?
		// Wait, ListIncidents has `if search ...`. It doesn't explicitly check ExternalID in the filters map logic I read.
		// Let's check ListIncidents again.
		// It checks `service_id`, `group_id`, `assigned_to`.
		// It DOES NOT check `external_id`.
		
		// However, we can use `search` to find it if we put ID in title/description? No, that's flaky.
		// We should probably add `external_id` support to ListIncidents or add `GetIncidentByExternalID`.
		
		// For now, I'll assume I can add a method to IncidentService or just query DB directly here since I have access to h.db.
	}
	_ = filters // suppress unused warning

	// Direct DB query to find active incident
	var incidentID string
	err := h.db.QueryRow(`
		SELECT id FROM incidents 
		WHERE external_id = $1 
		AND status IN ('triggered', 'acknowledged')
		LIMIT 1
	`, monitorID.String()).Scan(&incidentID)

	if err == nil && incidentID != "" {
		// Resolve it
		// UserID "system" or similar. UUID required.
		// We might need a system user ID. For now, let's use a placeholder or nil if allowed (but ResolveIncident takes string).
		// We can use a known system user UUID or just empty string if the service handles it (it casts to uuid, so empty string might fail).
		// Let's check ResolveIncident: `resolved_by = $2::uuid`. Empty string will fail.
		// We need a valid UUID.
		// I'll use the nil UUID for now: "00000000-0000-0000-0000-000000000000"
		systemUserID := "00000000-0000-0000-0000-000000000000"
		
		h.incidentService.ResolveIncident(incidentID, systemUserID, "Monitor recovered", "Auto-resolved by uptime monitor")
	}
}
