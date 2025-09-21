package services

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

type OverrideService struct {
	PG *sql.DB
}

func NewOverrideService(pg *sql.DB) *OverrideService {
	return &OverrideService{PG: pg}
}

// CreateOverride creates a new schedule override
func (s *OverrideService) CreateOverride(req db.CreateScheduleOverrideRequest, createdBy string) (db.ScheduleOverride, error) {
	override := db.ScheduleOverride{
		ID:                 uuid.New().String(),
		OriginalScheduleID: req.OriginalScheduleID,
		NewUserID:          req.NewUserID,
		OverrideReason:     req.OverrideReason,
		OverrideType:       req.OverrideType,
		OverrideStartTime:  req.OverrideStartTime,
		OverrideEndTime:    req.OverrideEndTime,
		IsActive:           true,
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
		CreatedBy:          createdBy,
	}

	// Validate override type
	if override.OverrideType != "temporary" && override.OverrideType != "permanent" && override.OverrideType != "emergency" {
		override.OverrideType = "temporary" // Default
	}

	// Validate time range
	if override.OverrideEndTime.Before(override.OverrideStartTime) {
		return override, fmt.Errorf("override end time must be after start time")
	}

	// Get group_id and original user from schedule
	var originalUserID string
	err := s.PG.QueryRow(`
		SELECT group_id, user_id FROM shifts WHERE id = $1 AND is_active = true
	`, override.OriginalScheduleID).Scan(&override.GroupID, &originalUserID)

	if err != nil {
		return override, fmt.Errorf("original schedule not found: %w", err)
	}

	// Validate that override user is different from original user
	if override.NewUserID == originalUserID {
		return override, fmt.Errorf("cannot override schedule with the same user - override user must be different from original user")
	}

	// Create the override
	_, err = s.PG.Exec(`
		INSERT INTO schedule_overrides (id, original_schedule_id, group_id, new_user_id, 
			override_reason, override_type, override_start_time, override_end_time, 
			is_active, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, override.ID, override.OriginalScheduleID, override.GroupID, override.NewUserID,
		override.OverrideReason, override.OverrideType, override.OverrideStartTime,
		override.OverrideEndTime, override.IsActive, override.CreatedAt, override.UpdatedAt, override.CreatedBy)

	if err != nil {
		return override, fmt.Errorf("failed to create override: %w", err)
	}

	// Get user info for response
	err = s.PG.QueryRow(`
		SELECT u.name, u.email 
		FROM users u 
		WHERE u.id = $1
	`, override.NewUserID).Scan(&override.NewUserName, &override.NewUserEmail)

	if err != nil {
		fmt.Printf("Warning: failed to get user info for override %s: %v\n", override.ID, err)
	}

	return override, nil
}

// ListOverrides returns all overrides for a group
func (s *OverrideService) ListOverrides(groupID string) ([]db.ScheduleOverride, error) {
	query := `
		SELECT so.id, so.original_schedule_id, so.group_id, so.new_user_id,
		       so.override_reason, so.override_type, so.override_start_time, so.override_end_time,
		       so.is_active, so.created_at, so.updated_at, so.created_by,
		       u.name as new_user_name, u.email as new_user_email
		FROM schedule_overrides so
		JOIN users u ON so.new_user_id = u.id
		WHERE so.group_id = $1 AND so.is_active = true
		ORDER BY so.override_start_time ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to query overrides: %w", err)
	}
	defer rows.Close()

	var overrides []db.ScheduleOverride
	for rows.Next() {
		var override db.ScheduleOverride
		var overrideReason sql.NullString

		err := rows.Scan(
			&override.ID, &override.OriginalScheduleID, &override.GroupID, &override.NewUserID,
			&overrideReason, &override.OverrideType, &override.OverrideStartTime, &override.OverrideEndTime,
			&override.IsActive, &override.CreatedAt, &override.UpdatedAt, &override.CreatedBy,
			&override.NewUserName, &override.NewUserEmail,
		)
		if err != nil {
			continue
		}

		if overrideReason.Valid {
			override.OverrideReason = &overrideReason.String
		}

		overrides = append(overrides, override)
	}

	return overrides, nil
}

// DeleteOverride deactivates an override (soft delete)
func (s *OverrideService) DeleteOverride(overrideID string) error {
	_, err := s.PG.Exec(`
		UPDATE schedule_overrides 
		SET is_active = false, updated_at = $2
		WHERE id = $1
	`, overrideID, time.Now())

	if err != nil {
		return fmt.Errorf("failed to deactivate override: %w", err)
	}

	return nil
}

// ListEffectiveSchedules returns schedules with overrides applied
func (s *OverrideService) ListEffectiveSchedules(groupID string) ([]db.Shift, error) {
	query := `
		SELECT es.schedule_id, es.group_id, es.effective_user_id, es.shift_type, 
		       es.start_time, es.end_time, es.is_active, es.is_recurring, es.rotation_days,
		       es.rotation_cycle_id, es.override_id, es.override_reason, es.override_type, 
		       es.is_overridden, es.is_full_override,
		       es.effective_user_name, es.effective_user_email, es.effective_user_team,
		       es.original_user_id, es.original_user_name, es.original_user_email, es.original_user_team,
		       es.override_user_name, es.override_user_email, es.override_user_team,
		       es.override_start_time, es.override_end_time,
		       es.created_at, es.updated_at, es.created_by
		FROM effective_schedules es
		WHERE es.group_id = $1
		ORDER BY es.start_time ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to query effective schedules: %w", err)
	}
	defer rows.Close()

	var schedules []db.Shift
	for rows.Next() {
		var schedule db.Shift
		var rotationCycleID, overrideID, overrideReason, overrideType sql.NullString
		var originalUserID, originalUserName, originalUserEmail, originalUserTeam sql.NullString
		var overrideUserName, overrideUserEmail, overrideUserTeam sql.NullString
		var overrideStartTime, overrideEndTime sql.NullTime

		err := rows.Scan(
			&schedule.ID, &schedule.GroupID, &schedule.EffectiveUserID, &schedule.ShiftType,
			&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring, &schedule.RotationDays,
			&rotationCycleID, &overrideID, &overrideReason, &overrideType,
			&schedule.IsOverridden, &schedule.IsFullOverride,
			&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
			&originalUserID, &originalUserName, &originalUserEmail, &originalUserTeam,
			&overrideUserName, &overrideUserEmail, &overrideUserTeam,
			&overrideStartTime, &overrideEndTime,
			&schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
		)
		if err != nil {
			continue
		}

		// Handle nullable fields
		if rotationCycleID.Valid {
			schedule.RotationCycleID = &rotationCycleID.String
		}
		if overrideID.Valid {
			schedule.OverrideID = &overrideID.String
		}
		if overrideReason.Valid {
			schedule.OverrideReason = &overrideReason.String
		}
		if overrideType.Valid {
			schedule.OverrideType = &overrideType.String
		}
		if originalUserID.Valid {
			schedule.OriginalUserID = &originalUserID.String
		}
		if originalUserName.Valid {
			schedule.OriginalUserName = &originalUserName.String
		}
		if originalUserEmail.Valid {
			schedule.OriginalUserEmail = &originalUserEmail.String
		}
		if originalUserTeam.Valid {
			schedule.OriginalUserTeam = &originalUserTeam.String
		}
		if overrideUserName.Valid {
			schedule.OverrideUserName = &overrideUserName.String
		}
		if overrideUserEmail.Valid {
			schedule.OverrideUserEmail = &overrideUserEmail.String
		}
		if overrideUserTeam.Valid {
			schedule.OverrideUserTeam = &overrideUserTeam.String
		}
		if overrideStartTime.Valid {
			schedule.OverrideStartTime = &overrideStartTime.Time
		}
		if overrideEndTime.Valid {
			schedule.OverrideEndTime = &overrideEndTime.Time
		}

		// Set UserID for backward compatibility (now it's EffectiveUserID)
		schedule.UserID = schedule.EffectiveUserID

		schedules = append(schedules, schedule)
	}

	return schedules, nil
}
