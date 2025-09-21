package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

type IncidentHandler struct {
	incidentService *services.IncidentService
}

func NewIncidentHandler(incidentService *services.IncidentService) *IncidentHandler {
	return &IncidentHandler{
		incidentService: incidentService,
	}
}

// ListIncidents handles GET /incidents
func (h *IncidentHandler) ListIncidents(c *gin.Context) {
	// Parse query parameters
	filters := make(map[string]interface{})

	if search := c.Query("search"); search != "" {
		filters["search"] = search
	}
	if status := c.Query("status"); status != "" {
		filters["status"] = status
	}
	if urgency := c.Query("urgency"); urgency != "" {
		filters["urgency"] = urgency
	}
	if severity := c.Query("severity"); severity != "" {
		filters["severity"] = severity
	}
	if assignedTo := c.Query("assigned_to"); assignedTo != "" {
		filters["assigned_to"] = assignedTo
	}
	if serviceID := c.Query("service_id"); serviceID != "" {
		filters["service_id"] = serviceID
	}
	if sort := c.Query("sort"); sort != "" {
		filters["sort"] = sort
	}

	// Pagination
	if pageStr := c.Query("page"); pageStr != "" {
		if page, err := strconv.Atoi(pageStr); err == nil && page > 0 {
			filters["page"] = page
		}
	}
	if limitStr := c.Query("limit"); limitStr != "" {
		if limit, err := strconv.Atoi(limitStr); err == nil && limit > 0 {
			filters["limit"] = limit
		}
	}

	incidents, err := h.incidentService.ListIncidents(filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to fetch incidents",
			"details": err.Error(),
		})
		return
	}

	// Calculate pagination info
	total := len(incidents)
	page := 1
	if p, ok := filters["page"].(int); ok {
		page = p
	}
	limit := 20
	if l, ok := filters["limit"].(int); ok {
		limit = l
	}

	c.JSON(http.StatusOK, gin.H{
		"incidents": incidents,
		"page":      page,
		"limit":     limit,
		"total":     total,
		"has_more":  len(incidents) == limit, // Simple check, could be improved
	})
}

// GetIncident handles GET /incidents/:id
func (h *IncidentHandler) GetIncident(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	incident, err := h.incidentService.GetIncident(id)
	if err != nil {
		if err.Error() == "incident not found" {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Incident not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to fetch incident",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, incident)
}

// CreateIncident handles POST /incidents
func (h *IncidentHandler) CreateIncident(c *gin.Context) {
	var req db.CreateIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid request body",
			"details": err.Error(),
		})
		return
	}

	// Convert request to incident
	incident := &db.Incident{
		Title:              req.Title,
		Description:        req.Description,
		Urgency:            req.Urgency,
		Priority:           req.Priority,
		ServiceID:          req.ServiceID,
		GroupID:            req.GroupID,
		EscalationPolicyID: req.EscalationPolicyID,
		IncidentKey:        req.IncidentKey,
		Severity:           req.Severity,
		Labels:             req.Labels,
		CustomFields:       req.CustomFields,
		Source:             "manual", // Manual creation
	}

	// Set default urgency if not provided
	if incident.Urgency == "" {
		incident.Urgency = db.IncidentUrgencyHigh
	}

	// Auto-assign incident based on escalation policy
	log.Printf("DEBUG: Starting auto-assignment check - EscalationPolicyID: '%s', GroupID: '%s'", incident.EscalationPolicyID, incident.GroupID)

	if incident.EscalationPolicyID != "" && incident.GroupID != "" {
		log.Printf("DEBUG: Both EscalationPolicyID and GroupID are present, calling GetAssigneeFromEscalationPolicy")
		assigneeID, err := h.incidentService.GetAssigneeFromEscalationPolicy(incident.EscalationPolicyID, incident.GroupID)
		if err != nil {
			log.Printf("DEBUG: Failed to get assignee from escalation policy: %v", err)
			// Continue with incident creation even if assignment fails
		} else if assigneeID != "" {
			log.Printf("DEBUG: Found assignee: %s, setting assignment fields", assigneeID)
			incident.AssignedTo = assigneeID
			now := time.Now()
			incident.AssignedAt = &now
			log.Printf("DEBUG: Auto-assigned incident to user %s based on escalation policy %s", assigneeID, incident.EscalationPolicyID)
		} else {
			log.Printf("DEBUG: GetAssigneeFromEscalationPolicy returned empty assigneeID")
		}
	} else {
		log.Printf("DEBUG: Skipping auto-assignment - missing EscalationPolicyID or GroupID")
	}

	log.Printf("DEBUG: Final incident state before creation - AssignedTo: '%s', AssignedAt: %v", incident.AssignedTo, incident.AssignedAt)

	createdIncident, err := h.incidentService.CreateIncident(incident)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to create incident",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, createdIncident)
}

// UpdateIncident handles PUT /incidents/:id
func (h *IncidentHandler) UpdateIncident(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	var req db.UpdateIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid request body",
			"details": err.Error(),
		})
		return
	}

	// TODO: Implement update logic
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": "Update incident not implemented yet",
	})
}

// AcknowledgeIncident handles POST /incidents/:id/acknowledge
func (h *IncidentHandler) AcknowledgeIncident(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "User not authenticated",
		})
		return
	}

	var req db.AcknowledgeIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Note is optional, so we can proceed without it
		req.Note = ""
	}

	err := h.incidentService.AcknowledgeIncident(id, userID.(string), req.Note)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to acknowledge incident",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Incident acknowledged successfully",
	})
}

// ResolveIncident handles POST /incidents/:id/resolve
func (h *IncidentHandler) ResolveIncident(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	// Get user ID from context (set by auth middleware)
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "User not authenticated",
		})
		return
	}

	var req db.ResolveIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Note and resolution are optional
		req.Note = ""
		req.Resolution = ""
	}

	err := h.incidentService.ResolveIncident(id, userID.(string), req.Note, req.Resolution)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to resolve incident",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Incident resolved successfully",
	})
}

// AssignIncident handles POST /incidents/:id/assign
func (h *IncidentHandler) AssignIncident(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	// Get user ID from context (set by auth middleware)
	assignedBy, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "User not authenticated",
		})
		return
	}

	var req db.AssignIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid request body",
			"details": err.Error(),
		})
		return
	}

	err := h.incidentService.AssignIncident(id, req.AssignedTo, assignedBy.(string), req.Note)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to assign incident",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Incident assigned successfully",
	})
}

// EscalateIncident handles POST /incidents/:id/escalate
func (h *IncidentHandler) EscalateIncident(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	// TODO: Implement escalation logic
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": "Escalate incident not implemented yet",
	})
}

// AddIncidentNote handles POST /incidents/:id/notes
func (h *IncidentHandler) AddIncidentNote(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	// Get user ID from context (set by auth middleware)
	_, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "User not authenticated",
		})
		return
	}

	var req db.AddIncidentNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid request body",
			"details": err.Error(),
		})
		return
	}

	// TODO: Implement add note functionality
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": "Add note not implemented yet",
	})
}

// GetIncidentEvents handles GET /incidents/:id/events
func (h *IncidentHandler) GetIncidentEvents(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Incident ID is required",
		})
		return
	}

	limit := 50
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	events, err := h.incidentService.GetIncidentEvents(id, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to fetch incident events",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"events": events,
	})
}

// GetIncidentStats handles GET /incidents/stats
func (h *IncidentHandler) GetIncidentStats(c *gin.Context) {
	stats, err := h.incidentService.GetIncidentStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to fetch incident stats",
			"details": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, stats)
}

// WebhookCreateIncident handles webhook incident creation (PagerDuty Events API style)
func (h *IncidentHandler) WebhookCreateIncident(c *gin.Context) {
	var req db.WebhookIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"status":  "invalid_request",
			"message": "Invalid request body",
			"details": err.Error(),
		})
		return
	}

	// Validate routing key (this should be linked to a service)
	// TODO: Implement service lookup by routing key

	// Handle deduplication
	var incident *db.Incident
	if req.DedupKey != "" {
		// Check if incident with this dedup key already exists
		existingIncidents, err := h.incidentService.ListIncidents(map[string]interface{}{
			"incident_key": req.DedupKey,
			"status":       []string{db.IncidentStatusTriggered, db.IncidentStatusAcknowledged},
		})
		if err == nil && len(existingIncidents) > 0 {
			// Update existing incident based on event action
			existingIncident := &existingIncidents[0]
			switch req.EventAction {
			case db.WebhookActionAcknowledge:
				// TODO: Acknowledge existing incident
			case db.WebhookActionResolve:
				// TODO: Resolve existing incident
			case db.WebhookActionTrigger:
				// Update existing incident (increment alert count, update timestamp)
				// TODO: Implement incident update
			}

			c.JSON(http.StatusOK, db.WebhookIncidentResponse{
				Status:      "success",
				Message:     "Incident updated",
				DedupKey:    req.DedupKey,
				IncidentID:  existingIncident.ID,
				IncidentKey: existingIncident.IncidentKey,
			})
			return
		}
	}

	// Create new incident for trigger events
	if req.EventAction == db.WebhookActionTrigger {
		incident = &db.Incident{
			Title:       req.Payload.Summary,
			Description: fmt.Sprintf("Source: %s\nComponent: %s\nClass: %s", req.Payload.Source, req.Payload.Component, req.Payload.Class),
			Severity:    req.Payload.Severity,
			Source:      "webhook",
			IncidentKey: req.DedupKey,
			Urgency:     db.IncidentUrgencyHigh, // Default to high for webhook incidents
		}

		// Set urgency based on severity
		if req.Payload.Severity == "info" || req.Payload.Severity == "warning" {
			incident.Urgency = db.IncidentUrgencyLow
		}

		// Add custom details to labels
		if req.Payload.CustomDetails != nil {
			incident.Labels = req.Payload.CustomDetails
		}

		createdIncident, err := h.incidentService.CreateIncident(incident)
		if err != nil {
			c.JSON(http.StatusInternalServerError, db.WebhookIncidentResponse{
				Status:  "error",
				Message: "Failed to create incident",
			})
			return
		}

		c.JSON(http.StatusCreated, db.WebhookIncidentResponse{
			Status:      "success",
			Message:     "Incident created",
			DedupKey:    req.DedupKey,
			IncidentID:  createdIncident.ID,
			IncidentKey: createdIncident.IncidentKey,
		})
		return
	}

	// For non-trigger events without existing incident
	c.JSON(http.StatusBadRequest, db.WebhookIncidentResponse{
		Status:  "invalid_request",
		Message: "Cannot acknowledge or resolve non-existent incident",
	})
}
