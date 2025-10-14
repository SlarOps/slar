package workers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/vanchonlee/slar/db"
	"github.com/vanchonlee/slar/services"
)

// IncidentWorker handles incident processing and escalation
type IncidentWorker struct {
	PG                 *sql.DB
	IncidentService    *services.IncidentService
	NotificationWorker *NotificationWorker
}

func NewIncidentWorker(pg *sql.DB, incidentService *services.IncidentService, notificationWorker *NotificationWorker) *IncidentWorker {
	return &IncidentWorker{
		PG:                 pg,
		IncidentService:    incidentService,
		NotificationWorker: notificationWorker,
	}
}

// StartIncidentWorker processes incidents that need escalation
func (w *IncidentWorker) StartIncidentWorker() {
	log.Println("Incident worker started, processing escalations...")

	ticker := time.NewTicker(5 * time.Second) // Check every 30 seconds
	defer ticker.Stop()

	for range ticker.C {
		w.processEscalations()
	}
}

// processEscalations finds incidents that need escalation and processes them
func (w *IncidentWorker) processEscalations() {
	log.Printf("DEBUG: Starting escalation check...")

	// Find incidents that need escalation
	incidents, err := w.getIncidentsNeedingEscalation()
	if err != nil {
		log.Printf("Worker: failed to get incidents needing escalation: %v", err)
		return
	}

	log.Printf("Worker: found %d incidents needing escalation", len(incidents))

	// Debug: Log details of each incident found
	for i, incident := range incidents {
		log.Printf("DEBUG: Incident %d - ID: %s, Status: %s, EscalationStatus: %s, Level: %d, LastEscalated: %v, Created: %v",
			i+1, incident.ID, incident.Status, incident.EscalationStatus,
			incident.CurrentEscalationLevel, incident.LastEscalatedAt, incident.CreatedAt)
	}

	for _, incident := range incidents {
		go w.processIncidentEscalation(incident)
	}
}

// getIncidentsNeedingEscalation finds incidents that need to be escalated
func (w *IncidentWorker) getIncidentsNeedingEscalation() ([]db.Incident, error) {
	// First, let's debug what incidents exist and check timezone issues
	debugQuery := `
		SELECT i.id, i.status, i.escalation_policy_id, i.escalation_status,
		       i.current_escalation_level, i.last_escalated_at, i.created_at,
		       NOW() as current_time,
		       NOW() AT TIME ZONE 'UTC' as current_time_utc,
		       i.created_at AT TIME ZONE 'UTC' as created_at_utc,
		       EXTRACT(EPOCH FROM (NOW() - i.created_at))/60 as minutes_since_created,
		       CASE WHEN i.last_escalated_at IS NOT NULL
		            THEN EXTRACT(EPOCH FROM (NOW() - i.last_escalated_at))/60
		            ELSE NULL END as minutes_since_escalated,
		       -- Get timeout for current level or level 1 if not escalated
		       COALESCE(
		           (SELECT el.timeout_minutes FROM escalation_levels el
		            WHERE el.policy_id = i.escalation_policy_id
		            AND el.level_number = CASE WHEN i.current_escalation_level = 0 THEN 1 ELSE i.current_escalation_level END
		            LIMIT 1),
		           5
		       ) as current_timeout_minutes,
		       -- Check if next level exists
		       EXISTS(SELECT 1 FROM escalation_levels el_next
		              WHERE el_next.policy_id = i.escalation_policy_id
		              AND el_next.level_number = i.current_escalation_level + 1) as has_next_level
		FROM incidents i
		WHERE i.status = 'triggered'
		ORDER BY i.created_at DESC
		LIMIT 5
	`

	log.Printf("DEBUG: Checking all triggered incidents...")
	debugRows, err := w.PG.Query(debugQuery)
	if err != nil {
		log.Printf("DEBUG: Failed to run debug query: %v", err)
	} else {
		defer debugRows.Close()
		debugCount := 0
		for debugRows.Next() {
			var id, status, escalationStatus string
			var escalationPolicyID sql.NullString
			var currentLevel, currentTimeoutMinutes int
			var lastEscalated, created, currentTime, currentTimeUTC, createdAtUTC sql.NullTime
			var minutesSinceCreated, minutesSinceEscalated sql.NullFloat64
			var hasNextLevel bool

			err := debugRows.Scan(&id, &status, &escalationPolicyID, &escalationStatus,
				&currentLevel, &lastEscalated, &created, &currentTime, &currentTimeUTC, &createdAtUTC,
				&minutesSinceCreated, &minutesSinceEscalated, &currentTimeoutMinutes, &hasNextLevel)
			if err != nil {
				log.Printf("DEBUG: Error scanning debug row: %v", err)
				continue
			}

			debugCount++
			log.Printf("DEBUG: Incident %s - Status: %s, EscPolicy: %v, EscStatus: %s, Level: %d",
				id, status, escalationPolicyID.String, escalationStatus, currentLevel)
			log.Printf("DEBUG:   Created: %v | Current: %v", created.Time, currentTime.Time)
			log.Printf("DEBUG:   Created UTC: %v | Current UTC: %v", createdAtUTC.Time, currentTimeUTC.Time)
			log.Printf("DEBUG:   MinSinceCreated: %.1f, MinSinceEscalated: %v, TimeoutMinutes: %d, HasNextLevel: %t",
				minutesSinceCreated.Float64, minutesSinceEscalated.Float64, currentTimeoutMinutes, hasNextLevel)
		}
		log.Printf("DEBUG: Found %d total triggered incidents", debugCount)
	}

	query := `
		SELECT i.id, i.title, i.description, i.status, i.urgency, i.priority,
		       i.created_at, i.updated_at, i.assigned_to, i.assigned_at,
		       i.source, i.service_id, i.escalation_policy_id, i.group_id,
		       i.current_escalation_level, i.last_escalated_at, i.escalation_status,
		       i.severity, i.incident_key, i.alert_count
		FROM incidents i
		WHERE i.status = 'triggered'
		AND i.escalation_policy_id IS NOT NULL
		AND i.escalation_status IN ('none', 'pending')
		AND (
			-- Never escalated: check timeout for level 1
			(i.last_escalated_at IS NULL
			 AND EXISTS (
				SELECT 1 FROM escalation_levels el1
				WHERE el1.policy_id = i.escalation_policy_id
				AND el1.level_number = 1
				AND i.created_at < NOW() - INTERVAL '1 minute' * el1.timeout_minutes
			 ))
			OR
			-- Already escalated: check if current level has timed out and next level exists
			(i.last_escalated_at IS NOT NULL
			 AND i.current_escalation_level > 0
			 AND EXISTS (
				SELECT 1 FROM escalation_levels el_current
				WHERE el_current.policy_id = i.escalation_policy_id
				AND el_current.level_number = i.current_escalation_level
				AND i.last_escalated_at < NOW() - INTERVAL '1 minute' * el_current.timeout_minutes
			 )
			 AND EXISTS (
				SELECT 1 FROM escalation_levels el_next
				WHERE el_next.policy_id = i.escalation_policy_id
				AND el_next.level_number = i.current_escalation_level + 1
			 ))
		)
		ORDER BY i.created_at ASC
		LIMIT 50
		FOR UPDATE SKIP LOCKED
	`

	rows, err := w.PG.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var incidents []db.Incident
	for rows.Next() {
		var incident db.Incident
		var assignedTo, serviceID, escalationPolicyID, groupID sql.NullString
		var assignedAt, lastEscalatedAt sql.NullTime

		err := rows.Scan(
			&incident.ID, &incident.Title, &incident.Description, &incident.Status,
			&incident.Urgency, &incident.Priority, &incident.CreatedAt, &incident.UpdatedAt,
			&assignedTo, &assignedAt, &incident.Source, &serviceID,
			&escalationPolicyID, &groupID, &incident.CurrentEscalationLevel,
			&lastEscalatedAt, &incident.EscalationStatus, &incident.Severity,
			&incident.IncidentKey, &incident.AlertCount,
		)
		if err != nil {
			log.Printf("Worker: error scanning incident: %v", err)
			continue
		}

		// Handle nullable fields
		if assignedTo.Valid {
			incident.AssignedTo = assignedTo.String
		}
		if assignedAt.Valid {
			incident.AssignedAt = &assignedAt.Time
		}
		if serviceID.Valid {
			incident.ServiceID = serviceID.String
		}
		if escalationPolicyID.Valid {
			incident.EscalationPolicyID = escalationPolicyID.String
		}
		if groupID.Valid {
			incident.GroupID = groupID.String
		}
		if lastEscalatedAt.Valid {
			incident.LastEscalatedAt = &lastEscalatedAt.Time
		}

		incidents = append(incidents, incident)
	}

	return incidents, nil
}

// processIncidentEscalation handles escalation for a single incident
func (w *IncidentWorker) processIncidentEscalation(incident db.Incident) {
	log.Printf("DEBUG: Starting escalation for incident %s (current level %d, status: %s, policy: %s)",
		incident.ID, incident.CurrentEscalationLevel, incident.EscalationStatus, incident.EscalationPolicyID)
	log.Printf("DEBUG: Escalation state - Level %d means: %s",
		incident.CurrentEscalationLevel,
		func() string {
			if incident.CurrentEscalationLevel == 0 {
				return "not yet escalated"
			}
			return fmt.Sprintf("escalated to policy level %d", incident.CurrentEscalationLevel)
		}())

	// Get escalation policy details
	escalationLevels, err := w.getEscalationLevels(incident.EscalationPolicyID)
	if err != nil {
		log.Printf("Worker: failed to get escalation levels for incident %s: %v", incident.ID, err)
		return
	}

	log.Printf("DEBUG: Found %d escalation levels for policy %s", len(escalationLevels), incident.EscalationPolicyID)
	for i, level := range escalationLevels {
		log.Printf("DEBUG: Level %d - Number: %d, Type: %s, Target: %s", i+1, level.LevelNumber, level.TargetType, level.TargetID)
	}

	if len(escalationLevels) == 0 {
		log.Printf("Worker: no escalation levels found for incident %s", incident.ID)
		w.updateIncidentEscalation(incident.ID, 0, "completed")
		return
	}

	// Determine next escalation level
	// current_escalation_level: 0 = not escalated, 1 = level 1, 2 = level 2, etc.
	nextLevel := incident.CurrentEscalationLevel + 1
	log.Printf("DEBUG: Next escalation level should be %d (current: %d)", nextLevel, incident.CurrentEscalationLevel)

	if nextLevel > len(escalationLevels) {
		log.Printf("Worker: incident %s has reached maximum escalation level (next: %d, max: %d)",
			incident.ID, nextLevel, len(escalationLevels))
		w.updateIncidentEscalation(incident.ID, incident.CurrentEscalationLevel, "completed")
		return
	}

	// Get the escalation level to process
	var targetLevel db.EscalationLevel
	for _, level := range escalationLevels {
		if level.LevelNumber == nextLevel {
			targetLevel = level
			break
		}
	}

	if targetLevel.ID == "" {
		log.Printf("Worker: escalation level %d not found for incident %s (available levels: %v)",
			nextLevel, incident.ID, func() []int {
				var levels []int
				for _, l := range escalationLevels {
					levels = append(levels, l.LevelNumber)
				}
				return levels
			}())
		w.updateIncidentEscalation(incident.ID, incident.CurrentEscalationLevel, "completed")
		return
	}

	log.Printf("DEBUG: Found target level %d - Type: %s, Target: %s",
		targetLevel.LevelNumber, targetLevel.TargetType, targetLevel.TargetID)

	// Process escalation based on target type
	success := w.processEscalationTarget(incident, targetLevel)

	// Update incident escalation status
	if success {
		// Log escalation event
		eventData := map[string]interface{}{
			"escalation_level": nextLevel,
			"target_type":      targetLevel.TargetType,
			"target_id":        targetLevel.TargetID,
			"reason":           "escalation_policy",
		}

		// Get assignee info for the event
		if assigneeID, err := w.getIncidentAssignee(incident.ID); err == nil && assigneeID != "" {
			if assigneeName, err := w.getUserName(assigneeID); err == nil {
				eventData["assigned_to"] = assigneeName
				eventData["assigned_to_id"] = assigneeID
			}
		}

		err := w.createIncidentEvent(incident.ID, "escalated", eventData, "system")
		if err != nil {
			log.Printf("Worker: failed to log escalation event: %v", err)
		}

		// Check if there are more levels to escalate after this one
		// We need to check if there's a level after nextLevel (i.e., nextLevel + 1)
		hasMoreLevels := false
		for _, level := range escalationLevels {
			if level.LevelNumber == nextLevel+1 {
				hasMoreLevels = true
				break
			}
		}

		if hasMoreLevels {
			// Set to pending for next escalation level
			w.updateIncidentEscalation(incident.ID, nextLevel, "pending")
			log.Printf("Worker: successfully escalated incident %s to level %d, ready for next level", incident.ID, nextLevel)
		} else {
			// This was the last level, update to final level and mark as completed
			w.updateIncidentEscalation(incident.ID, nextLevel, "completed")

			// Create escalation completion event
			w.createEscalationCompletionEvent(incident.ID, nextLevel)

			log.Printf("Worker: successfully escalated incident %s to final level %d", incident.ID, nextLevel)
		}
	} else {
		log.Printf("Worker: failed to escalate incident %s to level %d", incident.ID, nextLevel)
		// Keep status as 'pending' to allow retry later (no need to update since FOR UPDATE SKIP LOCKED handles concurrency)
	}
}

// getEscalationLevels retrieves escalation levels for a policy
func (w *IncidentWorker) getEscalationLevels(policyID string) ([]db.EscalationLevel, error) {
	query := `
		SELECT id, policy_id, level_number, target_type, target_id, timeout_minutes
		FROM escalation_levels
		WHERE policy_id = $1
		ORDER BY level_number ASC
	`

	rows, err := w.PG.Query(query, policyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var levels []db.EscalationLevel
	for rows.Next() {
		var level db.EscalationLevel
		err := rows.Scan(
			&level.ID, &level.PolicyID, &level.LevelNumber,
			&level.TargetType, &level.TargetID, &level.TimeoutMinutes,
		)
		if err != nil {
			log.Printf("Worker: error scanning escalation level: %v", err)
			continue
		}
		levels = append(levels, level)
	}

	return levels, nil
}

// processEscalationTarget handles escalation to a specific target
func (w *IncidentWorker) processEscalationTarget(incident db.Incident, level db.EscalationLevel) bool {
	switch level.TargetType {
	case "user":
		return w.escalateToUser(incident, level.TargetID)
	case "scheduler":
		return w.escalateToScheduler(incident, level.TargetID)
	case "group":
		return w.escalateToGroup(incident, level.TargetID)
	case "external":
		return w.escalateToExternal(incident, level.TargetID)
	default:
		log.Printf("Worker: unknown escalation target type: %s", level.TargetType)
		return false
	}
}

// escalateToUser assigns incident to a specific user
func (w *IncidentWorker) escalateToUser(incident db.Incident, userID string) bool {
	// Assign without sending assignment notification (we'll send escalation notification instead)
	success := w.escalateToUserWithNotification(incident, userID, false)
	if success && w.NotificationWorker != nil {
		// Send escalation notification instead of assignment notification
		if err := w.NotificationWorker.SendIncidentEscalatedNotification(userID, incident.ID); err != nil {
			log.Printf("⚠️  Failed to send incident escalation notification: %v", err)
		} else {
			log.Printf("✅ Sent incident escalation notification to user %s", userID)
		}
	}
	
	return success
}

// escalateToUserWithNotification assigns incident to a specific user with optional notification
func (w *IncidentWorker) escalateToUserWithNotification(incident db.Incident, userID string, sendNotification bool) bool {
	log.Printf("DEBUG: Assigning incident %s to user %s (sendNotification: %v)", incident.ID, userID, sendNotification)

	query := `
		UPDATE incidents
		SET assigned_to = $1
		WHERE id = $2
	`

	result, err := w.PG.Exec(query, userID, incident.ID)
	if err != nil {
		log.Printf("Worker: failed to assign incident %s to user %s: %v", incident.ID, userID, err)
		return false
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		log.Printf("DEBUG: Failed to get rows affected: %v", err)
	} else {
		log.Printf("DEBUG: Assignment query affected %d rows", rowsAffected)
	}

	log.Printf("Worker: assigned incident %s to user %s", incident.ID, userID)

	// Send notification to user via PGMQ only if requested
	if sendNotification && w.NotificationWorker != nil {
		if err := w.NotificationWorker.SendIncidentAssignedNotification(userID, incident.ID); err != nil {
			log.Printf("⚠️  Failed to send incident assignment notification: %v", err)
			// Don't fail the assignment if notification fails
		} else {
			log.Printf("✅ Sent incident assignment notification to user %s", userID)
		}
	} else if sendNotification {
		log.Printf("⚠️  NotificationWorker not available, skipping notification")
	} else {
		log.Printf("📝 Skipping assignment notification (escalation context)")
	}

	return true
}

// escalateToScheduler finds current on-call user in scheduler and assigns
func (w *IncidentWorker) escalateToScheduler(incident db.Incident, schedulerID string) bool {
	log.Printf("DEBUG: Escalating to scheduler %s for incident %s (policy: %s, group: %s)",
		schedulerID, incident.ID, incident.EscalationPolicyID, incident.GroupID)

	// Find current on-call user for this specific scheduler
	query := `
		SELECT s.user_id
		FROM shifts s
		WHERE s.scheduler_id = $1
		AND s.group_id = $2
		AND s.is_active = true
		AND s.start_time <= NOW()
		AND s.end_time >= NOW()
		ORDER BY s.start_time ASC
		LIMIT 1
	`

	var userID string
	err := w.PG.QueryRow(query, schedulerID, incident.GroupID).Scan(&userID)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("Worker: no on-call user found for scheduler %s", schedulerID)
			return false
		}
		log.Printf("Worker: failed to get on-call user for scheduler %s: %v", schedulerID, err)
		return false
	}

	log.Printf("DEBUG: Found on-call user %s for scheduler %s", userID, schedulerID)

	// Assign without sending assignment notification (we'll send escalation notification instead)
	success := w.escalateToUserWithNotification(incident, userID, false)
	if success && w.NotificationWorker != nil {
		// Send escalation notification instead of assignment notification
		if err := w.NotificationWorker.SendIncidentEscalatedNotification(userID, incident.ID); err != nil {
			log.Printf("⚠️  Failed to send incident escalation notification: %v", err)
		} else {
			log.Printf("✅ Sent incident escalation notification to user %s", userID)
		}
	}

	return success
}

// escalateToGroup assigns to current on-call user in group
func (w *IncidentWorker) escalateToGroup(incident db.Incident, groupID string) bool {
	// Find current on-call user for this group
	query := `
		SELECT s.user_id
		FROM shifts s
		WHERE s.group_id = $1
		AND s.is_active = true
		AND s.start_time <= NOW()
		AND s.end_time >= NOW()
		ORDER BY s.start_time ASC
		LIMIT 1
	`

	var userID string
	err := w.PG.QueryRow(query, groupID).Scan(&userID)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("Worker: no on-call user found for group %s", groupID)
			return false
		}
		log.Printf("Worker: failed to get on-call user for group %s: %v", groupID, err)
		return false
	}

	// Assign without sending assignment notification (we'll send escalation notification instead)
	success := w.escalateToUserWithNotification(incident, userID, false)
	if success && w.NotificationWorker != nil {
		// Send escalation notification instead of assignment notification
		if err := w.NotificationWorker.SendIncidentEscalatedNotification(userID, incident.ID); err != nil {
			log.Printf("⚠️  Failed to send incident escalation notification: %v", err)
		} else {
			log.Printf("✅ Sent incident escalation notification to user %s", userID)
		}
	}

	return success
}

// escalateToExternal handles external escalation (webhooks, etc.)
func (w *IncidentWorker) escalateToExternal(incident db.Incident, targetID string) bool {
	log.Printf("Worker: external escalation for incident %s to target %s", incident.ID, targetID)
	// TODO: Implement external escalation (webhooks, API calls, etc.)
	return true
}

// updateIncidentEscalation updates incident escalation status
func (w *IncidentWorker) updateIncidentEscalation(incidentID string, level int, status string) {
	log.Printf("DEBUG: Updating incident %s escalation - Level: %d, Status: %s", incidentID, level, status)

	query := `
		UPDATE incidents
		SET current_escalation_level = $1,
		    escalation_status = $2,
		    last_escalated_at = NOW() AT TIME ZONE 'UTC'
		WHERE id = $3
	`

	result, err := w.PG.Exec(query, level, status, incidentID)
	if err != nil {
		log.Printf("Worker: failed to update escalation for incident %s: %v", incidentID, err)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		log.Printf("DEBUG: Failed to get rows affected for escalation update: %v", err)
	} else {
		log.Printf("DEBUG: Escalation update affected %d rows", rowsAffected)
	}
}

// createEscalationCompletionEvent creates an escalation completion event
func (w *IncidentWorker) createEscalationCompletionEvent(incidentID string, finalLevel int) {
	// Get current incident info to log final assignment
	var assignedTo, assignedToName sql.NullString

	query := `
		SELECT assigned_to,
		       COALESCE(u.name, u.email, 'Unknown') as assigned_to_name
		FROM incidents i
		LEFT JOIN users u ON i.assigned_to = u.id
		WHERE i.id = $1
	`

	err := w.PG.QueryRow(query, incidentID).Scan(&assignedTo, &assignedToName)
	if err != nil {
		log.Printf("Worker: failed to get incident info for completion event: %v", err)
	}

	// Log escalation completion event
	eventData := map[string]interface{}{
		"escalation_status": "completed",
		"final_level":       finalLevel,
		"reason":            "escalation_policy_completed",
	}

	if assignedTo.Valid && assignedToName.Valid {
		eventData["final_assignee"] = assignedToName.String
		eventData["final_assignee_id"] = assignedTo.String
	}

	err = w.createIncidentEvent(incidentID, "escalation_completed", eventData, "")
	if err != nil {
		log.Printf("Worker: failed to log escalation completion event: %v", err)
	}

	log.Printf("Worker: created escalation completion event for incident %s (final level: %d, assigned to: %s)",
		incidentID, finalLevel, assignedToName.String)
}

// createIncidentEvent creates an event for an incident
func (w *IncidentWorker) createIncidentEvent(incidentID, eventType string, eventData map[string]interface{}, createdBy string) error {
	eventDataJSON, _ := json.Marshal(eventData)

	var createdByParam interface{}
	// Only set createdByParam if createdBy is a valid UUID (not "system" or empty)
	if createdBy != "" && createdBy != "system" {
		createdByParam = createdBy
	}
	// For "system" or empty, leave as NULL

	_, err := w.PG.Exec(`
		INSERT INTO incident_events (incident_id, event_type, event_data, created_by)
		VALUES ($1, $2, $3, $4)
	`, incidentID, eventType, string(eventDataJSON), createdByParam)

	return err
}

// getIncidentAssignee gets the current assignee of an incident
func (w *IncidentWorker) getIncidentAssignee(incidentID string) (string, error) {
	var assigneeID sql.NullString
	query := `SELECT assigned_to FROM incidents WHERE id = $1`
	err := w.PG.QueryRow(query, incidentID).Scan(&assigneeID)
	if err != nil {
		return "", err
	}
	if assigneeID.Valid {
		return assigneeID.String, nil
	}
	return "", nil
}

// getUserName gets the name of a user by ID
func (w *IncidentWorker) getUserName(userID string) (string, error) {
	var name sql.NullString
	query := `SELECT COALESCE(name, email, 'Unknown') FROM users WHERE id = $1`
	err := w.PG.QueryRow(query, userID).Scan(&name)
	if err != nil {
		return "", err
	}
	if name.Valid {
		return name.String, nil
	}
	return "Unknown", nil
}

// UptimeWorker handles uptime monitoring
type UptimeWorker struct {
	PG              *sql.DB
	IncidentService *services.IncidentService
}

func NewUptimeWorker(pg *sql.DB, incidentService *services.IncidentService) *UptimeWorker {
	return &UptimeWorker{
		PG:              pg,
		IncidentService: incidentService,
	}
}

// StartUptimeWorker monitors service uptime and creates incidents for downtime
func (w *UptimeWorker) StartUptimeWorker() {
	log.Println("Uptime worker started, monitoring services...")

	ticker := time.NewTicker(30 * time.Second) // Check every 30 seconds
	defer ticker.Stop()

	for range ticker.C {
		w.checkAllServices()
	}
}

// checkAllServices gets active services and checks their uptime
func (w *UptimeWorker) checkAllServices() {
	services, err := w.getActiveServices()
	if err != nil {
		log.Printf("Uptime worker: failed to get services from database: %v", err)
		return
	}

	log.Printf("Uptime worker: checking %d services", len(services))

	for _, service := range services {
		go w.checkServiceUptime(service)
	}
}

// getActiveServices retrieves active uptime services from database
func (w *UptimeWorker) getActiveServices() ([]db.UptimeService, error) {
	rows, err := w.PG.Query(`
		SELECT id, name, url, type, method, interval_seconds, timeout_seconds, expected_status
		FROM uptime_services
		WHERE is_active = true AND is_enabled = true
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var services []db.UptimeService
	for rows.Next() {
		var service db.UptimeService
		err := rows.Scan(
			&service.ID,
			&service.Name,
			&service.URL,
			&service.Type,
			&service.Method,
			&service.Interval,
			&service.Timeout,
			&service.ExpectedStatus,
		)
		if err != nil {
			log.Printf("Uptime worker: error scanning service: %v", err)
			continue
		}
		services = append(services, service)
	}

	return services, nil
}

// checkServiceUptime checks a single service and creates incident if down
func (w *UptimeWorker) checkServiceUptime(service db.UptimeService) {
	start := time.Now()
	client := &http.Client{
		Timeout: time.Duration(service.Timeout) * time.Second,
	}

	resp, err := client.Get(service.URL)
	duration := time.Since(start)

	isUp := err == nil && resp != nil && resp.StatusCode >= 200 && resp.StatusCode < 400
	if resp != nil {
		resp.Body.Close()
	}

	// Store uptime check result in database
	w.storeUptimeResult(service.ID, isUp, duration, err)

	if !isUp {
		log.Printf("Uptime worker: %s is DOWN (error: %v)", service.Name, err)
		w.createDowntimeIncident(service, err)
	} else {
		log.Printf("Uptime worker: %s is UP (response time: %v)", service.Name, duration)
	}
}

// storeUptimeResult stores uptime check result in database
func (w *UptimeWorker) storeUptimeResult(serviceID string, isUp bool, duration time.Duration, checkError error) {
	status := "up"
	errorMessage := ""

	if !isUp {
		status = "down"
		if checkError != nil {
			errorMessage = checkError.Error()
		}
	}

	query := `
		INSERT INTO uptime_checks (id, service_id, status, response_time_ms, error_message, checked_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
	`

	_, err := w.PG.Exec(query, serviceID, status, duration.Milliseconds(), errorMessage)
	if err != nil {
		log.Printf("Uptime worker: failed to store uptime result for service %s: %v", serviceID, err)
	}
}

// createDowntimeIncident creates an incident for service downtime
func (w *UptimeWorker) createDowntimeIncident(service db.UptimeService, checkError error) {
	// Check if there's already an open incident for this service
	existingIncident, err := w.getOpenDowntimeIncident(service.ID)
	if err != nil {
		log.Printf("Uptime worker: failed to check existing incidents for service %s: %v", service.ID, err)
		return
	}

	if existingIncident != nil {
		log.Printf("Uptime worker: incident already exists for service %s downtime", service.Name)
		return
	}

	// Create new incident
	description := "Service " + service.Name + " is down"
	if checkError != nil {
		description += ": " + checkError.Error()
	}

	incident := &db.Incident{
		Title:       "Service Down: " + service.Name,
		Description: description,
		Status:      db.IncidentStatusTriggered,
		Urgency:     db.IncidentUrgencyHigh,
		Severity:    "critical",
		Source:      "uptime-monitor",
		// TODO: Link to service if we have service integration
	}

	createdIncident, err := w.IncidentService.CreateIncident(incident)
	if err != nil {
		log.Printf("Uptime worker: failed to create downtime incident for %s: %v", service.Name, err)
		return
	}

	log.Printf("Uptime worker: created downtime incident %s for service %s", createdIncident.ID, service.Name)
}

// getOpenDowntimeIncident checks if there's already an open incident for service downtime
func (w *UptimeWorker) getOpenDowntimeIncident(serviceID string) (*db.Incident, error) {
	query := `
		SELECT id, title, status, created_at
		FROM incidents
		WHERE source = 'uptime-monitor'
		AND status IN ('triggered', 'acknowledged')
		AND title LIKE '%Service Down:%'
		AND description LIKE '%' || (SELECT name FROM uptime_services WHERE id = $1) || '%'
		ORDER BY created_at DESC
		LIMIT 1
	`

	var incident db.Incident
	err := w.PG.QueryRow(query, serviceID).Scan(
		&incident.ID, &incident.Title, &incident.Status, &incident.CreatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // No existing incident
		}
		return nil, err
	}

	return &incident, nil
}

// Worker implementation complete - Redis removed, PostgreSQL-only
