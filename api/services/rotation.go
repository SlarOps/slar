package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type RotationService struct {
	PG *sql.DB
}

func NewRotationService(pg *sql.DB) *RotationService {
	return &RotationService{PG: pg}
}

// CreateRotationCycle creates a new rotation cycle and generates schedules automatically
func (s *RotationService) CreateRotationCycle(groupID string, req db.CreateRotationCycleRequest, createdBy string) (db.RotationCycleResponse, error) {
	var response db.RotationCycleResponse

	// Set defaults
	if req.RotationDays == 0 {
		switch req.RotationType {
		case "daily":
			req.RotationDays = 1
		case "weekly":
			req.RotationDays = 7
		default:
			req.RotationDays = 7 // Default to weekly
		}
	}

	if req.StartTime == "" {
		req.StartTime = "00:00"
	}
	if req.EndTime == "" {
		req.EndTime = "23:59"
	}
	if req.WeeksAhead == 0 {
		req.WeeksAhead = 52 // Generate 1 year by default
	}

	// Parse start date
	startDate, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		return response, fmt.Errorf("invalid start date format: %w", err)
	}

	// Validate member order
	if len(req.MemberOrder) < 2 {
		return response, fmt.Errorf("rotation requires at least 2 members")
	}

	// Convert member order to JSONB
	memberOrderJSON, err := json.Marshal(req.MemberOrder)
	if err != nil {
		return response, fmt.Errorf("failed to marshal member order: %w", err)
	}

	// Create rotation cycle
	rotationCycle := db.RotationCycle{
		ID:           uuid.New().String(),
		GroupID:      groupID,
		RotationType: req.RotationType,
		RotationDays: req.RotationDays,
		StartDate:    startDate,
		StartTime:    req.StartTime,
		EndTime:      req.EndTime,
		MemberOrder:  req.MemberOrder,
		IsActive:     true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
		CreatedBy:    createdBy,
	}

	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return response, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Insert rotation cycle
	_, err = tx.Exec(`
		INSERT INTO rotation_cycles (id, group_id, rotation_type, rotation_days, start_date, start_time, end_time, member_order, is_active, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, rotationCycle.ID, rotationCycle.GroupID, rotationCycle.RotationType, rotationCycle.RotationDays,
		rotationCycle.StartDate, rotationCycle.StartTime, rotationCycle.EndTime, string(memberOrderJSON),
		rotationCycle.IsActive, rotationCycle.CreatedAt, rotationCycle.UpdatedAt, rotationCycle.CreatedBy)

	if err != nil {
		return response, fmt.Errorf("failed to create rotation cycle: %w", err)
	}

	// Generate schedules using database function
	var schedulesCreated int
	err = tx.QueryRow("SELECT generate_rotation_schedules($1, $2)", rotationCycle.ID, req.WeeksAhead).Scan(&schedulesCreated)
	if err != nil {
		return response, fmt.Errorf("failed to generate schedules: %w", err)
	}

	// Commit transaction
	if err = tx.Commit(); err != nil {
		return response, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Get rotation cycle with members info
	rotationCycleWithMembers, err := s.GetRotationCycleWithMembers(rotationCycle.ID)
	if err != nil {
		return response, fmt.Errorf("failed to get rotation cycle with members: %w", err)
	}

	// Generate preview
	preview, err := s.GetRotationPreview(rotationCycle.ID, 4) // Preview next 4 weeks
	if err != nil {
		return response, fmt.Errorf("failed to generate preview: %w", err)
	}

	response.RotationCycle = rotationCycleWithMembers
	response.PreviewWeeks = preview
	response.SchedulesCreated = schedulesCreated

	return response, nil
}

// GetRotationCycleWithMembers gets rotation cycle with member information
func (s *RotationService) GetRotationCycleWithMembers(rotationCycleID string) (db.RotationCycle, error) {
	var cycle db.RotationCycle
	var memberOrderJSON string

	// Get rotation cycle
	err := s.PG.QueryRow(`
		SELECT id, group_id, rotation_type, rotation_days, start_date, start_time, end_time, 
		       member_order::text, is_active, created_at, updated_at, COALESCE(created_by, '')
		FROM rotation_cycles 
		WHERE id = $1
	`, rotationCycleID).Scan(
		&cycle.ID, &cycle.GroupID, &cycle.RotationType, &cycle.RotationDays,
		&cycle.StartDate, &cycle.StartTime, &cycle.EndTime, &memberOrderJSON,
		&cycle.IsActive, &cycle.CreatedAt, &cycle.UpdatedAt, &cycle.CreatedBy,
	)

	if err != nil {
		return cycle, fmt.Errorf("failed to get rotation cycle: %w", err)
	}

	// Parse member order
	err = json.Unmarshal([]byte(memberOrderJSON), &cycle.MemberOrder)
	if err != nil {
		return cycle, fmt.Errorf("failed to parse member order: %w", err)
	}

	// Get member details
	if len(cycle.MemberOrder) > 0 {
		placeholders := make([]string, len(cycle.MemberOrder))
		args := make([]interface{}, len(cycle.MemberOrder))
		for i, memberID := range cycle.MemberOrder {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
			args[i] = memberID
		}

		query := fmt.Sprintf(`
			SELECT id, name, email, COALESCE(team, '') 
			FROM users 
			WHERE id IN (%s) AND is_active = true
		`, strings.Join(placeholders, ","))

		rows, err := s.PG.Query(query, args...)
		if err != nil {
			return cycle, fmt.Errorf("failed to get member details: %w", err)
		}
		defer rows.Close()

		memberMap := make(map[string]db.RotationMember)
		for rows.Next() {
			var member db.RotationMember
			err := rows.Scan(&member.UserID, &member.UserName, &member.UserEmail, &member.UserTeam)
			if err != nil {
				return cycle, fmt.Errorf("failed to scan member: %w", err)
			}
			memberMap[member.UserID] = member
		}

		// Build ordered member list
		cycle.Members = make([]db.RotationMember, 0, len(cycle.MemberOrder))
		for i, memberID := range cycle.MemberOrder {
			if member, exists := memberMap[memberID]; exists {
				member.Order = i
				cycle.Members = append(cycle.Members, member)
			}
		}
	}

	return cycle, nil
}

// GetRotationPreview generates preview of rotation schedule
func (s *RotationService) GetRotationPreview(rotationCycleID string, weeks int) ([]db.RotationPreview, error) {
	var previews []db.RotationPreview

	query := `
		SELECT 
			ROW_NUMBER() OVER (ORDER BY os.start_time) as week_number,
			DATE(os.start_time) as start_date,
			DATE(os.end_time) as end_date,
			os.user_id,
			u.name as user_name,
			u.email as user_email
		FROM oncall_schedules os
		JOIN users u ON os.user_id = u.id
		WHERE os.rotation_cycle_id = $1 
		  AND os.is_active = true 
		  AND os.is_override = false
		  AND os.start_time >= NOW()
		ORDER BY os.start_time
		LIMIT $2
	`

	rows, err := s.PG.Query(query, rotationCycleID, weeks)
	if err != nil {
		return previews, fmt.Errorf("failed to get rotation preview: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var preview db.RotationPreview
		err := rows.Scan(
			&preview.WeekNumber, &preview.StartDate, &preview.EndDate,
			&preview.UserID, &preview.UserName, &preview.UserEmail,
		)
		if err != nil {
			return previews, fmt.Errorf("failed to scan preview: %w", err)
		}
		previews = append(previews, preview)
	}

	return previews, nil
}

// CreateScheduleOverride creates an override for an existing schedule
func (s *RotationService) CreateScheduleOverride(req db.CreateScheduleOverrideRequest, createdBy string) (string, error) {
	var overrideID string

	// Use database function to create override
	err := s.PG.QueryRow(
		"SELECT create_schedule_override($1, $2, $3, $4)",
		req.OriginalScheduleID, req.NewUserID, req.OverrideReason, createdBy,
	).Scan(&overrideID)

	if err != nil {
		return "", fmt.Errorf("failed to create schedule override: %w", err)
	}

	return overrideID, nil
}

// GetGroupRotationCycles gets all rotation cycles for a group
func (s *RotationService) GetGroupRotationCycles(groupID string) ([]db.RotationCycle, error) {
	var cycles []db.RotationCycle

	query := `
		SELECT id, group_id, rotation_type, rotation_days, start_date, start_time, end_time, 
		       member_order::text, is_active, created_at, updated_at, COALESCE(created_by, '')
		FROM rotation_cycles 
		WHERE group_id = $1 
		ORDER BY created_at DESC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return cycles, fmt.Errorf("failed to get rotation cycles: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var cycle db.RotationCycle
		var memberOrderJSON string

		err := rows.Scan(
			&cycle.ID, &cycle.GroupID, &cycle.RotationType, &cycle.RotationDays,
			&cycle.StartDate, &cycle.StartTime, &cycle.EndTime, &memberOrderJSON,
			&cycle.IsActive, &cycle.CreatedAt, &cycle.UpdatedAt, &cycle.CreatedBy,
		)
		if err != nil {
			return cycles, fmt.Errorf("failed to scan rotation cycle: %w", err)
		}

		// Parse member order
		err = json.Unmarshal([]byte(memberOrderJSON), &cycle.MemberOrder)
		if err != nil {
			return cycles, fmt.Errorf("failed to parse member order: %w", err)
		}

		cycles = append(cycles, cycle)
	}

	return cycles, nil
}

// GetCurrentRotationMember gets currently on-call member for a rotation cycle
func (s *RotationService) GetCurrentRotationMember(rotationCycleID string) (*db.Shift, error) {
	var schedule db.Shift
	var originalUserID, overrideReason sql.NullString

	query := `
		SELECT 
			os.id, os.rotation_cycle_id, os.group_id, os.user_id, os.schedule_type,
			os.start_time, os.end_time, os.is_active, os.is_recurring, os.rotation_days,
			os.is_override, os.original_user_id, os.override_reason,
			os.created_at, os.updated_at, COALESCE(os.created_by, ''),
			u.name, u.email, COALESCE(u.team, '')
		FROM oncall_schedules os
		JOIN users u ON os.user_id = u.id
		WHERE os.rotation_cycle_id = $1
		  AND os.is_active = true
		  AND NOW() BETWEEN os.start_time AND os.end_time
		ORDER BY os.start_time
		LIMIT 1
	`

	err := s.PG.QueryRow(query, rotationCycleID).Scan(
		&schedule.ID, &schedule.RotationCycleID, &schedule.GroupID, &schedule.UserID,
		&schedule.ShiftType, &schedule.StartTime, &schedule.EndTime,
		&schedule.IsActive, &schedule.IsRecurring, &schedule.RotationDays,
		&schedule.IsOverridden, &originalUserID, &overrideReason,
		&schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
		&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // No one currently on-call
		}
		return nil, fmt.Errorf("failed to get current rotation member: %w", err)
	}

	// Handle nullable fields
	if originalUserID.Valid {
		schedule.OriginalUserID = &originalUserID.String
	}
	if overrideReason.Valid {
		schedule.OverrideReason = &overrideReason.String
	}

	// Get original user name if this is an override
	if schedule.IsOverridden && schedule.OriginalUserID != nil {
		var originalUserName string
		err = s.PG.QueryRow("SELECT name FROM users WHERE id = $1", *schedule.OriginalUserID).Scan(&originalUserName)
		if err == nil {
			schedule.OriginalUserName = &originalUserName
		}
	}

	return &schedule, nil
}

// DeactivateRotationCycle deactivates a rotation cycle and its future schedules
func (s *RotationService) DeactivateRotationCycle(rotationCycleID string) error {
	tx, err := s.PG.Begin()
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Deactivate rotation cycle
	_, err = tx.Exec("UPDATE rotation_cycles SET is_active = false, updated_at = NOW() WHERE id = $1", rotationCycleID)
	if err != nil {
		return fmt.Errorf("failed to deactivate rotation cycle: %w", err)
	}

	// Deactivate future schedules (don't affect current/past schedules)
	_, err = tx.Exec(`
		UPDATE oncall_schedules 
		SET is_active = false, updated_at = NOW() 
		WHERE rotation_cycle_id = $1 AND start_time > NOW()
	`, rotationCycleID)
	if err != nil {
		return fmt.Errorf("failed to deactivate future schedules: %w", err)
	}

	return tx.Commit()
}
