package services

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/vanchonlee/slar/db"
)

// OptimizedSchedulerService provides optimized scheduler operations
type OptimizedSchedulerService struct {
	PG *sql.DB
}

// NewOptimizedSchedulerService creates a new optimized scheduler service
func NewOptimizedSchedulerService(pg *sql.DB) *OptimizedSchedulerService {
	return &OptimizedSchedulerService{PG: pg}
}

// CreateSchedulerWithShiftsOptimized creates a scheduler and its shifts with optimizations
func (s *OptimizedSchedulerService) CreateSchedulerWithShiftsOptimized(groupID string, schedulerReq db.CreateSchedulerRequest, shifts []db.CreateShiftRequest, createdBy string) (db.Scheduler, []db.Shift, error) {
	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return db.Scheduler{}, nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback() // Will be ignored if tx.Commit() succeeds

	// OPTIMIZATION 1: Generate unique name with single query
	uniqueName, err := s.generateUniqueNameOptimized(tx, groupID, schedulerReq.Name)
	if err != nil {
		return db.Scheduler{}, nil, fmt.Errorf("failed to generate unique name: %w", err)
	}

	// Use original name as display_name if not provided
	displayName := schedulerReq.DisplayName
	if displayName == "" {
		displayName = schedulerReq.Name
	}

	// Create scheduler
	scheduler := db.Scheduler{
		Name:         uniqueName,
		DisplayName:  displayName,
		GroupID:      groupID,
		Description:  schedulerReq.Description,
		IsActive:     true,
		RotationType: schedulerReq.RotationType,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
		CreatedBy:    createdBy,
	}

	// Set default rotation type
	if scheduler.RotationType == "" {
		scheduler.RotationType = "manual"
	}

	// Insert scheduler and get auto-generated ID
	err = tx.QueryRow(`
		INSERT INTO schedulers (name, display_name, group_id, description, is_active, rotation_type, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`, scheduler.Name, scheduler.DisplayName, scheduler.GroupID, scheduler.Description,
		scheduler.IsActive, scheduler.RotationType, scheduler.CreatedAt, scheduler.UpdatedAt, scheduler.CreatedBy).Scan(&scheduler.ID)

	if err != nil {
		log.Println("Error creating scheduler:", err)
		return scheduler, nil, fmt.Errorf("failed to create scheduler: %w", err)
	}

	// OPTIMIZATION 2: Batch insert shifts with single query
	createdShifts, err := s.batchInsertShifts(tx, scheduler.ID, groupID, shifts, createdBy)
	if err != nil {
		return scheduler, nil, fmt.Errorf("failed to create shifts: %w", err)
	}

	// Commit transaction
	if err = tx.Commit(); err != nil {
		return scheduler, nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("Successfully created scheduler '%s' with %d shifts", scheduler.DisplayName, len(createdShifts))
	return scheduler, createdShifts, nil
}

// generateUniqueNameOptimized generates unique name with single database query
func (s *OptimizedSchedulerService) generateUniqueNameOptimized(tx *sql.Tx, groupID, baseName string) (string, error) {
	// Get all existing names with the same base in a single query
	query := `
		SELECT name FROM schedulers 
		WHERE group_id = $1 AND name LIKE $2 AND is_active = true
		ORDER BY name
	`

	pattern := baseName + "%"
	rows, err := tx.Query(query, groupID, pattern)
	if err != nil {
		return "", fmt.Errorf("failed to query existing names: %w", err)
	}
	defer rows.Close()

	// Collect existing names
	existingNames := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		existingNames[name] = true
	}

	// Try original name first
	if !existingNames[baseName] {
		return baseName, nil
	}

	// Find first available number
	for i := 1; i <= 100; i++ {
		candidate := fmt.Sprintf("%s-%d", baseName, i)
		if !existingNames[candidate] {
			return candidate, nil
		}
	}

	// Fallback to timestamp
	timestamp := time.Now().Format("20060102-150405")
	return fmt.Sprintf("%s-%s", baseName, timestamp), nil
}

// batchInsertShifts inserts multiple shifts in a single query for better performance
func (s *OptimizedSchedulerService) batchInsertShifts(tx *sql.Tx, schedulerID, groupID string, shifts []db.CreateShiftRequest, createdBy string) ([]db.Shift, error) {
	if len(shifts) == 0 {
		return []db.Shift{}, nil
	}

	// Build batch insert query
	valueStrings := make([]string, 0, len(shifts))
	valueArgs := make([]interface{}, 0, len(shifts)*13)

	now := time.Now()

	for i, shiftReq := range shifts {
		// Set default values
		shiftType := shiftReq.ShiftType
		if shiftType == "" {
			shiftType = db.ScheduleTypeCustom
		}

		scheduleScope := shiftReq.ScheduleScope
		if scheduleScope == "" {
			scheduleScope = "group"
		}

		// Add value placeholder
		valueStrings = append(valueStrings, fmt.Sprintf("($%d, $%d, $%d, $%d, $%d, $%d, $%d, $%d, $%d, $%d, $%d, $%d, $%d)",
			i*13+1, i*13+2, i*13+3, i*13+4, i*13+5, i*13+6, i*13+7, i*13+8, i*13+9, i*13+10, i*13+11, i*13+12, i*13+13))

		// Add values
		valueArgs = append(valueArgs,
			schedulerID,           // scheduler_id
			groupID,               // group_id
			shiftReq.UserID,       // user_id
			shiftType,             // shift_type
			shiftReq.StartTime,    // start_time
			shiftReq.EndTime,      // end_time
			true,                  // is_active
			shiftReq.IsRecurring,  // is_recurring
			shiftReq.RotationDays, // rotation_days
			shiftReq.ServiceID,    // service_id
			scheduleScope,         // schedule_scope
			now,                   // created_at
			createdBy,             // created_by
		)
	}

	// Execute batch insert
	query := fmt.Sprintf(`
		INSERT INTO shifts (scheduler_id, group_id, user_id, shift_type, start_time, end_time, 
		                   is_active, is_recurring, rotation_days, service_id, schedule_scope, 
		                   created_at, created_by)
		VALUES %s
		RETURNING id, scheduler_id, group_id, user_id, shift_type, start_time, end_time, 
		         is_active, is_recurring, rotation_days, service_id, schedule_scope, created_at, created_by
	`, strings.Join(valueStrings, ","))

	rows, err := tx.Query(query, valueArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to batch insert shifts: %w", err)
	}
	defer rows.Close()

	// Collect created shifts
	var createdShifts []db.Shift
	for rows.Next() {
		var shift db.Shift
		err := rows.Scan(
			&shift.ID, &shift.SchedulerID, &shift.GroupID, &shift.UserID,
			&shift.ShiftType, &shift.StartTime, &shift.EndTime,
			&shift.IsActive, &shift.IsRecurring, &shift.RotationDays,
			&shift.ServiceID, &shift.ScheduleScope, &shift.CreatedAt, &shift.CreatedBy,
		)
		if err != nil {
			log.Printf("Error scanning shift: %v", err)
			continue
		}

		// Set updated_at to created_at for new records
		shift.UpdatedAt = shift.CreatedAt
		createdShifts = append(createdShifts, shift)
	}

	if len(createdShifts) != len(shifts) {
		log.Printf("Warning: Expected %d shifts, got %d", len(shifts), len(createdShifts))
	}

	return createdShifts, nil
}

// ValidateSchedulerRequest validates scheduler creation request
func (s *OptimizedSchedulerService) ValidateSchedulerRequest(req db.CreateSchedulerRequest, shifts []db.CreateShiftRequest) error {
	// Validate scheduler
	if strings.TrimSpace(req.Name) == "" {
		return fmt.Errorf("scheduler name is required")
	}

	// Validate shifts
	if len(shifts) == 0 {
		return fmt.Errorf("at least one shift is required")
	}

	for i, shift := range shifts {
		if strings.TrimSpace(shift.UserID) == "" {
			return fmt.Errorf("shift %d: user_id is required", i+1)
		}

		if shift.StartTime.IsZero() {
			return fmt.Errorf("shift %d: start_time is required", i+1)
		}

		if shift.EndTime.IsZero() {
			return fmt.Errorf("shift %d: end_time is required", i+1)
		}

		if shift.EndTime.Before(shift.StartTime) {
			return fmt.Errorf("shift %d: end_time must be after start_time", i+1)
		}
	}

	return nil
}

// GetSchedulerStats returns performance statistics
func (s *OptimizedSchedulerService) GetSchedulerStats(groupID string) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// Count schedulers
	var schedulerCount int
	err := s.PG.QueryRow(`
		SELECT COUNT(*) FROM schedulers 
		WHERE group_id = $1 AND is_active = true
	`, groupID).Scan(&schedulerCount)

	if err != nil {
		return nil, fmt.Errorf("failed to count schedulers: %w", err)
	}

	// Count shifts
	var shiftCount int
	err = s.PG.QueryRow(`
		SELECT COUNT(*) FROM shifts s
		JOIN schedulers sc ON s.scheduler_id = sc.id
		WHERE sc.group_id = $1 AND s.is_active = true AND sc.is_active = true
	`, groupID).Scan(&shiftCount)

	if err != nil {
		return nil, fmt.Errorf("failed to count shifts: %w", err)
	}

	stats["schedulers"] = schedulerCount
	stats["shifts"] = shiftCount
	stats["avg_shifts_per_scheduler"] = float64(shiftCount) / float64(max(schedulerCount, 1))

	return stats, nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// UpdateSchedulerWithShiftsOptimized updates a scheduler and replaces all its shifts with optimization
func (s *OptimizedSchedulerService) UpdateSchedulerWithShiftsOptimized(schedulerID string, schedulerReq db.CreateSchedulerRequest, shifts []db.CreateShiftRequest, updatedBy string) (db.Scheduler, []db.Shift, error) {
	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return db.Scheduler{}, nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback() // Will be ignored if tx.Commit() succeeds

	// Get existing scheduler
	var scheduler db.Scheduler
	err = tx.QueryRow(`
		SELECT id, name, display_name, group_id, description, is_active, rotation_type, created_at, updated_at, created_by
		FROM schedulers
		WHERE id = $1 AND is_active = true
	`, schedulerID).Scan(
		&scheduler.ID, &scheduler.Name, &scheduler.DisplayName, &scheduler.GroupID,
		&scheduler.Description, &scheduler.IsActive, &scheduler.RotationType,
		&scheduler.CreatedAt, &scheduler.UpdatedAt, &scheduler.CreatedBy,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return scheduler, nil, fmt.Errorf("scheduler not found")
		}
		return scheduler, nil, fmt.Errorf("failed to get scheduler: %w", err)
	}

	// Update scheduler fields
	scheduler.DisplayName = schedulerReq.DisplayName
	if scheduler.DisplayName == "" {
		scheduler.DisplayName = schedulerReq.Name
	}
	scheduler.Description = schedulerReq.Description
	scheduler.RotationType = schedulerReq.RotationType
	if scheduler.RotationType == "" {
		scheduler.RotationType = "manual"
	}
	scheduler.UpdatedAt = time.Now()

	// Update scheduler in database
	_, err = tx.Exec(`
		UPDATE schedulers 
		SET display_name = $2, description = $3, rotation_type = $4, updated_at = $5
		WHERE id = $1
	`, schedulerID, scheduler.DisplayName, scheduler.Description, scheduler.RotationType, scheduler.UpdatedAt)

	if err != nil {
		log.Println("Error updating scheduler:", err)
		return scheduler, nil, fmt.Errorf("failed to update scheduler: %w", err)
	}

	// =================================================================================
	// PRESERVE OVERRIDES: Fetch active overrides before deleting shifts
	// =================================================================================
	type PreservedOverride struct {
		ID                 string
		OriginalScheduleID string
		GroupID            string
		NewUserID          string
		OverrideReason     string
		OverrideType       string
		OverrideStartTime  time.Time
		OverrideEndTime    time.Time
		CreatedBy          string
	}

	var preservedOverrides []PreservedOverride
	overrideRows, err := tx.Query(`
		SELECT so.id, so.original_schedule_id, so.group_id, so.new_user_id, 
		       COALESCE(so.override_reason, ''), COALESCE(so.override_type, 'temporary'), 
		       so.override_start_time, so.override_end_time, COALESCE(so.created_by, '')
		FROM schedule_overrides so
		JOIN shifts s ON so.original_schedule_id = s.id
		WHERE s.scheduler_id = $1 AND so.is_active = true AND s.is_active = true
	`, schedulerID)

	if err == nil {
		defer overrideRows.Close()
		for overrideRows.Next() {
			var po PreservedOverride
			if err := overrideRows.Scan(
				&po.ID, &po.OriginalScheduleID, &po.GroupID, &po.NewUserID,
				&po.OverrideReason, &po.OverrideType,
				&po.OverrideStartTime, &po.OverrideEndTime, &po.CreatedBy,
			); err == nil {
				preservedOverrides = append(preservedOverrides, po)
			}
		}
	} else {
		log.Printf("Warning: Failed to fetch overrides for preservation: %v", err)
		// Don't fail the whole update, but log the error
	}
	log.Printf("Found %d active overrides to preserve", len(preservedOverrides))

	// OPTIMIZATION: Soft delete all existing shifts in single query
	_, err = tx.Exec(`
		UPDATE shifts
		SET is_active = false, updated_at = $1
		WHERE scheduler_id = $2
	`, time.Now(), schedulerID)

	if err != nil {
		log.Println("Error deactivating old shifts:", err)
		return scheduler, nil, fmt.Errorf("failed to deactivate old shifts: %w", err)
	}

	// OPTIMIZATION: Batch insert new shifts with single query
	createdShifts, err := s.batchInsertShifts(tx, schedulerID, scheduler.GroupID, shifts, updatedBy)
	if err != nil {
		return scheduler, nil, fmt.Errorf("failed to create shifts: %w", err)
	}

	// =================================================================================
	// RESTORE OVERRIDES: Re-attach overrides to new shifts
	// =================================================================================
	if len(preservedOverrides) > 0 && len(createdShifts) > 0 {
		restoredCount := 0
		for _, po := range preservedOverrides {
			// Find a matching new shift
			// Logic: The new shift must cover the override time range OR be the "primary" shift for that time
			// For simplicity and robustness: Find the shift that overlaps most with the override
			// or just the first shift that contains the override start time.

			var bestMatchShiftID string

			for _, newShift := range createdShifts {
				// Check if override falls within this shift's time window
				// Allow for some tolerance or exact match
				if (po.OverrideStartTime.Equal(newShift.StartTime) || po.OverrideStartTime.After(newShift.StartTime)) &&
					(po.OverrideStartTime.Before(newShift.EndTime)) {
					bestMatchShiftID = newShift.ID
					break
				}
			}

			if bestMatchShiftID != "" {
				// Re-create the override pointing to the new shift
				_, err := tx.Exec(`
					INSERT INTO schedule_overrides (
						original_schedule_id, group_id, new_user_id, 
						override_reason, override_type, 
						override_start_time, override_end_time, 
						is_active, created_at, updated_at, created_by
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
				`, bestMatchShiftID, po.GroupID, po.NewUserID,
					po.OverrideReason, po.OverrideType,
					po.OverrideStartTime, po.OverrideEndTime,
					true, time.Now(), time.Now(), po.CreatedBy)

				if err != nil {
					log.Printf("Warning: Failed to restore override %s: %v", po.ID, err)
				} else {
					restoredCount++
				}

				// Deactivate the old override to avoid confusion (though it points to an inactive shift anyway)
				tx.Exec(`UPDATE schedule_overrides SET is_active = false WHERE id = $1`, po.ID)
			} else {
				log.Printf("Warning: Could not find matching shift for override %s (Time: %s - %s)",
					po.ID, po.OverrideStartTime.Format(time.RFC3339), po.OverrideEndTime.Format(time.RFC3339))
			}
		}
		log.Printf("Restored %d/%d overrides", restoredCount, len(preservedOverrides))
	}

	// Commit transaction
	if err = tx.Commit(); err != nil {
		return scheduler, nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("Updated scheduler '%s' (%s) with %d new shifts", scheduler.DisplayName, schedulerID, len(createdShifts))
	scheduler.Shifts = createdShifts
	return scheduler, createdShifts, nil
}
