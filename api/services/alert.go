package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type AlertService struct {
	PG         *sql.DB
	Redis      *redis.Client
	FCMService *FCMService
}

func NewAlertService(pg *sql.DB, redis *redis.Client, fcmService *FCMService) *AlertService {
	return &AlertService{
		PG:         pg,
		Redis:      redis,
		FCMService: fcmService,
	}
}

func (s *AlertService) ListAlerts() ([]db.AlertResponse, error) {
	query := `
		SELECT 
			a.id, a.title, a.description, a.status, a.created_at, a.updated_at, 
			a.severity, a.source, a.assigned_to, a.assigned_at,
			a.acked_by, a.acked_at,
			u.name, u.email,
			a.escalation_rule_id,
			COALESCE(a.current_escalation_level, 0) as current_escalation_level,
			a.last_escalated_at,
			COALESCE(a.escalation_status, 'none') as escalation_status,
			COALESCE(er.name, '') as escalation_rule_name
		FROM alerts a
		LEFT JOIN users u ON a.assigned_to = u.id
		LEFT JOIN escalation_rules er ON a.escalation_rule_id = er.id
		ORDER BY a.created_at DESC 
		LIMIT 100
	`

	rows, err := s.PG.Query(query)
	if err != nil {
		fmt.Println("Error querying alerts:", err)
		return nil, err
	}
	defer rows.Close()

	var alerts []db.AlertResponse
	for rows.Next() {
		var a db.AlertResponse
		var assignedTo sql.NullString
		var assignedAt sql.NullTime
		var ackedBy sql.NullString
		var ackedAt sql.NullTime
		var userName sql.NullString
		var userEmail sql.NullString
		var escalationRuleID sql.NullString
		var lastEscalatedAt sql.NullTime
		var escalationRuleName sql.NullString

		err := rows.Scan(
			&a.ID, &a.Title, &a.Description, &a.Status, &a.CreatedAt, &a.UpdatedAt,
			&a.Severity, &a.Source, &assignedTo, &assignedAt,
			&ackedBy, &ackedAt,
			&userName, &userEmail,
			&escalationRuleID, &a.CurrentEscalationLevel, &lastEscalatedAt, &a.EscalationStatus, &escalationRuleName,
		)
		if err != nil {
			continue
		}

		if assignedTo.Valid {
			a.AssignedTo = assignedTo.String
		}
		if assignedAt.Valid {
			a.AssignedAt = &assignedAt.Time
		}
		if ackedBy.Valid {
			a.AckedBy = ackedBy.String
		}
		if ackedAt.Valid {
			a.AckedAt = &ackedAt.Time
		}
		if userName.Valid {
			a.AssignedToName = userName.String
		}
		if userEmail.Valid {
			a.AssignedToEmail = userEmail.String
		}
		if escalationRuleID.Valid {
			a.EscalationRuleID = escalationRuleID.String
		}
		if lastEscalatedAt.Valid {
			a.LastEscalatedAt = &lastEscalatedAt.Time
		}
		if escalationRuleName.Valid {
			a.EscalationRuleName = escalationRuleName.String
		}

		alerts = append(alerts, a)
	}
	return alerts, nil
}

func (s *AlertService) CreateAlertFromRequest(c *gin.Context) (db.Alert, error) {
	var alert db.Alert
	if err := c.ShouldBindJSON(&alert); err != nil {
		return alert, err
	}
	alert.ID = uuid.New().String()
	alert.Status = "new"
	alert.CreatedAt = time.Now()
	alert.UpdatedAt = time.Now()
	alert.EscalationStatus = db.EscalationStatusNone
	alert.CurrentEscalationLevel = 1

	// Auto-assign to current on-call user
	userService := NewUserService(s.PG, s.Redis)
	onCallUser, err := userService.GetCurrentOnCallUser()
	if err == nil {
		alert.AssignedTo = onCallUser.ID
		now := time.Now()
		alert.AssignedAt = &now
	}

	// Handle NULL values for assigned_to and assigned_at
	var assignedTo interface{}
	var assignedAt interface{}

	if alert.AssignedTo != "" {
		assignedTo = alert.AssignedTo
	} else {
		assignedTo = nil
	}

	if alert.AssignedAt != nil {
		assignedAt = alert.AssignedAt
	} else {
		assignedAt = nil
	}

	_, err = s.PG.Exec(`INSERT INTO alerts (id, title, description, status, created_at, updated_at, severity, source, assigned_to, assigned_at, escalation_status, current_escalation_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		alert.ID, alert.Title, alert.Description, alert.Status, alert.CreatedAt, alert.UpdatedAt, alert.Severity, alert.Source, assignedTo, assignedAt, alert.EscalationStatus, alert.CurrentEscalationLevel)
	if err != nil {
		return alert, err
	}

	// Add to Redis queue for processing (if Redis is available)
	if s.Redis != nil {
		b, _ := json.Marshal(alert)
		s.Redis.RPush(context.Background(), "alerts:queue", b)
	}

	// Send FCM notification to assigned user
	if s.FCMService != nil && alert.AssignedTo != "" {
		go func() {
			if err := s.FCMService.SendAlertNotification(&alert); err != nil {
				fmt.Printf("Failed to send FCM notification: %v\n", err)
			}
		}()
	}

	return alert, nil
}

// CreateAlert creates a new alert from an Alert struct
func (s *AlertService) CreateAlert(alert *db.Alert) (*db.Alert, error) {
	// Only generate new ID if not already set (e.g., from AlertManager)
	if alert.ID == "" {
		alert.ID = uuid.New().String()
	}
	// Remove manual timestamp setting - let database handle with DEFAULT NOW()

	// Set default escalation values if not set
	if alert.EscalationStatus == "" {
		alert.EscalationStatus = db.EscalationStatusNone
	}

	// Auto-assign group from API key if not already set
	if alert.GroupID == "" && alert.APIKeyID != "" {
		if groupID, err := s.getGroupFromAPIKey(alert.APIKeyID); err == nil && groupID != "" {
			alert.GroupID = groupID
		}
	}

	// Handle NULL values for assigned_to and assigned_at
	var assignedTo interface{}
	var assignedAt interface{}

	if alert.AssignedTo != "" {
		assignedTo = alert.AssignedTo
	} else {
		assignedTo = nil
	}

	if alert.AssignedAt != nil {
		assignedAt = alert.AssignedAt
	} else {
		assignedAt = nil
	}

	_, err := s.PG.Exec(`
		INSERT INTO alerts (
			id, title, description, status, created_at, updated_at, 
			severity, source, assigned_to, assigned_at, escalation_status, current_escalation_level, group_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		alert.ID, alert.Title, alert.Description, alert.Status, alert.CreatedAt, alert.UpdatedAt,
		alert.Severity, alert.Source, assignedTo, assignedAt, alert.EscalationStatus, alert.CurrentEscalationLevel, alert.GroupID)
	if err != nil {
		return nil, err
	}

	return alert, nil
}

// getGroupFromAPIKey retrieves the group ID associated with an API key
func (s *AlertService) getGroupFromAPIKey(apiKeyID string) (string, error) {
	var groupID sql.NullString
	err := s.PG.QueryRow(`
		SELECT group_id FROM api_keys WHERE id = $1 AND is_active = true
	`, apiKeyID).Scan(&groupID)

	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil // API key not found or inactive, return empty group
		}
		return "", err
	}

	if groupID.Valid {
		return groupID.String, nil
	}
	return "", nil
}

func (s *AlertService) GetAlert(id string) (db.AlertResponse, error) {
	var a db.AlertResponse
	var assignedTo sql.NullString
	var assignedAt sql.NullTime
	var userName sql.NullString
	var userEmail sql.NullString
	var escalationRuleID sql.NullString
	var lastEscalatedAt sql.NullTime
	var escalationRuleName sql.NullString
	var groupID sql.NullString
	var groupName sql.NullString

	query := `
		SELECT 
			a.id, a.title, a.description, a.status, a.created_at, a.updated_at, 
			a.severity, a.source, a.assigned_to, a.assigned_at,
			a.group_id, g.name,
			u.name, u.email,
			COALESCE(a.escalation_rule_id, '') as escalation_rule_id,
			COALESCE(a.current_escalation_level, 0) as current_escalation_level,
			a.last_escalated_at,
			COALESCE(a.escalation_status, 'none') as escalation_status,
			COALESCE(er.name, '') as escalation_rule_name
		FROM alerts a
		LEFT JOIN users u ON a.assigned_to = u.id
		LEFT JOIN escalation_rules er ON a.escalation_rule_id = er.id
		LEFT JOIN groups g ON a.group_id = g.id
		WHERE a.id = $1
	`

	err := s.PG.QueryRow(query, id).Scan(
		&a.ID, &a.Title, &a.Description, &a.Status, &a.CreatedAt, &a.UpdatedAt,
		&a.Severity, &a.Source, &assignedTo, &assignedAt,
		&groupID, &groupName,
		&userName, &userEmail,
		&escalationRuleID, &a.CurrentEscalationLevel, &lastEscalatedAt, &a.EscalationStatus, &escalationRuleName,
	)

	if assignedTo.Valid {
		a.AssignedTo = assignedTo.String
	}
	if assignedAt.Valid {
		a.AssignedAt = &assignedAt.Time
	}
	if userName.Valid {
		a.AssignedToName = userName.String
	}
	if userEmail.Valid {
		a.AssignedToEmail = userEmail.String
	}
	if escalationRuleID.Valid {
		a.EscalationRuleID = escalationRuleID.String
	}
	if lastEscalatedAt.Valid {
		a.LastEscalatedAt = &lastEscalatedAt.Time
	}
	if escalationRuleName.Valid {
		a.EscalationRuleName = escalationRuleName.String
	}
	if groupID.Valid {
		a.GroupID = groupID.String
	}
	if groupName.Valid {
		a.GroupName = groupName.String
	}

	return a, err
}

func (s *AlertService) AckAlert(id string) error {
	now := time.Now()
	_, err := s.PG.Exec(`UPDATE alerts SET status = 'acked', acked_at = $1, updated_at = $2 WHERE id = $3`, now, now, id)
	return err
}

func (s *AlertService) UnackAlert(id string) error {
	now := time.Now()
	_, err := s.PG.Exec(`UPDATE alerts SET status = 'new', acked_at = NULL, updated_at = $1 WHERE id = $2`, now, id)
	return err
}

func (s *AlertService) CloseAlert(id string) error {
	now := time.Now()
	_, err := s.PG.Exec(`UPDATE alerts SET status = 'closed', updated_at = $1 WHERE id = $2`, now, id)
	return err
}

func (s *AlertService) AssignAlertToUser(alertID, userID string) error {
	now := time.Now()
	_, err := s.PG.Exec(`UPDATE alerts SET assigned_to = $1, assigned_at = $2, updated_at = $3 WHERE id = $4`,
		userID, now, now, alertID)
	return err
}

// CanUserAckAlert checks if a user has permission to acknowledge an alert
func (s *AlertService) CanUserAckAlert(alertID, userID string) (bool, error) {
	// Get alert details
	query := `
		SELECT a.assigned_to, u_assigned.team as assigned_team, a.source
		FROM alerts a
		LEFT JOIN users u_assigned ON a.assigned_to = u_assigned.id
		WHERE a.id = $1
	`

	var assignedTo sql.NullString
	var assignedTeam sql.NullString
	var source string

	err := s.PG.QueryRow(query, alertID).Scan(&assignedTo, &assignedTeam, &source)
	if err != nil {
		return false, err
	}

	// Get user details
	var user db.User
	err = s.PG.QueryRow(`
		SELECT id, role, team FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&user.ID, &user.Role, &user.Team)
	if err != nil {
		return false, err
	}

	// Permission rules:

	// 1. Assigned person can always ack
	if assignedTo.Valid && assignedTo.String == userID {
		return true, nil
	}

	// 2. Current on-call person can ack any alert
	userService := NewUserService(s.PG, s.Redis)
	onCallUser, err := userService.GetCurrentOnCallUser()
	if err == nil && onCallUser.ID == userID {
		return true, nil
	}

	// 3. Anyone in same team can ack (team-flexible model)
	if assignedTeam.Valid && assignedTeam.String == user.Team {
		return true, nil
	}

	// 4. Leads/Managers can ack any alert in their team
	if (user.Role == "manager" || user.Role == "lead") &&
		assignedTeam.Valid && assignedTeam.String == user.Team {
		return true, nil
	}

	// 5. For alerts from API key sources, check if user has API key management permission
	if source == "api_webhook" {
		// Allow team members to ack API-sourced alerts
		return assignedTeam.Valid && assignedTeam.String == user.Team, nil
	}

	return false, nil
}

// AckAlertByUser acknowledges an alert by a specific user with permission check
func (s *AlertService) AckAlertByUser(alertID, userID string) error {
	// Check permission
	canAck, err := s.CanUserAckAlert(alertID, userID)
	if err != nil {
		return err
	}
	if !canAck {
		return fmt.Errorf("user does not have permission to acknowledge this alert")
	}

	// Perform acknowledgment
	now := time.Now()
	_, err = s.PG.Exec(`
		UPDATE alerts 
		SET status = 'acked', acked_by = $1, acked_at = $2, updated_at = $3 
		WHERE id = $4
	`, userID, now, now, alertID)

	return err
}

// TriggerEscalation can be called externally to start escalation for an alert
func (s *AlertService) TriggerEscalation(alertID string, escalationService *EscalationService) error {
	// Get alert details
	alert, err := s.GetAlert(alertID)
	if err != nil {
		return fmt.Errorf("failed to get alert: %w", err)
	}

	// Convert AlertResponse to Alert for escalation processing
	alertForEscalation := &db.Alert{
		ID:                     alert.ID,
		Title:                  alert.Title,
		Description:            alert.Description,
		Status:                 alert.Status,
		CreatedAt:              alert.CreatedAt,
		UpdatedAt:              alert.UpdatedAt,
		Severity:               alert.Severity,
		Source:                 alert.Source,
		AckedBy:                alert.AckedBy,
		AckedAt:                alert.AckedAt,
		AssignedTo:             alert.AssignedTo,
		AssignedAt:             alert.AssignedAt,
		EscalationRuleID:       alert.EscalationRuleID,
		CurrentEscalationLevel: alert.CurrentEscalationLevel,
		LastEscalatedAt:        alert.LastEscalatedAt,
		EscalationStatus:       alert.EscalationStatus,
	}

	// Process escalation (Datadog-style)
	return escalationService.ProcessAlert(alertForEscalation)
}
