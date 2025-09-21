package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type EscalationService struct {
	PG           *sql.DB
	Redis        *redis.Client
	GroupService *GroupService
	FCMService   *FCMService
}

func NewEscalationService(pg *sql.DB, redis *redis.Client, groupService *GroupService, fcmService *FCMService) *EscalationService {
	return &EscalationService{
		PG:           pg,
		Redis:        redis,
		GroupService: groupService,
		FCMService:   fcmService,
	}
}

// ==========================================
// DATADOG-STYLE ESCALATION POLICY MANAGEMENT
// ==========================================

// EscalationPolicyWithUsage extends EscalationPolicy with usage statistics
type EscalationPolicyWithUsage struct {
	db.EscalationPolicy
	ServicesCount int `json:"services_count"`
}

// EscalationTarget represents a single target within a step
type EscalationTarget struct {
	Type        string `json:"type"`
	TargetID    string `json:"target_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// EscalationStep represents a grouped step with multiple targets
type EscalationStep struct {
	StepNumber           int                `json:"stepNumber"`
	Targets              []EscalationTarget `json:"targets"`
	EscalateAfterMinutes int                `json:"escalateAfterMinutes"`
	MessageTemplate      string             `json:"messageTemplate"`
}

// EscalationPolicyWithSteps extends EscalationPolicy with grouped steps (UI-friendly format)
type EscalationPolicyWithSteps struct {
	db.EscalationPolicy
	Steps []EscalationStep `json:"steps"`
}

// CreateEscalationPolicy creates a new Datadog-style escalation policy with levels
func (s *EscalationService) CreateEscalationPolicy(groupID string, req db.EscalationPolicy) (db.EscalationPolicy, error) {
	policy := db.EscalationPolicy{
		ID:                   uuid.New().String(), // ✅ Generate UUID
		Name:                 req.Name,
		Description:          req.Description,
		IsActive:             true,
		RepeatMaxTimes:       req.RepeatMaxTimes,
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
		CreatedBy:            req.CreatedBy,
		EscalateAfterMinutes: req.EscalateAfterMinutes,
		GroupID:              groupID,
	}

	// Set defaults
	if policy.RepeatMaxTimes == 0 {
		policy.RepeatMaxTimes = 1
	}

	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return policy, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Insert escalation policy
	query := `
		INSERT INTO escalation_policies (
			id, name, description, is_active, repeat_max_times, 
			created_at, updated_at, group_id, created_by, escalate_after_minutes
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`

	_, err = tx.Exec(query,
		policy.ID, policy.Name, policy.Description, policy.IsActive,
		policy.RepeatMaxTimes, policy.CreatedAt, policy.UpdatedAt, policy.GroupID, policy.CreatedBy, policy.EscalateAfterMinutes)
	if err != nil {
		log.Println("Failed to insert escalation policy:", err)
		return policy, fmt.Errorf("failed to insert escalation policy: %w", err)
	}

	// Insert escalation levels
	for _, levelReq := range req.Levels {
		level := db.EscalationLevel{
			ID:                  uuid.New().String(), // ✅ Generate UUID
			PolicyID:            policy.ID,
			LevelNumber:         levelReq.LevelNumber,
			TargetType:          levelReq.TargetType,
			TargetID:            levelReq.TargetID,
			TimeoutMinutes:      levelReq.TimeoutMinutes,
			NotificationMethods: levelReq.NotificationMethods,
			MessageTemplate:     levelReq.MessageTemplate,
			CreatedAt:           time.Now(),
		}

		// Set defaults for escalation level
		if level.TimeoutMinutes == 0 {
			level.TimeoutMinutes = 5
		}
		if len(level.NotificationMethods) == 0 {
			level.NotificationMethods = []string{"email"}
		}
		if level.MessageTemplate == "" {
			level.MessageTemplate = "Alert: {{alert.title}} requires attention"
		}

		// Serialize notification methods to JSON
		notificationMethodsJSON, err := json.Marshal(level.NotificationMethods)
		if err != nil {
			return policy, fmt.Errorf("failed to serialize notification methods: %w", err)
		}

		levelQuery := `
			INSERT INTO escalation_levels (
				id, policy_id, level_number, target_type, target_id, 
				timeout_minutes, notification_methods, message_template, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

		_, err = tx.Exec(levelQuery,
			level.ID, level.PolicyID, level.LevelNumber, level.TargetType, level.TargetID,
			level.TimeoutMinutes, notificationMethodsJSON, level.MessageTemplate, level.CreatedAt)
		if err != nil {
			log.Println("Failed to insert escalation level:", err)
			return policy, fmt.Errorf("failed to insert escalation level: %w", err)
		}

		policy.Levels = append(policy.Levels, level)
	}

	// Commit transaction
	if err = tx.Commit(); err != nil {
		return policy, fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("Created escalation policy: %s with %d levels", policy.Name, len(policy.Levels))
	return policy, nil
}

// UpdateEscalationPolicy updates an existing escalation policy with levels
func (s *EscalationService) UpdateEscalationPolicy(policyID string, req db.EscalationPolicy) (db.EscalationPolicy, error) {
	// First, get the existing policy to preserve some fields
	existingPolicy, err := s.GetEscalationPolicy(policyID)
	if err != nil {
		return db.EscalationPolicy{}, fmt.Errorf("failed to get existing policy: %w", err)
	}

	// Update policy fields
	policy := existingPolicy
	policy.Name = req.Name
	policy.Description = req.Description
	// policy.IsActive = req.IsActive
	policy.RepeatMaxTimes = req.RepeatMaxTimes
	policy.EscalateAfterMinutes = req.EscalateAfterMinutes
	policy.UpdatedAt = time.Now()

	// Set defaults
	if policy.RepeatMaxTimes == 0 {
		policy.RepeatMaxTimes = 1
	}

	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return policy, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Update escalation policy
	updateQuery := `
		UPDATE escalation_policies 
		SET name = $2, description = $3, is_active = $4, repeat_max_times = $5,
			updated_at = $6, escalate_after_minutes = $7
		WHERE id = $1`

	_, err = tx.Exec(updateQuery,
		policy.ID, policy.Name, policy.Description, policy.IsActive,
		policy.RepeatMaxTimes, policy.UpdatedAt, policy.EscalateAfterMinutes)
	if err != nil {
		log.Println("Failed to update escalation policy:", err)
		return policy, fmt.Errorf("failed to update escalation policy: %w", err)
	}

	// Delete existing levels
	deleteQuery := `DELETE FROM escalation_levels WHERE policy_id = $1`
	_, err = tx.Exec(deleteQuery, policy.ID)
	if err != nil {
		log.Println("Failed to delete existing escalation levels:", err)
		return policy, fmt.Errorf("failed to delete existing escalation levels: %w", err)
	}

	// Insert new escalation levels
	for _, levelReq := range req.Levels {
		level := db.EscalationLevel{
			ID:                  uuid.New().String(),
			PolicyID:            policy.ID,
			LevelNumber:         levelReq.LevelNumber,
			TargetType:          levelReq.TargetType,
			TargetID:            levelReq.TargetID,
			TimeoutMinutes:      levelReq.TimeoutMinutes,
			NotificationMethods: levelReq.NotificationMethods,
			MessageTemplate:     levelReq.MessageTemplate,
			CreatedAt:           time.Now(),
		}

		// Set defaults for escalation level
		if level.TimeoutMinutes == 0 {
			level.TimeoutMinutes = 5
		}
		if len(level.NotificationMethods) == 0 {
			level.NotificationMethods = []string{"email"}
		}
		if level.MessageTemplate == "" {
			level.MessageTemplate = "Alert: {{alert.title}} requires attention"
		}

		// Serialize notification methods
		notificationMethodsJSON, err := json.Marshal(level.NotificationMethods)
		if err != nil {
			return policy, fmt.Errorf("failed to serialize notification methods: %w", err)
		}

		levelQuery := `
			INSERT INTO escalation_levels (
				id, policy_id, level_number, target_type, target_id, 
				timeout_minutes, notification_methods, message_template, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

		_, err = tx.Exec(levelQuery,
			level.ID, level.PolicyID, level.LevelNumber, level.TargetType, level.TargetID,
			level.TimeoutMinutes, notificationMethodsJSON, level.MessageTemplate, level.CreatedAt)
		if err != nil {
			log.Println("Failed to insert escalation level:", err)
			return policy, fmt.Errorf("failed to insert escalation level: %w", err)
		}

		policy.Levels = append(policy.Levels, level)
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return policy, fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("Successfully updated escalation policy %s with %d levels", policy.ID, len(policy.Levels))
	return policy, nil
}

// DeleteEscalationPolicy deletes an escalation policy and all its levels
func (s *EscalationService) DeleteEscalationPolicy(policyID string) error {
	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Delete escalation levels first (due to foreign key constraint)
	deleteLevelsQuery := `DELETE FROM escalation_levels WHERE policy_id = $1`
	_, err = tx.Exec(deleteLevelsQuery, policyID)
	if err != nil {
		log.Println("Failed to delete escalation levels:", err)
		return fmt.Errorf("failed to delete escalation levels: %w", err)
	}

	// Delete escalation policy
	deletePolicyQuery := `DELETE FROM escalation_policies WHERE id = $1`
	result, err := tx.Exec(deletePolicyQuery, policyID)
	if err != nil {
		log.Println("Failed to delete escalation policy:", err)
		return fmt.Errorf("failed to delete escalation policy: %w", err)
	}

	// Check if policy was actually deleted
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("escalation policy not found: %s", policyID)
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("Successfully deleted escalation policy %s", policyID)
	return nil
}

// GetEscalationPolicy retrieves a single escalation policy by ID
func (s *EscalationService) GetEscalationPolicy(id string) (db.EscalationPolicy, error) {
	var policy db.EscalationPolicy
	query := `
		SELECT id, name, description, is_active, repeat_max_times, 
			   created_at, updated_at, COALESCE(created_by, '') as created_by
		FROM escalation_policies 
		WHERE id = $1`

	err := s.PG.QueryRow(query, id).Scan(
		&policy.ID, &policy.Name, &policy.Description, &policy.IsActive,
		&policy.RepeatMaxTimes, &policy.CreatedAt, &policy.UpdatedAt, &policy.CreatedBy)
	if err != nil {
		return policy, fmt.Errorf("failed to get escalation policy: %w", err)
	}

	return policy, nil
}

// GetEscalationPolicyWithLevels retrieves a policy with all its escalation levels
func (s *EscalationService) GetEscalationPolicyWithLevels(id string) (db.EscalationPolicyWithLevels, error) {
	var result db.EscalationPolicyWithLevels

	// Get the policy
	policy, err := s.GetEscalationPolicy(id)
	if err != nil {
		return result, err
	}
	result.EscalationPolicy = policy

	// Get the levels
	levels, err := s.GetEscalationLevels(id)
	if err != nil {
		return result, err
	}
	result.Levels = levels

	return result, nil
}

// GetEscalationPolicyDetail retrieves a policy with complete details including levels and target information
func (s *EscalationService) GetEscalationPolicyDetail(id string) (db.EscalationPolicyWithLevels, error) {
	var result db.EscalationPolicyWithLevels

	// Validate input
	if id == "" {
		log.Println("Error: Policy ID cannot be empty")
		return result, fmt.Errorf("policy ID cannot be empty")
	}

	log.Printf("Getting escalation policy detail for ID: %s", id)

	// Get the policy with all fields including group_id and escalate_after_minutes
	query := `
		SELECT id, name, description, is_active, repeat_max_times, 
			   created_at, updated_at, COALESCE(created_by, '') as created_by,
			   COALESCE(escalate_after_minutes, 0) as escalate_after_minutes,
			   group_id
		FROM escalation_policies 
		WHERE id = $1`

	err := s.PG.QueryRow(query, id).Scan(
		&result.ID, &result.Name, &result.Description, &result.IsActive,
		&result.RepeatMaxTimes, &result.CreatedAt, &result.UpdatedAt, &result.CreatedBy,
		&result.EscalateAfterMinutes, &result.GroupID)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("Escalation policy not found: %s", id)
			return result, fmt.Errorf("escalation policy not found: %s", id)
		}
		log.Printf("Error getting escalation policy detail: %v (ID: %s)", err, id)
		return result, fmt.Errorf("failed to get escalation policy: %w", err)
	}

	log.Printf("Found policy: %s (Group: %s)", result.Name, result.GroupID)

	// Get the levels with detailed information
	levels, err := s.GetEscalationLevelsWithTargetInfo(id, result.GroupID)
	if err != nil {
		log.Printf("Error getting escalation levels for policy %s: %v", id, err)
		return result, fmt.Errorf("failed to get escalation levels: %w", err)
	}
	result.Levels = levels

	log.Printf("Loaded %d escalation levels for policy %s", len(levels), result.Name)

	return result, nil
}

// GetEscalationPolicyDetailWithSteps retrieves a policy with grouped steps (UI-friendly format)
func (s *EscalationService) GetEscalationPolicyDetailWithSteps(id string) (EscalationPolicyWithSteps, error) {
	var result EscalationPolicyWithSteps

	// Get the basic policy detail first
	policyWithLevels, err := s.GetEscalationPolicyDetail(id)
	if err != nil {
		return result, err
	}

	// Copy the policy data
	result.EscalationPolicy = policyWithLevels.EscalationPolicy

	// Group levels by step number
	stepMap := make(map[int][]db.EscalationLevel)
	for _, level := range policyWithLevels.Levels {
		stepMap[level.LevelNumber] = append(stepMap[level.LevelNumber], level)
	}

	// Convert to grouped steps
	var steps []EscalationStep
	for stepNumber := 1; stepNumber <= len(stepMap); stepNumber++ {
		if levels, exists := stepMap[stepNumber]; exists {
			var targets []EscalationTarget
			var escalateAfterMinutes int
			var messageTemplate string

			for _, level := range levels {
				targets = append(targets, EscalationTarget{
					Type:        level.TargetType,
					TargetID:    level.TargetID,
					Name:        level.TargetName,
					Description: level.TargetDescription,
				})

				// Use the first level's timeout and message (they should be the same for all targets in a step)
				if escalateAfterMinutes == 0 {
					escalateAfterMinutes = level.GetEffectiveTimeout(result.EscalateAfterMinutes)
					messageTemplate = level.MessageTemplate
				}
			}

			steps = append(steps, EscalationStep{
				StepNumber:           stepNumber,
				Targets:              targets,
				EscalateAfterMinutes: escalateAfterMinutes,
				MessageTemplate:      messageTemplate,
			})
		}
	}

	result.Steps = steps

	log.Printf("Converted %d levels into %d grouped steps for policy %s", len(policyWithLevels.Levels), len(steps), result.Name)

	return result, nil
}

// GetEscalationLevelsWithTargetInfo retrieves levels with populated target names and descriptions
func (s *EscalationService) GetEscalationLevelsWithTargetInfo(policyID, groupID string) ([]db.EscalationLevel, error) {
	var levels []db.EscalationLevel

	// Validate input
	if policyID == "" {
		log.Println("Error: Policy ID cannot be empty for escalation levels query")
		return levels, fmt.Errorf("policy ID cannot be empty")
	}

	log.Printf("Getting escalation levels for policy ID: %s", policyID)

	query := `
		SELECT id, policy_id, level_number, target_type, target_id,
			   timeout_minutes, notification_methods, message_template, created_at
		FROM escalation_levels 
		WHERE policy_id = $1 
		ORDER BY level_number ASC`

	rows, err := s.PG.Query(query, policyID)
	if err != nil {
		log.Printf("Error querying escalation levels for policy %s: %v", policyID, err)
		return levels, fmt.Errorf("failed to query escalation levels: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var level db.EscalationLevel
		var notificationMethodsJSON []byte
		var targetID sql.NullString

		err := rows.Scan(
			&level.ID, &level.PolicyID, &level.LevelNumber, &level.TargetType, &targetID,
			&level.TimeoutMinutes, &notificationMethodsJSON, &level.MessageTemplate, &level.CreatedAt)
		if err != nil {
			return levels, fmt.Errorf("failed to scan escalation level: %w", err)
		}

		// Handle NULL target_id
		if targetID.Valid {
			level.TargetID = targetID.String
		} else {
			level.TargetID = ""
		}

		// Deserialize notification methods
		if err := json.Unmarshal(notificationMethodsJSON, &level.NotificationMethods); err != nil {
			level.NotificationMethods = []string{"email"} // fallback
		}

		// Populate target information based on target type
		s.populateTargetInfoForLevel(&level, groupID)

		levels = append(levels, level)
	}

	return levels, nil
}

// populateTargetInfoForLevel populates target name and description for a single level
func (s *EscalationService) populateTargetInfoForLevel(level *db.EscalationLevel, groupID string) {
	log.Printf("Populating target info for level %d, type: %s, target_id: '%s'", level.LevelNumber, level.TargetType, level.TargetID)

	switch level.TargetType {
	case "user":
		if level.TargetID != "" && level.TargetID != "null" && len(strings.TrimSpace(level.TargetID)) > 0 {
			// Get user information
			query := `SELECT name, email FROM users WHERE id = $1`
			var userName, userEmail string
			if err := s.PG.QueryRow(query, level.TargetID).Scan(&userName, &userEmail); err == nil {
				level.TargetName = userName
				level.TargetDescription = userEmail
				log.Printf("Found user: %s (%s)", userName, userEmail)
			} else {
				log.Printf("User not found for ID: %s, error: %v", level.TargetID, err)
				level.TargetName = "Unknown User"
				level.TargetDescription = level.TargetID
			}
		} else {
			level.TargetName = "No User Selected"
			level.TargetDescription = "No user target specified"
		}
	case "group":
		if level.TargetID != "" && level.TargetID != "null" && len(strings.TrimSpace(level.TargetID)) > 0 {
			// Get group information
			query := `SELECT name, description FROM groups WHERE id = $1`
			var groupName, groupDesc string
			if err := s.PG.QueryRow(query, level.TargetID).Scan(&groupName, &groupDesc); err == nil {
				level.TargetName = groupName
				level.TargetDescription = groupDesc
				log.Printf("Found group: %s", groupName)
			} else {
				log.Printf("Group not found for ID: %s, error: %v", level.TargetID, err)
				level.TargetName = "Unknown Group"
				level.TargetDescription = level.TargetID
			}
		} else {
			level.TargetName = "No Group Selected"
			level.TargetDescription = "No group target specified"
		}
	case "scheduler":
		if level.TargetID != "" && level.TargetID != "null" && len(strings.TrimSpace(level.TargetID)) > 0 {
			// Validate groupID as well since it's used in the query
			if groupID != "" && groupID != "null" && len(strings.TrimSpace(groupID)) > 0 {
				// Get scheduler information
				query := `SELECT name, description FROM schedulers WHERE id = $1 AND group_id = $2 AND is_active = true`
				var schedulerName, schedulerDesc string
				if err := s.PG.QueryRow(query, level.TargetID, groupID).Scan(&schedulerName, &schedulerDesc); err == nil {
					level.TargetName = schedulerName
					level.TargetDescription = schedulerDesc
					log.Printf("Found scheduler: %s", schedulerName)
				} else {
					log.Printf("Scheduler not found for ID: %s, group: %s, error: %v", level.TargetID, groupID, err)
					level.TargetName = "Unknown or Inactive"
					level.TargetDescription = level.TargetID
				}
			} else {
				log.Printf("Invalid group ID for scheduler lookup: '%s'", groupID)
				level.TargetName = "Invalid Group"
				level.TargetDescription = "Cannot lookup scheduler without valid group"
			}
		} else {
			level.TargetName = "No Scheduler Selected"
			level.TargetDescription = "No scheduler target specified"
		}
	case "current_schedule":
		level.TargetName = "Current On-Call"
		level.TargetDescription = "Currently scheduled person(s)"
	case "external":
		if level.TargetID != "" && level.TargetID != "null" && len(strings.TrimSpace(level.TargetID)) > 0 {
			level.TargetName = "External Webhook"
			level.TargetDescription = level.TargetID
		} else {
			level.TargetName = "External"
			level.TargetDescription = "External notification"
		}
	default:
		level.TargetName = level.TargetType
		level.TargetDescription = level.TargetID
	}

	log.Printf("Target info populated: %s - %s", level.TargetName, level.TargetDescription)
}

// GetEscalationLevels retrieves all levels for a policy, ordered by level_number
func (s *EscalationService) GetEscalationLevels(policyID string) ([]db.EscalationLevel, error) {
	var levels []db.EscalationLevel

	query := `
		SELECT id, policy_id, level_number, target_type, target_id,
			   timeout_minutes, notification_methods, message_template, created_at
		FROM escalation_levels 
		WHERE policy_id = $1 
		ORDER BY level_number ASC`

	rows, err := s.PG.Query(query, policyID)
	if err != nil {
		return levels, fmt.Errorf("failed to query escalation levels: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var level db.EscalationLevel
		var notificationMethodsJSON []byte
		var targetID sql.NullString

		err := rows.Scan(
			&level.ID, &level.PolicyID, &level.LevelNumber, &level.TargetType, &targetID,
			&level.TimeoutMinutes, &notificationMethodsJSON, &level.MessageTemplate, &level.CreatedAt)
		if err != nil {
			return levels, fmt.Errorf("failed to scan escalation level: %w", err)
		}

		// Handle NULL target_id
		if targetID.Valid {
			level.TargetID = targetID.String
		} else {
			level.TargetID = ""
		}

		// Deserialize notification methods
		if err := json.Unmarshal(notificationMethodsJSON, &level.NotificationMethods); err != nil {
			level.NotificationMethods = []string{"email"} // fallback
		}

		levels = append(levels, level)
	}

	return levels, nil
}

// ListEscalationPolicies retrieves all escalation policies
func (s *EscalationService) ListEscalationPolicies(activeOnly bool) ([]db.EscalationPolicy, error) {
	var policies []db.EscalationPolicy

	query := `
		SELECT id, name, description, is_active, repeat_max_times, 
			   created_at, updated_at, COALESCE(created_by, '') as created_by
		FROM escalation_policies`

	args := []interface{}{}
	if activeOnly {
		query += " WHERE is_active = $1"
		args = append(args, true)
	}

	query += " ORDER BY created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return policies, fmt.Errorf("failed to query escalation policies: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var policy db.EscalationPolicy
		err := rows.Scan(
			&policy.ID, &policy.Name, &policy.Description, &policy.IsActive,
			&policy.RepeatMaxTimes, &policy.CreatedAt, &policy.UpdatedAt, &policy.CreatedBy)
		if err != nil {
			return policies, fmt.Errorf("failed to scan escalation policy: %w", err)
		}
		policies = append(policies, policy)
	}

	return policies, nil
}

// GetGroupEscalationPolicies retrieves escalation policies for a group with usage statistics
func (s *EscalationService) GetGroupEscalationPolicies(groupID string, activeOnly bool) ([]EscalationPolicyWithUsage, error) {
	var policiesWithUsage []EscalationPolicyWithUsage

	query := `
		SELECT 
			ep.id, ep.name, ep.description, ep.is_active, ep.repeat_max_times,
			ep.created_at, ep.updated_at, COALESCE(ep.created_by, '') as created_by,
			COALESCE(usage.services_count, 0) as services_count
		FROM escalation_policies ep
		LEFT JOIN (
			SELECT escalation_policy_id, COUNT(*) as services_count
			FROM services 
			WHERE group_id = $1 AND is_active = true AND escalation_policy_id IS NOT NULL
			GROUP BY escalation_policy_id
		) usage ON ep.id = usage.escalation_policy_id`

	args := []interface{}{groupID}
	if activeOnly {
		query += " WHERE ep.is_active = $2"
		args = append(args, true)
	}

	query += " ORDER BY ep.created_at DESC"

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return policiesWithUsage, fmt.Errorf("failed to query group escalation policies: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var policyWithUsage EscalationPolicyWithUsage
		err := rows.Scan(
			&policyWithUsage.ID, &policyWithUsage.Name, &policyWithUsage.Description,
			&policyWithUsage.IsActive, &policyWithUsage.RepeatMaxTimes,
			&policyWithUsage.CreatedAt, &policyWithUsage.UpdatedAt, &policyWithUsage.CreatedBy,
			&policyWithUsage.ServicesCount)
		if err != nil {
			return policiesWithUsage, fmt.Errorf("failed to scan escalation policy with usage: %w", err)
		}
		policiesWithUsage = append(policiesWithUsage, policyWithUsage)
	}

	return policiesWithUsage, nil
}

// GetServicesByEscalationPolicy retrieves all services using a specific escalation policy
func (s *EscalationService) GetServicesByEscalationPolicy(policyID string) ([]db.Service, error) {
	var services []db.Service

	query := `
		SELECT id, group_id, name, description, routing_key, 
			   routing_conditions, COALESCE(escalation_policy_id, '') as escalation_policy_id,
			   is_active, created_at, updated_at, COALESCE(created_by, '') as created_by
		FROM services 
		WHERE escalation_policy_id = $1 AND is_active = true
		ORDER BY created_at DESC`

	rows, err := s.PG.Query(query, policyID)
	if err != nil {
		return services, fmt.Errorf("failed to query services by escalation policy: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var service db.Service
		var routingConditionsJSON []byte

		err := rows.Scan(
			&service.ID, &service.GroupID, &service.Name, &service.Description, &service.RoutingKey,
			&routingConditionsJSON, &service.EscalationPolicyID, &service.IsActive,
			&service.CreatedAt, &service.UpdatedAt, &service.CreatedBy)
		if err != nil {
			return services, fmt.Errorf("failed to scan service: %w", err)
		}

		// Deserialize routing conditions
		if len(routingConditionsJSON) > 0 {
			if err := json.Unmarshal(routingConditionsJSON, &service.RoutingConditions); err != nil {
				service.RoutingConditions = make(map[string]interface{})
			}
		} else {
			service.RoutingConditions = make(map[string]interface{})
		}

		services = append(services, service)
	}

	return services, nil
}

// ==========================================
// DATADOG-STYLE ALERT ROUTING & ESCALATION
// ==========================================

// ProcessAlert handles incoming alerts with Datadog-style routing and escalation
func (s *EscalationService) ProcessAlert(alert *db.Alert) error {
	log.Printf("Processing alert: %s with Datadog-style routing", alert.Title)

	// Step 1: Find matching service based on routing conditions
	service, err := s.findServiceByRoutingConditions(alert)
	if err != nil {
		return fmt.Errorf("failed to find service for alert: %w", err)
	}

	if service == nil {
		log.Printf("No service matched alert routing conditions, skipping escalation")
		return nil
	}

	// Step 2: Get escalation policy for the service
	if service.EscalationPolicyID == "" {
		log.Printf("Service %s has no escalation policy assigned", service.Name)
		return nil
	}

	policy, err := s.GetEscalationPolicyWithLevels(service.EscalationPolicyID)
	if err != nil {
		return fmt.Errorf("failed to get escalation policy: %w", err)
	}

	if !policy.IsActive {
		log.Printf("Escalation policy %s is not active", policy.Name)
		return nil
	}

	// Step 3: Start escalation chain
	return s.startEscalationChain(alert, &policy)
}

// findServiceByRoutingConditions finds a service that matches the alert's properties
func (s *EscalationService) findServiceByRoutingConditions(alert *db.Alert) (*db.Service, error) {
	// This is a simplified implementation
	// In a full Datadog implementation, this would evaluate complex routing conditions

	query := `
		SELECT id, group_id, name, description, routing_key, 
			   routing_conditions, COALESCE(escalation_policy_id, '') as escalation_policy_id,
			   is_active, created_at, updated_at, COALESCE(created_by, '') as created_by
		FROM services 
		WHERE group_id = $1 AND is_active = true AND escalation_policy_id IS NOT NULL
		LIMIT 1`

	row := s.PG.QueryRow(query, alert.GroupID)

	var service db.Service
	var routingConditionsJSON []byte

	err := row.Scan(
		&service.ID, &service.GroupID, &service.Name, &service.Description, &service.RoutingKey,
		&routingConditionsJSON, &service.EscalationPolicyID, &service.IsActive,
		&service.CreatedAt, &service.UpdatedAt, &service.CreatedBy)

	if err == sql.ErrNoRows {
		return nil, nil // No matching service found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to scan service: %w", err)
	}

	// Deserialize routing conditions
	if len(routingConditionsJSON) > 0 {
		if err := json.Unmarshal(routingConditionsJSON, &service.RoutingConditions); err != nil {
			service.RoutingConditions = make(map[string]interface{})
		}
	} else {
		service.RoutingConditions = make(map[string]interface{})
	}

	return &service, nil
}

// startEscalationChain begins the Datadog-style escalation process
func (s *EscalationService) startEscalationChain(alert *db.Alert, policy *db.EscalationPolicyWithLevels) error {
	if len(policy.Levels) == 0 {
		return fmt.Errorf("escalation policy %s has no levels defined", policy.Name)
	}

	log.Printf("Starting escalation chain for alert %s using policy %s", alert.Title, policy.Name)

	// Execute Step 1 immediately (all targets in parallel)
	return s.executeEscalationStep(alert, policy, 1)
}

// executeEscalationStep executes all targets in a specific escalation step in parallel
func (s *EscalationService) executeEscalationStep(alert *db.Alert, policy *db.EscalationPolicyWithLevels, stepNumber int) error {
	log.Printf("Executing escalation step %d for alert %s", stepNumber, alert.Title)

	// Find all targets in this step (same level_number = step number)
	var stepTargets []db.EscalationLevel
	for _, level := range policy.Levels {
		if level.LevelNumber == stepNumber {
			stepTargets = append(stepTargets, level)
		}
	}

	if len(stepTargets) == 0 {
		return fmt.Errorf("no targets found for escalation step %d", stepNumber)
	}

	log.Printf("Found %d targets for step %d", len(stepTargets), stepNumber)

	// Execute all targets in parallel
	var errors []string
	var successCount int

	for _, target := range stepTargets {
		err := s.executeEscalationLevel(alert, policy, &target)
		if err != nil {
			errors = append(errors, fmt.Sprintf("target %s (%s): %v", target.TargetID, target.TargetType, err))
		} else {
			successCount++
		}
	}

	// Log results
	log.Printf("Step %d execution completed: %d/%d targets succeeded", stepNumber, successCount, len(stepTargets))

	if len(errors) > 0 {
		log.Printf("Some targets failed in step %d: %v", stepNumber, errors)
	}

	// Schedule next step if current step has at least one success
	if successCount > 0 {
		nextStepNumber := stepNumber + 1
		// Check if next step exists
		hasNextStep := false
		for _, level := range policy.Levels {
			if level.LevelNumber == nextStepNumber {
				hasNextStep = true
				break
			}
		}

		if hasNextStep {
			// Get timeout from first target (they should all have the same timeout for the same step)
			timeout := stepTargets[0].GetEffectiveTimeout(policy.EscalateAfterMinutes)
			delay := time.Duration(timeout) * time.Minute
			s.scheduleNextEscalationStep(alert, policy, nextStepNumber, delay)
		}
	}

	// Return error only if ALL targets failed
	if successCount == 0 {
		return fmt.Errorf("all targets failed in step %d: %v", stepNumber, errors)
	}

	return nil
}

// executeEscalationLevel executes a single escalation level
func (s *EscalationService) executeEscalationLevel(alert *db.Alert, policy *db.EscalationPolicyWithLevels, level *db.EscalationLevel) error {
	log.Printf("Executing escalation level %d for alert %s", level.LevelNumber, alert.Title)

	// Create escalation record
	escalation := db.AlertEscalation{
		ID:                 uuid.New().String(),
		AlertID:            alert.ID,
		EscalationPolicyID: policy.ID,
		EscalationLevel:    level.LevelNumber,
		TargetType:         level.TargetType,
		TargetID:           level.TargetID,
		Status:             "executing",
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}

	// Save escalation record
	if err := s.saveEscalation(escalation); err != nil {
		return fmt.Errorf("failed to save escalation: %w", err)
	}

	// Execute notification based on target type
	var err error
	switch level.TargetType {
	case "current_schedule":
		err = s.notifyCurrentSchedule(alert, level.NotificationMethods)
	case "scheduler":
		err = s.notifyScheduler(alert, level.TargetID, level.NotificationMethods)
	case "user":
		err = s.notifyUser(alert, level.TargetID, level.NotificationMethods)
	case "group":
		err = s.notifyGroup(alert, level.TargetID, level.NotificationMethods)
	case "external":
		err = s.notifyExternal(alert, level.TargetID, level.NotificationMethods)
	default:
		err = fmt.Errorf("unknown target type: %s", level.TargetType)
	}

	// Update escalation status
	status := "completed"
	errorMessage := ""
	if err != nil {
		status = "failed"
		errorMessage = err.Error()
		log.Printf("Escalation level %d failed: %v", level.LevelNumber, err)
	}

	if err := s.updateEscalationStatus(escalation.ID, status, errorMessage); err != nil {
		log.Printf("Failed to update escalation status: %v", err)
	}

	// Note: Next step scheduling is handled by executeEscalationStep
	// This function only executes individual targets within a step

	return err
}

// Helper notification methods
func (s *EscalationService) notifyCurrentSchedule(alert *db.Alert, methods []string) error {
	// TODO: Implement current schedule notification
	log.Printf("Notifying current schedule for alert %s via %v", alert.Title, methods)
	return nil
}

func (s *EscalationService) notifyScheduler(alert *db.Alert, schedulerID string, methods []string) error {
	log.Printf("Notifying scheduler %s for alert %s via %v", schedulerID, alert.Title, methods)

	// Get current shifts for this scheduler
	query := `
		SELECT DISTINCT s.user_id, u.name, u.email
		FROM shifts s
		JOIN users u ON s.user_id = u.id
		WHERE s.scheduler_id = $1 
		AND s.group_id = $2
		AND s.is_active = true
		AND s.start_time <= NOW()
		AND s.end_time >= NOW()
	`

	rows, err := s.PG.Query(query, schedulerID, alert.GroupID)
	if err != nil {
		return fmt.Errorf("failed to query scheduler users: %w", err)
	}
	defer rows.Close()

	var notifiedUsers []string
	var errors []string

	for rows.Next() {
		var userID, userName, userEmail string
		if err := rows.Scan(&userID, &userName, &userEmail); err != nil {
			log.Printf("Error scanning scheduler user: %v", err)
			continue
		}

		// Notify each user currently on shift for this scheduler
		if err := s.notifyUser(alert, userID, methods); err != nil {
			errors = append(errors, fmt.Sprintf("failed to notify user %s: %v", userName, err))
		} else {
			notifiedUsers = append(notifiedUsers, userName)
		}
	}

	if len(notifiedUsers) == 0 {
		return fmt.Errorf("no users currently on-call for scheduler %s", schedulerID)
	}

	log.Printf("Successfully notified %d users for scheduler %s: %v", len(notifiedUsers), schedulerID, notifiedUsers)

	if len(errors) > 0 {
		log.Printf("Some notifications failed: %v", errors)
		// Return error only if ALL notifications failed
		if len(errors) == len(notifiedUsers)+len(errors) {
			return fmt.Errorf("all notifications failed: %v", errors)
		}
	}

	return nil
}

func (s *EscalationService) notifyUser(alert *db.Alert, userID string, methods []string) error {
	// TODO: Implement user notification
	log.Printf("Notifying user %s for alert %s via %v", userID, alert.Title, methods)
	return nil
}

func (s *EscalationService) notifyGroup(alert *db.Alert, groupID string, methods []string) error {
	// TODO: Implement group notification
	log.Printf("Notifying group %s for alert %s via %v", groupID, alert.Title, methods)
	return nil
}

func (s *EscalationService) notifyExternal(alert *db.Alert, target string, methods []string) error {
	// TODO: Implement external notification (webhooks, etc.)
	log.Printf("Notifying external target %s for alert %s via %v", target, alert.Title, methods)
	return nil
}

// scheduleNextEscalationStep schedules the next escalation step (all targets in parallel)
func (s *EscalationService) scheduleNextEscalationStep(alert *db.Alert, policy *db.EscalationPolicyWithLevels, stepNumber int, delay time.Duration) {
	// TODO: Implement escalation scheduling using Redis or background jobs
	log.Printf("Scheduling next escalation step %d in %v for alert %s", stepNumber, delay, alert.Title)
}

// scheduleNextEscalation schedules the next escalation level (legacy - for backward compatibility)
func (s *EscalationService) scheduleNextEscalation(alert *db.Alert, policy *db.EscalationPolicyWithLevels, nextLevel *db.EscalationLevel, delay time.Duration) {
	// TODO: Implement escalation scheduling using Redis or background jobs
	log.Printf("Scheduling next escalation level %d in %v for alert %s", nextLevel.LevelNumber, delay, alert.Title)
}

// saveEscalation saves an escalation record to the database
func (s *EscalationService) saveEscalation(escalation db.AlertEscalation) error {
	query := `
		INSERT INTO alert_escalations (
			id, alert_id, escalation_policy_id, escalation_level, target_type, target_id,
			status, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	_, err := s.PG.Exec(query,
		escalation.ID, escalation.AlertID, escalation.EscalationPolicyID, escalation.EscalationLevel,
		escalation.TargetType, escalation.TargetID, escalation.Status, escalation.CreatedAt, escalation.UpdatedAt)

	return err
}

// updateEscalationStatus updates the status of an escalation
func (s *EscalationService) updateEscalationStatus(escalationID, status, errorMessage string) error {
	query := `UPDATE alert_escalations SET status = $1, error_message = $2, updated_at = $3 WHERE id = $4`
	_, err := s.PG.Exec(query, status, errorMessage, time.Now(), escalationID)
	return err
}

// GetAlertEscalations retrieves escalation history for an alert
func (s *EscalationService) GetAlertEscalations(alertID string) ([]db.AlertEscalation, error) {
	var escalations []db.AlertEscalation

	query := `
		SELECT id, alert_id, escalation_policy_id, escalation_level, target_type, target_id,
			   status, error_message, created_at, updated_at,
			   COALESCE(acknowledged_at, '1970-01-01'::timestamp) as acknowledged_at,
			   COALESCE(acknowledged_by, '') as acknowledged_by,
			   response_time_seconds, notification_methods, target_name
		FROM alert_escalations 
		WHERE alert_id = $1 
		ORDER BY created_at ASC`

	rows, err := s.PG.Query(query, alertID)
	if err != nil {
		return escalations, fmt.Errorf("failed to query alert escalations: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var escalation db.AlertEscalation
		var acknowledgedAtDummy time.Time
		var notificationMethodsJSON []byte

		err := rows.Scan(
			&escalation.ID, &escalation.AlertID, &escalation.EscalationPolicyID, &escalation.EscalationLevel,
			&escalation.TargetType, &escalation.TargetID, &escalation.Status, &escalation.ErrorMessage,
			&escalation.CreatedAt, &escalation.UpdatedAt, &acknowledgedAtDummy, &escalation.AcknowledgedBy,
			&escalation.ResponseTimeSeconds, &notificationMethodsJSON, &escalation.TargetName)
		if err != nil {
			return escalations, fmt.Errorf("failed to scan alert escalation: %w", err)
		}

		// Handle acknowledged_at
		if !acknowledgedAtDummy.Equal(time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)) {
			escalation.AcknowledgedAt = &acknowledgedAtDummy
		}

		// Deserialize notification methods
		if len(notificationMethodsJSON) > 0 {
			if err := json.Unmarshal(notificationMethodsJSON, &escalation.NotificationMethods); err != nil {
				escalation.NotificationMethods = []string{} // fallback
			}
		}

		escalations = append(escalations, escalation)
	}

	return escalations, nil
}
