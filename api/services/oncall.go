package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/vanchonlee/slar/db"
)

// Helper function for string pointer
func stringPtr(s string) *string {
	return &s
}

type OnCallService struct {
	PG              *sql.DB
	OverrideService *OverrideService
}

func NewOnCallService(pg *sql.DB) *OnCallService {
	return &OnCallService{
		PG:              pg,
		OverrideService: NewOverrideService(pg),
	}
}

// ListGroupSchedules returns all effective schedules for a specific group (with overrides applied)
func (s *OnCallService) ListGroupSchedules(groupID string) ([]string, error) {
	// Get all schedules for the group
	query := `
		SELECT DISTINCT COALESCE(os.name, 'Unknown') as scheduler_name
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.group_id = $1 AND os.is_active = true
		ORDER BY name ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to query group schedules: %w", err)
	}
	defer rows.Close()

	var schedulesNames []string
	for rows.Next() {
		var name string

		err := rows.Scan(
			&name,
		)
		if err != nil {
			continue
		}

		schedulesNames = append(schedulesNames, name)
	}

	return schedulesNames, nil
}

// GetCurrentOnCallUser returns the currently on-call user for a group
func (s *OnCallService) GetCurrentOnCallUser(groupID string) (*db.Shift, error) {
	query := `
		SELECT os.id, os.group_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by,
		       os.rotation_cycle_id, os.is_override, os.original_user_id, os.override_reason
		FROM shifts os
		JOIN groups g ON os.group_id = g.id
		WHERE os.group_id = $1
		  AND os.is_active = true 
		  AND NOW() BETWEEN os.start_time AND os.end_time
		ORDER BY os.start_time ASC
		LIMIT 1
	`

	var schedule db.Shift
	var rotationCycleID, originalUserID sql.NullString
	err := s.PG.QueryRow(query, groupID).Scan(
		&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
		&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
		&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
		&rotationCycleID, &originalUserID,
		&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
	)

	if err != nil {
		log.Println("Error getting current on-call user:", err)
		if err == sql.ErrNoRows {
			return nil, nil // No current on-call user
		}
		return nil, fmt.Errorf("failed to get current on-call user: %w", err)
	}

	return &schedule, nil
}

// CreateSchedule creates a new on-call schedule
func (s *OnCallService) CreateSchedule(groupID string, req db.CreateShiftRequest, createdBy string) (db.Shift, error) {
	schedule := db.Shift{
		ID:           uuid.New().String(),
		GroupID:      groupID,
		UserID:       req.UserID,
		ShiftType:    db.ScheduleTypeCustom, // Force custom for manual schedules
		StartTime:    req.StartTime,
		EndTime:      req.EndTime,
		IsActive:     true,
		IsRecurring:  req.IsRecurring,
		RotationDays: req.RotationDays,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
		CreatedBy:    createdBy,
		// NEW: Service scheduling support
		ServiceID:     req.ServiceID,
		ScheduleScope: req.ScheduleScope,
	}

	// Set default scope if not provided
	if schedule.ScheduleScope == "" {
		schedule.ScheduleScope = "group"
	}

	// Validate service scheduling logic
	if schedule.ScheduleScope == "service" && schedule.ServiceID == nil {
		return schedule, fmt.Errorf("service_id is required when schedule_scope is 'service'")
	}
	if schedule.ScheduleScope == "group" && schedule.ServiceID != nil {
		return schedule, fmt.Errorf("service_id must be NULL when schedule_scope is 'group'")
	}

	// Validate time range
	if schedule.EndTime.Before(schedule.StartTime) {
		return schedule, fmt.Errorf("end time must be after start time")
	}

	// Check for overlapping schedules and handle override logic
	overlappingSchedules, err := s.checkOverlappingSchedules(groupID, schedule.StartTime, schedule.EndTime, "")
	if err != nil {
		return schedule, fmt.Errorf("failed to check overlapping schedules: %w", err)
	}

	// If there are overlapping automatic schedules, create override records instead of new schedule
	if len(overlappingSchedules) > 0 {
		for _, overlapSchedule := range overlappingSchedules {
			if overlapSchedule.RotationCycleID != nil {
				// This is an automatic schedule - create override using OverrideService
				overrideReq := db.CreateScheduleOverrideRequest{
					OriginalScheduleID: overlapSchedule.ID,
					NewUserID:          schedule.UserID,
					OverrideReason:     stringPtr("Manual schedule override"),
					OverrideType:       "temporary",
					OverrideStartTime:  schedule.StartTime,
					OverrideEndTime:    schedule.EndTime,
				}

				override, err := s.OverrideService.CreateOverride(overrideReq, createdBy)
				if err != nil {
					return schedule, fmt.Errorf("failed to create override for automatic schedule %s: %w", overlapSchedule.ID, err)
				}

				// Return the original schedule with override information applied
				schedule.ID = overlapSchedule.ID
				schedule.IsOverridden = true
				schedule.OverrideID = &override.ID
				schedule.OverrideReason = override.OverrideReason
				schedule.OverrideType = &override.OverrideType
				schedule.EffectiveUserID = schedule.UserID
				schedule.OriginalUserID = &overlapSchedule.UserID
				schedule.UserName = override.NewUserName
				schedule.UserEmail = override.NewUserEmail

				return schedule, nil
			} else {
				// Manual schedule conflict with another manual schedule - return error
				return schedule, fmt.Errorf("schedule overlaps with existing manual schedule: %s", overlapSchedule.ID)
			}
		}
	}

	// No conflicts or all conflicts resolved - create new manual schedule
	_, err = s.PG.Exec(`
		INSERT INTO shifts (id, group_id, user_id, shift_type, start_time, end_time, 
									  is_active, is_recurring, rotation_days, service_id, schedule_scope, 
									  created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`, schedule.ID, schedule.GroupID, schedule.UserID, schedule.ShiftType,
		schedule.StartTime, schedule.EndTime, schedule.IsActive, schedule.IsRecurring,
		schedule.RotationDays, schedule.ServiceID, schedule.ScheduleScope,
		schedule.CreatedAt, schedule.UpdatedAt, schedule.CreatedBy)

	if err != nil {
		return schedule, fmt.Errorf("failed to create schedule: %w", err)
	}

	// Get user info for response
	err = s.PG.QueryRow(`
		SELECT u.name, u.email, u.team 
		FROM users u 
		WHERE u.id = $1
	`, schedule.UserID).Scan(&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam)

	if err != nil {
		// Schedule created but user info retrieval failed - log but don't fail
		fmt.Printf("Warning: failed to get user info for schedule %s: %v\n", schedule.ID, err)
	}

	return schedule, nil
}

// UpdateSchedule updates an existing schedule
func (s *OnCallService) UpdateSchedule(scheduleID string, req db.UpdateOnCallScheduleRequest) (db.Shift, error) {
	// Get current schedule
	var schedule db.Shift
	err := s.PG.QueryRow(`
		SELECT os.id, os.group_id, os.user_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by,
		       u.name as user_name, u.email as user_email, u.team as user_team
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.id = $1
	`, scheduleID).Scan(
		&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
		&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
		&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
		&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return schedule, fmt.Errorf("schedule not found")
		}
		return schedule, fmt.Errorf("failed to get schedule: %w", err)
	}

	// Update fields if provided
	if req.UserID != nil {
		schedule.UserID = *req.UserID
	}
	if req.StartTime != nil {
		schedule.StartTime = *req.StartTime
	}
	if req.EndTime != nil {
		schedule.EndTime = *req.EndTime
	}
	if req.IsActive != nil {
		schedule.IsActive = *req.IsActive
	}
	if req.IsRecurring != nil {
		schedule.IsRecurring = *req.IsRecurring
	}
	if req.RotationDays != nil {
		schedule.RotationDays = *req.RotationDays
	}

	// Force custom type for manual schedules (ignore any schedule type changes)
	schedule.ShiftType = db.ScheduleTypeCustom

	schedule.UpdatedAt = time.Now()

	// Validate time range if times were updated
	if schedule.EndTime.Before(schedule.StartTime) {
		return schedule, fmt.Errorf("end time must be after start time")
	}

	// Check for overlapping schedules (excluding current schedule)
	if req.StartTime != nil || req.EndTime != nil {
		overlappingSchedules, err := s.checkOverlappingSchedules(schedule.GroupID, schedule.StartTime, schedule.EndTime, scheduleID)
		if err != nil {
			return schedule, fmt.Errorf("failed to check overlapping schedules: %w", err)
		}
		if len(overlappingSchedules) > 0 {
			return schedule, fmt.Errorf("schedule overlaps with existing schedule: %s", overlappingSchedules[0].ID)
		}
	}

	// Update the schedule
	_, err = s.PG.Exec(`
		UPDATE shifts 
		SET user_id = $2, shift_type = $3, start_time = $4, end_time = $5,
		    is_active = $6, is_recurring = $7, rotation_days = $8, updated_at = $9
		WHERE id = $1
	`, scheduleID, schedule.UserID, schedule.ShiftType, schedule.StartTime, schedule.EndTime,
		schedule.IsActive, schedule.IsRecurring, schedule.RotationDays, schedule.UpdatedAt)

	if err != nil {
		return schedule, fmt.Errorf("failed to update schedule: %w", err)
	}

	// Get updated user info if user changed
	if req.UserID != nil {
		err = s.PG.QueryRow(`
			SELECT u.name, u.email, u.team 
			FROM users u 
			WHERE u.id = $1
		`, schedule.UserID).Scan(&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam)

		if err != nil {
			fmt.Printf("Warning: failed to get user info for schedule %s: %v\n", schedule.ID, err)
		}
	}

	return schedule, nil
}

// DeleteSchedule deletes a schedule
func (s *OnCallService) DeleteSchedule(scheduleID string) error {
	result, err := s.PG.Exec(`
		DELETE FROM oncall_schedules WHERE id = $1
	`, scheduleID)

	if err != nil {
		return fmt.Errorf("failed to delete schedule: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("schedule not found")
	}

	return nil
}

// GetUpcomingSchedules returns upcoming schedules for a group within specified days
func (s *OnCallService) GetUpcomingSchedules(groupID string, days int) ([]db.Shift, error) {
	if days <= 0 {
		days = 7 // Default to 7 days
	}

	// SECURITY: Validate days is positive integer to prevent SQL injection
	if days < 0 || days > 365 {
		return nil, fmt.Errorf("invalid days parameter: must be between 0 and 365")
	}

	// SECURITY: Use parameterized query with explicit interval construction
	// PostgreSQL interval can be constructed safely using make_interval()
	query := `
		SELECT os.id, os.group_id, os.user_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by,
		       os.rotation_cycle_id, os.is_override, os.original_user_id, os.override_reason,
		       u.name as user_name, u.email as user_email, u.team as user_team
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.group_id = $1
		  AND os.is_active = true
		  AND os.start_time BETWEEN NOW() AND (NOW() + make_interval(days => $2))
		ORDER BY os.start_time ASC
	`

	rows, err := s.PG.Query(query, groupID, days)
	if err != nil {
		return nil, fmt.Errorf("failed to query upcoming schedules: %w", err)
	}
	defer rows.Close()

	var schedules []db.Shift
	for rows.Next() {
		var schedule db.Shift
		var rotationCycleID, originalUserID, overrideReason sql.NullString
		err := rows.Scan(
			&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
			&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
			&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
			&rotationCycleID, &schedule.IsOverridden, &originalUserID, &overrideReason,
			&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
		)
		if err != nil {
			continue
		}

		// Handle nullable fields
		if rotationCycleID.Valid {
			schedule.RotationCycleID = &rotationCycleID.String
		}
		if originalUserID.Valid {
			schedule.OriginalUserID = &originalUserID.String
		}
		if overrideReason.Valid {
			schedule.OverrideReason = &overrideReason.String
		}

		schedules = append(schedules, schedule)
	}

	return schedules, nil
}

// checkOverlappingSchedules checks for overlapping active schedules in the same group
func (s *OnCallService) checkOverlappingSchedules(groupID string, startTime, endTime time.Time, excludeID string) ([]db.Shift, error) {
	query := `
		SELECT os.id, os.group_id, os.user_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by
		FROM shifts os
		WHERE os.group_id = $1
		  AND os.is_active = true
		  AND (os.start_time, os.end_time) OVERLAPS ($2, $3)
	`
	args := []interface{}{groupID, startTime, endTime}

	if excludeID != "" {
		query += " AND os.id != $4"
		args = append(args, excludeID)
	}

	// Debug logging
	log.Printf("🔍 Checking overlaps: groupID=%s, startTime=%v, endTime=%v, excludeID=%s", groupID, startTime, endTime, excludeID)
	log.Printf("🔍 Query: %s", query)
	log.Printf("🔍 Args: %v", args)

	rows, err := s.PG.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to check overlapping schedules: %w", err)
	}
	defer rows.Close()

	var schedules []db.Shift
	for rows.Next() {
		var schedule db.Shift
		err := rows.Scan(
			&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
			&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
			&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
		)
		if err != nil {
			continue
		}
		schedules = append(schedules, schedule)
	}

	// Debug logging for results
	log.Printf("🔍 Found %d overlapping schedules", len(schedules))
	for i, schedule := range schedules {
		log.Printf("🔍 Overlap %d: ID=%s, StartTime=%v, EndTime=%v", i+1, schedule.ID, schedule.StartTime, schedule.EndTime)
	}

	return schedules, nil
}

// IsUserGroupLeader checks if a user is a leader in the group
func (s *OnCallService) IsUserGroupLeader(groupID, userID string) (bool, error) {
	var count int
	err := s.PG.QueryRow(`
		SELECT COUNT(*) FROM group_members 
		WHERE group_id = $1 AND user_id = $2 AND role = 'leader' AND is_active = true
	`, groupID, userID).Scan(&count)

	return count > 0, err
}

// SwapSchedules swaps two schedules - simplified for leaders (no approval needed)
func (s *OnCallService) SwapSchedules(req db.ShiftSwapRequest, requestorID string) (db.ShiftSwapResponse, error) {
	var response db.ShiftSwapResponse

	// Get both schedules
	schedule1, err := s.getScheduleByID(req.CurrentScheduleID)
	if err != nil {
		return response, fmt.Errorf("failed to get current schedule: %w", err)
	}

	schedule2, err := s.getScheduleByID(req.TargetScheduleID)
	if err != nil {
		return response, fmt.Errorf("failed to get target schedule: %w", err)
	}

	// Validate that schedules belong to the same group
	if schedule1.GroupID != schedule2.GroupID {
		return response, fmt.Errorf("cannot swap schedules from different groups")
	}

	// Check if requestor is a leader in the group
	isLeader, err := s.IsUserGroupLeader(schedule1.GroupID, requestorID)
	if err != nil {
		return response, fmt.Errorf("failed to check leader status: %w", err)
	}

	// If requestor is not a leader, they can only swap their own schedules
	if !isLeader && schedule1.UserID != requestorID {
		return response, fmt.Errorf("only group leaders can swap other people's schedules")
	}

	// For leaders, allow instant swap without approval
	if isLeader || req.SwapType == "instant" {
		return s.executeScheduleSwap(schedule1, schedule2, req.SwapMessage, requestorID)
	}

	// For non-leaders, create swap request (future enhancement)
	return response, fmt.Errorf("swap requests are not implemented yet - only instant swaps are supported")
}

// executeScheduleSwap performs the actual schedule swap
func (s *OnCallService) executeScheduleSwap(schedule1, schedule2 db.Shift, message, requestorID string) (db.ShiftSwapResponse, error) {
	var response db.ShiftSwapResponse

	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return response, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Swap the user assignments
	now := time.Now()

	// Update schedule 1 to have schedule 2's user
	_, err = tx.Exec(`
		UPDATE shifts 
		SET user_id = $1, updated_at = $2 
		WHERE id = $3
	`, schedule2.UserID, now, schedule1.ID)
	if err != nil {
		return response, fmt.Errorf("failed to update schedule 1: %w", err)
	}

	// Update schedule 2 to have schedule 1's user
	_, err = tx.Exec(`
		UPDATE shifts 
		SET user_id = $1, updated_at = $2 
		WHERE id = $3
	`, schedule1.UserID, now, schedule2.ID)
	if err != nil {
		return response, fmt.Errorf("failed to update schedule 2: %w", err)
	}

	// Update rotation cycles if schedules are part of automatic rotations
	err = s.updateRotationCyclesForSwap(tx, schedule1, schedule2)
	if err != nil {
		return response, fmt.Errorf("failed to update rotation cycles: %w", err)
	}

	// Commit transaction
	err = tx.Commit()
	if err != nil {
		return response, fmt.Errorf("failed to commit swap: %w", err)
	}

	// Get updated schedules for response
	updatedSchedule1, err := s.getScheduleByID(schedule1.ID)
	if err != nil {
		// Swap succeeded but failed to get updated info
		updatedSchedule1 = schedule1
		updatedSchedule1.UserID = schedule2.UserID
	}

	updatedSchedule2, err := s.getScheduleByID(schedule2.ID)
	if err != nil {
		// Swap succeeded but failed to get updated info
		updatedSchedule2 = schedule2
		updatedSchedule2.UserID = schedule1.UserID
	}

	response.Success = true
	response.Message = "Schedules swapped successfully"
	response.SwappedAt = now
	response.CurrentSchedule = updatedSchedule1
	response.TargetSchedule = updatedSchedule2

	return response, nil
}

// getScheduleByID is a helper function to get a schedule by ID
func (s *OnCallService) getScheduleByID(scheduleID string) (db.Shift, error) {
	var schedule db.Shift
	query := `
		SELECT os.id, os.group_id, os.user_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by,
		       u.name as user_name, u.email as user_email, u.team as user_team
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.id = $1
	`

	err := s.PG.QueryRow(query, scheduleID).Scan(
		&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
		&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
		&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
		&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return schedule, fmt.Errorf("schedule not found")
		}
		return schedule, fmt.Errorf("failed to get schedule: %w", err)
	}

	return schedule, nil
}

// updateRotationCyclesForSwap updates rotation cycle member_order when schedules are swapped
func (s *OnCallService) updateRotationCyclesForSwap(tx *sql.Tx, schedule1, schedule2 db.Shift) error {
	// Check if either schedule is part of a rotation cycle
	var rotationCycleIDs []string

	// Get rotation cycle IDs from both schedules
	rows, err := tx.Query(`
		SELECT DISTINCT rotation_cycle_id 
		FROM oncall_schedules 
		WHERE id IN ($1, $2) AND rotation_cycle_id IS NOT NULL
	`, schedule1.ID, schedule2.ID)
	if err != nil {
		return fmt.Errorf("failed to get rotation cycle IDs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var cycleID string
		if err := rows.Scan(&cycleID); err != nil {
			continue
		}
		rotationCycleIDs = append(rotationCycleIDs, cycleID)
	}

	// Update member_order for each affected rotation cycle
	for _, cycleID := range rotationCycleIDs {
		err = s.swapUsersInRotationCycle(tx, cycleID, schedule1.UserID, schedule2.UserID)
		if err != nil {
			return fmt.Errorf("failed to swap users in rotation cycle %s: %w", cycleID, err)
		}
	}

	return nil
}

// swapUsersInRotationCycle swaps two users in a rotation cycle's member_order
func (s *OnCallService) swapUsersInRotationCycle(tx *sql.Tx, cycleID, user1ID, user2ID string) error {
	// Get current member_order
	var memberOrderJSON []byte
	err := tx.QueryRow(`
		SELECT member_order FROM rotation_cycles WHERE id = $1
	`, cycleID).Scan(&memberOrderJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil // Rotation cycle doesn't exist, skip
		}
		return fmt.Errorf("failed to get member order: %w", err)
	}
	// Parse member_order JSON
	var memberOrder []string
	err = json.Unmarshal(memberOrderJSON, &memberOrder)
	if err != nil {
		return fmt.Errorf("failed to parse member order JSON: %w", err)
	}

	// Find and swap the users in member_order
	user1Pos := -1
	user2Pos := -1

	for i, userID := range memberOrder {
		if userID == user1ID {
			user1Pos = i
		}
		if userID == user2ID {
			user2Pos = i
		}
	}

	// Swap if both users found in rotation
	if user1Pos >= 0 && user2Pos >= 0 {
		memberOrder[user1Pos], memberOrder[user2Pos] = memberOrder[user2Pos], memberOrder[user1Pos]

		// Update the rotation cycle
		updatedJSON, err := json.Marshal(memberOrder)
		if err != nil {
			return fmt.Errorf("failed to marshal updated member order: %w", err)
		}

		_, err = tx.Exec(`
			UPDATE rotation_cycles 
			SET member_order = $1, updated_at = NOW() 
			WHERE id = $2
		`, updatedJSON, cycleID)
		if err != nil {
			return fmt.Errorf("failed to update rotation cycle: %w", err)
		}

		fmt.Printf("Updated rotation cycle %s: swapped %s and %s in member order\n", cycleID, user1ID, user2ID)
	}

	return nil
}
