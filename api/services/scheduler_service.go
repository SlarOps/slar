package services

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/vanchonlee/slar/db"
)

type SchedulerService struct {
	PG             *sql.DB
	ServiceService *ServiceService
}

func NewSchedulerService(pg *sql.DB) *SchedulerService {
	return &SchedulerService{
		PG:             pg,
		ServiceService: NewServiceService(pg),
	}
}

// SchedulerTimeline represents a timeline for a specific scheduler context
type SchedulerTimeline struct {
	ID            string     `json:"id"`   // service_id or "group"
	Name          string     `json:"name"` // service name or "Group Schedule"
	Type          string     `json:"type"` // "service" or "group"
	ServiceID     string     `json:"service_id,omitempty"`
	ScheduleCount int        `json:"schedule_count"`
	Schedules     []db.Shift `json:"schedules"`
}

// GetGroupSchedulerTimelines returns all scheduler timelines for a group
// First gets all scheduler names, then gets schedules for each scheduler name
func (s *SchedulerService) GetGroupSchedulerTimelines(groupID string) ([]SchedulerTimeline, error) {
	var timelines []SchedulerTimeline

	// First, get all distinct scheduler names for this group
	schedulerNames, err := s.getSchedulerNamesByGroup(groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to get scheduler names: %w", err)
	}

	// For each scheduler name, get its schedules
	for _, schedulerName := range schedulerNames {
		schedules, err := s.getSchedulesBySchedulerName(groupID, schedulerName)
		if err != nil {
			continue // Skip this scheduler if error
		}

		if len(schedules) > 0 {
			timelines = append(timelines, SchedulerTimeline{
				ID:            schedulerName,
				Name:          schedulerName,
				Type:          "scheduler",
				ScheduleCount: len(schedules),
				Schedules:     schedules,
			})
		}
	}

	return timelines, nil
}

// getSchedulerNamesByGroup gets all distinct scheduler names for a group
func (s *SchedulerService) getSchedulerNamesByGroup(groupID string) ([]string, error) {
	var schedulerNames []string

	query := `
		SELECT DISTINCT COALESCE(os.name, 'Unknown') as scheduler_name
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.group_id = $1 AND os.is_active = true
		ORDER BY scheduler_name ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		fmt.Println("Error getting scheduler names:", err)
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var schedulerName string
		err := rows.Scan(&schedulerName)
		if err != nil {
			continue
		}
		schedulerNames = append(schedulerNames, schedulerName)
	}

	return schedulerNames, nil
}

// getSchedulesBySchedulerName gets all schedules for a specific scheduler name in a group
func (s *SchedulerService) getSchedulesBySchedulerName(groupID, schedulerName string) ([]db.Shift, error) {
	var schedules []db.Shift

	query := `
		SELECT os.id, os.group_id, os.user_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by,
		       os.service_id,
		       u.name as user_name, u.email as user_email, u.team as user_team
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.group_id = $1 AND os.is_active = true AND os.name = $2
		ORDER BY os.start_time ASC
	`

	rows, err := s.PG.Query(query, groupID, schedulerName)
	if err != nil {
		fmt.Println("Error getting schedules by scheduler name:", err)
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var schedule db.Shift
		var scannedServiceID sql.NullString

		err := rows.Scan(
			&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
			&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
			&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
			&scannedServiceID,
			&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
		)
		if err != nil {
			continue
		}

		// Handle nullable fields
		if scannedServiceID.Valid {
			schedule.ServiceID = &scannedServiceID.String
		}

		schedules = append(schedules, schedule)
	}

	return schedules, nil
}

// GetSchedulesByScope gets schedules for specific scope (group or service)
func (s *SchedulerService) GetSchedulesByScope(groupID, serviceID, scope string) ([]db.Shift, error) {
	var schedules []db.Shift

	query := `
		SELECT os.id, os.group_id, os.user_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by,
		       os.service_id,
		       u.name as user_name, u.email as user_email, u.team as user_team
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.group_id = $1 AND os.is_active = true ORDER BY os.start_time ASC
	`

	args := []interface{}{groupID}

	rows, err := s.PG.Query(query, args...)

	if err != nil {
		fmt.Println("Error getting schedules by scope:", err)
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var schedule db.Shift
		var scannedServiceID sql.NullString

		err := rows.Scan(
			&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
			&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
			&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
			&scannedServiceID,
			&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
		)
		if err != nil {
			continue
		}

		// Handle nullable fields
		if scannedServiceID.Valid {
			schedule.ServiceID = &scannedServiceID.String
		}

		schedules = append(schedules, schedule)
	}

	return schedules, nil
}

// GetEffectiveScheduleForService determines which schedule is active for a service at given time
func (s *SchedulerService) GetEffectiveScheduleForService(groupID, serviceID string, checkTime time.Time) (*db.Shift, error) {
	// First try to find service-specific schedule
	serviceSchedule, err := s.getCurrentSchedule(groupID, serviceID, "service", checkTime)
	if err == nil && serviceSchedule != nil {
		return serviceSchedule, nil
	}

	// Fallback to group-wide schedule
	groupSchedule, err := s.getCurrentSchedule(groupID, "", "group", checkTime)
	if err != nil {
		return nil, fmt.Errorf("no effective schedule found: %w", err)
	}

	return groupSchedule, nil
}

// getCurrentSchedule gets current active schedule for specific scope
func (s *SchedulerService) getCurrentSchedule(groupID, serviceID, scope string, checkTime time.Time) (*db.Shift, error) {
	var schedule db.Shift

	query := `
		SELECT os.id, os.group_id, os.user_id, os.shift_type, os.start_time, os.end_time,
		       os.is_active, os.is_recurring, os.rotation_days, os.created_at, os.updated_at,
		       COALESCE(os.created_by, '') as created_by,
		       os.service_id,
		       u.name as user_name, u.email as user_email, u.team as user_team
		FROM shifts os
		JOIN users u ON os.user_id = u.id
		WHERE os.group_id = $1 AND os.is_active = true
		  AND $2 BETWEEN os.start_time AND os.end_time
	`

	args := []interface{}{groupID, checkTime}

	query += " ORDER BY os.start_time DESC LIMIT 1"

	var scannedServiceID, scannedScheduleScope sql.NullString

	err := s.PG.QueryRow(query, args...).Scan(
		&schedule.ID, &schedule.GroupID, &schedule.UserID, &schedule.ShiftType,
		&schedule.StartTime, &schedule.EndTime, &schedule.IsActive, &schedule.IsRecurring,
		&schedule.RotationDays, &schedule.CreatedAt, &schedule.UpdatedAt, &schedule.CreatedBy,
		&scannedServiceID, &scannedScheduleScope,
		&schedule.UserName, &schedule.UserEmail, &schedule.UserTeam,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	// Handle nullable fields
	if scannedServiceID.Valid {
		schedule.ServiceID = &scannedServiceID.String
	}
	if scannedScheduleScope.Valid {
		schedule.ScheduleScope = scannedScheduleScope.String
	} else {
		schedule.ScheduleScope = "group" // default
	}

	return &schedule, nil
}

// generateUniqueName generates a unique scheduler name by adding suffix if needed
func (s *SchedulerService) generateUniqueName(groupID, baseName string) (string, error) {
	// Try original name first
	if !s.nameExists(groupID, baseName) {
		return baseName, nil
	}

	// Try sequential numbers
	for i := 1; i <= 100; i++ {
		candidate := fmt.Sprintf("%s-%d", baseName, i)
		if !s.nameExists(groupID, candidate) {
			return candidate, nil
		}
	}

	// Fallback to timestamp if all numbers are taken
	timestamp := time.Now().Format("20060102-150405")
	return fmt.Sprintf("%s-%s", baseName, timestamp), nil
}

// nameExists checks if a scheduler name already exists in the group
func (s *SchedulerService) nameExists(groupID, name string) bool {
	var count int
	err := s.PG.QueryRow(`
		SELECT COUNT(*) FROM schedulers
		WHERE group_id = $1 AND name = $2 AND is_active = true
	`, groupID, name).Scan(&count)

	if err != nil {
		log.Printf("Error checking name existence: %v", err)
		return true // Assume exists to be safe
	}

	return count > 0
}

// CreateScheduler creates a new scheduler (team/group)
func (s *SchedulerService) CreateScheduler(groupID string, req db.CreateSchedulerRequest, createdBy string) (db.Scheduler, error) {
	// Generate unique name if needed
	uniqueName, err := s.generateUniqueName(groupID, req.Name)
	if err != nil {
		return db.Scheduler{}, fmt.Errorf("failed to generate unique name: %w", err)
	}

	// Use original name as display_name if not provided
	displayName := req.DisplayName
	if displayName == "" {
		displayName = req.Name
	}

	scheduler := db.Scheduler{
		Name:         uniqueName,  // Unique internal name
		DisplayName:  displayName, // User-friendly display name
		GroupID:      groupID,
		Description:  req.Description,
		IsActive:     true,
		RotationType: req.RotationType,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
		CreatedBy:    createdBy,
	}

	// Set default rotation type
	if scheduler.RotationType == "" {
		scheduler.RotationType = "manual"
	}

	// Log the name generation for debugging
	if uniqueName != req.Name {
		log.Printf("🔄 Generated unique name: '%s' -> '%s' for group %s", req.Name, uniqueName, groupID)
	}

	// Insert and get the auto-generated ID
	err = s.PG.QueryRow(`
		INSERT INTO schedulers (name, display_name, group_id, description, is_active, rotation_type, created_at, updated_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`, scheduler.Name, scheduler.DisplayName, scheduler.GroupID, scheduler.Description,
		scheduler.IsActive, scheduler.RotationType, scheduler.CreatedAt, scheduler.UpdatedAt, scheduler.CreatedBy).Scan(&scheduler.ID)

	if err != nil {
		return scheduler, fmt.Errorf("failed to create scheduler: %w", err)
	}

	return scheduler, nil
}

// CreateSchedulerWithShifts creates a scheduler and its shifts in a single transaction
func (s *SchedulerService) CreateSchedulerWithShifts(groupID string, schedulerReq db.CreateSchedulerRequest, shifts []db.CreateShiftRequest, createdBy string) (db.Scheduler, []db.Shift, error) {
	// Start transaction
	tx, err := s.PG.Begin()
	if err != nil {
		return db.Scheduler{}, nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback() // Will be ignored if tx.Commit() succeeds

	// Generate unique name if needed
	uniqueName, err := s.generateUniqueName(groupID, schedulerReq.Name)
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
		Name:         uniqueName,  // Unique internal name
		DisplayName:  displayName, // User-friendly display name
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

	// Log the name generation for debugging
	if uniqueName != schedulerReq.Name {
		log.Printf("🔄 Generated unique name: '%s' -> '%s' for group %s", schedulerReq.Name, uniqueName, groupID)
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

	// Create shifts
	var createdShifts []db.Shift
	for _, shiftReq := range shifts {
		shift := db.Shift{
			SchedulerID:  scheduler.ID, // Link to the scheduler
			GroupID:      groupID,
			UserID:       shiftReq.UserID,
			ShiftType:    shiftReq.ShiftType,
			StartTime:    shiftReq.StartTime,
			EndTime:      shiftReq.EndTime,
			IsActive:     true,
			IsRecurring:  shiftReq.IsRecurring,
			RotationDays: shiftReq.RotationDays,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
			CreatedBy:    createdBy,
		}

		// Set default values
		if shift.ShiftType == "" {
			shift.ShiftType = db.ScheduleTypeCustom
		}
		if shiftReq.ScheduleScope != "" {
			shift.ScheduleScope = shiftReq.ScheduleScope
		} else {
			shift.ScheduleScope = "group"
		}
		if shiftReq.ServiceID != nil {
			shift.ServiceID = shiftReq.ServiceID
		}

		// Insert shift and get auto-generated ID
		err = tx.QueryRow(`
			INSERT INTO shifts (scheduler_id, group_id, user_id, shift_type, start_time, end_time, 
								is_active, is_recurring, rotation_days, service_id, schedule_scope,
								created_at, updated_at, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
			RETURNING id
		`, shift.SchedulerID, shift.GroupID, shift.UserID, shift.ShiftType,
			shift.StartTime, shift.EndTime, shift.IsActive, shift.IsRecurring,
			shift.RotationDays, shift.ServiceID, shift.ScheduleScope,
			shift.CreatedAt, shift.UpdatedAt, shift.CreatedBy).Scan(&shift.ID)

		if err != nil {
			log.Println("Error creating shift:", err)
			return scheduler, nil, fmt.Errorf("failed to create shift %d: %w", len(createdShifts)+1, err)
		}

		createdShifts = append(createdShifts, shift)
	}

	// Commit transaction
	if err = tx.Commit(); err != nil {
		return scheduler, nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return scheduler, createdShifts, nil
}

// GetSchedulersByGroup gets all schedulers for a group
func (s *SchedulerService) GetSchedulersByGroup(groupID string) ([]db.Scheduler, error) {
	query := `
		SELECT id, name, display_name, group_id, description, is_active, rotation_type, created_at, updated_at, created_by
		FROM schedulers
		WHERE group_id = $1 AND is_active = true
		ORDER BY name ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to query schedulers: %w", err)
	}
	defer rows.Close()

	var schedulers []db.Scheduler
	for rows.Next() {
		var scheduler db.Scheduler
		err := rows.Scan(
			&scheduler.ID, &scheduler.Name, &scheduler.DisplayName, &scheduler.GroupID,
			&scheduler.Description, &scheduler.IsActive, &scheduler.RotationType,
			&scheduler.CreatedAt, &scheduler.UpdatedAt, &scheduler.CreatedBy,
		)
		if err != nil {
			continue
		}
		schedulers = append(schedulers, scheduler)
	}

	return schedulers, nil
}

// GetOrCreateDefaultScheduler gets the default scheduler for a group, creating one if it doesn't exist
func (s *SchedulerService) GetOrCreateDefaultScheduler(groupID, createdBy string) (db.Scheduler, error) {
	// First try to get existing active default scheduler
	var scheduler db.Scheduler
	err := s.PG.QueryRow(`
		SELECT id, name, display_name, group_id, description, is_active, rotation_type, created_at, updated_at, created_by
		FROM schedulers
		WHERE group_id = $1 AND name = 'default' AND is_active = true
		LIMIT 1
	`, groupID).Scan(
		&scheduler.ID, &scheduler.Name, &scheduler.DisplayName, &scheduler.GroupID,
		&scheduler.Description, &scheduler.IsActive, &scheduler.RotationType,
		&scheduler.CreatedAt, &scheduler.UpdatedAt, &scheduler.CreatedBy,
	)

	if err == nil {
		// Found existing active default scheduler
		return scheduler, nil
	}

	if err != sql.ErrNoRows {
		// Some other error occurred
		return scheduler, fmt.Errorf("failed to query default scheduler: %w", err)
	}

	// No active default scheduler found, check if there's an inactive one to reactivate
	err = s.PG.QueryRow(`
		SELECT id, name, display_name, group_id, description, is_active, rotation_type, created_at, updated_at, created_by
		FROM schedulers
		WHERE group_id = $1 AND name = 'default' AND is_active = false
		LIMIT 1
	`, groupID).Scan(
		&scheduler.ID, &scheduler.Name, &scheduler.DisplayName, &scheduler.GroupID,
		&scheduler.Description, &scheduler.IsActive, &scheduler.RotationType,
		&scheduler.CreatedAt, &scheduler.UpdatedAt, &scheduler.CreatedBy,
	)

	if err == nil {
		// Found inactive default scheduler, reactivate it
		_, err = s.PG.Exec(`
			UPDATE schedulers
			SET is_active = true, updated_at = $1
			WHERE id = $2
		`, time.Now(), scheduler.ID)

		if err != nil {
			return scheduler, fmt.Errorf("failed to reactivate default scheduler: %w", err)
		}

		scheduler.IsActive = true
		scheduler.UpdatedAt = time.Now()
		return scheduler, nil
	}

	if err != sql.ErrNoRows {
		// Some other error occurred
		return scheduler, fmt.Errorf("failed to query inactive default scheduler: %w", err)
	}

	// No default scheduler found at all, create one
	req := db.CreateSchedulerRequest{
		Name:         "default",
		DisplayName:  "Default Scheduler",
		Description:  "Auto-created default scheduler for backward compatibility",
		RotationType: "manual",
	}

	return s.CreateScheduler(groupID, req, createdBy)
}

// DeleteScheduler soft deletes a scheduler and all its associated shifts
func (s *SchedulerService) DeleteScheduler(schedulerID string) error {
	// Start a transaction to ensure atomicity
	tx, err := s.PG.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// First, soft delete all shifts associated with this scheduler
	_, err = tx.Exec(`
		UPDATE shifts
		SET is_active = false, updated_at = $1
		WHERE scheduler_id = $2
	`, time.Now(), schedulerID)

	if err != nil {
		return fmt.Errorf("failed to deactivate scheduler shifts: %w", err)
	}

	// Then, soft delete the scheduler itself
	result, err := tx.Exec(`
		UPDATE schedulers
		SET is_active = false, updated_at = $1
		WHERE id = $2
	`, time.Now(), schedulerID)

	if err != nil {
		return fmt.Errorf("failed to deactivate scheduler: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("scheduler not found")
	}

	// Commit the transaction
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// GetSchedulerWithShifts gets a scheduler with its shifts
func (s *SchedulerService) GetSchedulerWithShifts(schedulerID string) (db.Scheduler, error) {
	var scheduler db.Scheduler

	// Get scheduler
	err := s.PG.QueryRow(`
		SELECT id, name, display_name, group_id, description, is_active, rotation_type, created_at, updated_at, created_by
		FROM schedulers
		WHERE id = $1 AND is_active = true
	`, schedulerID).Scan(
		&scheduler.ID, &scheduler.Name, &scheduler.DisplayName, &scheduler.GroupID,
		&scheduler.Description, &scheduler.IsActive, &scheduler.RotationType,
		&scheduler.CreatedAt, &scheduler.UpdatedAt, &scheduler.CreatedBy,
	)

	if err != nil {
		return scheduler, fmt.Errorf("scheduler not found: %w", err)
	}

	// Get shifts
	shifts, err := s.getShiftsByScheduler(schedulerID)
	if err != nil {
		return scheduler, fmt.Errorf("failed to get shifts: %w", err)
	}

	scheduler.Shifts = shifts
	return scheduler, nil
}

// getShiftsByScheduler gets all shifts for a scheduler
func (s *SchedulerService) getShiftsByScheduler(schedulerID string) ([]db.Shift, error) {
	query := `
		SELECT s.id, s.scheduler_id, s.group_id, s.user_id, s.shift_type, s.start_time, s.end_time,
		       s.is_active, s.is_recurring, s.rotation_days, s.created_at, s.updated_at,
		       COALESCE(s.created_by, '') as created_by,
		       s.service_id, s.schedule_scope,
		       u.name as user_name, u.email as user_email, u.team as user_team,
		       sc.name as scheduler_name, sc.display_name as scheduler_display_name
		FROM shifts s
		JOIN users u ON s.user_id = u.id
		JOIN schedulers sc ON s.scheduler_id = sc.id
		WHERE s.scheduler_id = $1 AND s.is_active = true
		ORDER BY s.start_time ASC
	`

	rows, err := s.PG.Query(query, schedulerID)
	if err != nil {
		return nil, fmt.Errorf("failed to query shifts: %w", err)
	}
	defer rows.Close()

	var shifts []db.Shift
	for rows.Next() {
		var shift db.Shift
		var serviceID sql.NullString

		err := rows.Scan(
			&shift.ID, &shift.SchedulerID, &shift.GroupID, &shift.UserID, &shift.ShiftType,
			&shift.StartTime, &shift.EndTime, &shift.IsActive, &shift.IsRecurring,
			&shift.RotationDays, &shift.CreatedAt, &shift.UpdatedAt, &shift.CreatedBy,
			&serviceID, &shift.ScheduleScope,
			&shift.UserName, &shift.UserEmail, &shift.UserTeam,
			&shift.SchedulerName, &shift.SchedulerDisplayName,
		)
		if err != nil {
			log.Println("Error scanning shift:", err)
			continue
		}

		// Handle nullable service_id
		if serviceID.Valid {
			shift.ServiceID = &serviceID.String
		} else {
			shift.ServiceID = nil
		}

		shifts = append(shifts, shift)
	}

	return shifts, nil
}

// GetAllShiftsInGroup gets all shifts for a group with scheduler context
func (s *SchedulerService) GetAllShiftsInGroup(groupID string) ([]db.Shift, error) {
	// Custom query to show ALL overrides (including future ones)
	// Note: effective_shifts view filters by CURRENT_TIMESTAMP, but for schedule display
	// we need to show all overrides regardless of their time range
	query := `
		SELECT 
			s.id as shift_id,
			s.scheduler_id,
			s.group_id,
			s.user_id as original_user_id,
			s.shift_type,
			s.start_time,
			s.end_time,
			s.is_active,
			s.is_recurring,
			s.rotation_days,
			s.created_at,
			s.updated_at,
			COALESCE(s.created_by, '') as created_by,
			sc.name as scheduler_name,
			sc.display_name as scheduler_display_name,
			-- Override information (check if override exists for this shift time range)
			CASE WHEN so.id IS NOT NULL THEN true ELSE false END as is_overridden,
			so.id as override_id,
			so.override_reason,
			so.override_type,
			so.override_start_time,
			so.override_end_time,
			COALESCE(so.new_user_id, s.user_id) as effective_user_id,
			-- Effective user info (override user if exists, otherwise original user)
			COALESCE(u_override.name, u_original.name) as user_name,
			COALESCE(u_override.email, u_original.email) as user_email,
			COALESCE(u_override.team, u_original.team) as user_team,
			-- Original user info
			u_original.name as original_user_name,
			u_original.email as original_user_email,
			u_original.team as original_user_team
		FROM shifts s
		JOIN schedulers sc ON s.scheduler_id = sc.id
		LEFT JOIN schedule_overrides so ON s.id = so.original_schedule_id 
			AND so.is_active = true
			-- No CURRENT_TIMESTAMP filter here - we want to see all overrides including future ones
		LEFT JOIN users u_original ON s.user_id = u_original.id
		LEFT JOIN users u_override ON so.new_user_id = u_override.id
		WHERE s.group_id = $1 AND s.is_active = true AND sc.is_active = true
		ORDER BY sc.name ASC, s.start_time ASC
	`

	rows, err := s.PG.Query(query, groupID)
	if err != nil {
		log.Println("Error getting all shifts in group:", err)
		return nil, fmt.Errorf("failed to query shifts: %w", err)
	}
	defer rows.Close()

	var shifts []db.Shift
	for rows.Next() {
		var shift db.Shift
		var overrideID, overrideReason, overrideType sql.NullString
		var overrideStartTime, overrideEndTime sql.NullTime
		var originalUserName, originalUserEmail, originalUserTeam sql.NullString

		// View returns shift_id (not id) and original_user_id (not user_id)
		err := rows.Scan(
			&shift.ID, &shift.SchedulerID, &shift.GroupID, &shift.UserID, &shift.ShiftType,
			&shift.StartTime, &shift.EndTime, &shift.IsActive, &shift.IsRecurring,
			&shift.RotationDays, &shift.CreatedAt, &shift.UpdatedAt, &shift.CreatedBy,
			&shift.SchedulerName, &shift.SchedulerDisplayName,
			// Override info (all from view)
			&shift.IsOverridden,
			&overrideID,
			&overrideReason,
			&overrideType,
			&overrideStartTime,
			&overrideEndTime,
			&shift.EffectiveUserID,
			// User info (effective user - already resolved by view)
			&shift.UserName, &shift.UserEmail, &shift.UserTeam,
			// Original user info (from view - NULL if not overridden)
			&originalUserName, &originalUserEmail, &originalUserTeam,
		)
		if err != nil {
			log.Println("Error scanning shift in GetAllShiftsInGroup:", err)
			continue
		}

		// Populate nullable fields
		if overrideID.Valid {
			shift.OverrideID = &overrideID.String
		}
		if overrideReason.Valid {
			shift.OverrideReason = &overrideReason.String
		}
		if overrideType.Valid {
			shift.OverrideType = &overrideType.String
		}
		if overrideStartTime.Valid {
			shift.OverrideStartTime = &overrideStartTime.Time
		}
		if overrideEndTime.Valid {
			shift.OverrideEndTime = &overrideEndTime.Time
		}
		if originalUserName.Valid {
			shift.OriginalUserName = &originalUserName.String
		}
		if originalUserEmail.Valid {
			shift.OriginalUserEmail = &originalUserEmail.String
		}
		if originalUserTeam.Valid {
			shift.OriginalUserTeam = &originalUserTeam.String
		}

		// Set OriginalUserID if overridden
		if shift.IsOverridden {
			// VIEW returns:
			// - original_user_id (scanned into shift.UserID)
			// - effective_user_id (scanned into shift.EffectiveUserID)
			//
			// For display purposes, shift.UserID should be the EFFECTIVE user
			// So we need to swap them:
			//
			// IMPORTANT: Must create a copy, not point to shift.UserID directly!
			// Otherwise when we reassign shift.UserID, the pointer will also change.
			originalID := shift.UserID           // Create copy of original user ID
			shift.OriginalUserID = &originalID   // Point to the copy
			shift.UserID = shift.EffectiveUserID // Set UserID to effective user
		}

		// Set default values for fields not in query
		shift.ScheduleScope = "group"
		shift.ServiceID = nil

		shifts = append(shifts, shift)
	}

	log.Printf("🔍 GetAllShiftsInGroup: Found %d shifts for group %s (%d with overrides)",
		len(shifts), groupID, countOverriddenShifts(shifts))
	return shifts, nil
}

// Helper to count overridden shifts
func countOverriddenShifts(shifts []db.Shift) int {
	count := 0
	for _, shift := range shifts {
		if shift.IsOverridden {
			count++
		}
	}
	return count
}

// UpdateSchedulerWithShifts updates a scheduler and replaces all its shifts in a single transaction
func (s *SchedulerService) UpdateSchedulerWithShifts(schedulerID string, schedulerReq db.CreateSchedulerRequest, shifts []db.CreateShiftRequest, updatedBy string) (db.Scheduler, []db.Shift, error) {
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

	// Soft delete all existing shifts for this scheduler
	_, err = tx.Exec(`
		UPDATE shifts
		SET is_active = false, updated_at = $1
		WHERE scheduler_id = $2
	`, time.Now(), schedulerID)

	if err != nil {
		log.Println("Error deactivating old shifts:", err)
		return scheduler, nil, fmt.Errorf("failed to deactivate old shifts: %w", err)
	}

	// Create new shifts
	var createdShifts []db.Shift
	for _, shiftReq := range shifts {
		shift := db.Shift{
			SchedulerID:  schedulerID,
			GroupID:      scheduler.GroupID,
			UserID:       shiftReq.UserID,
			ShiftType:    shiftReq.ShiftType,
			StartTime:    shiftReq.StartTime,
			EndTime:      shiftReq.EndTime,
			IsActive:     true,
			IsRecurring:  shiftReq.IsRecurring,
			RotationDays: shiftReq.RotationDays,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
			CreatedBy:    updatedBy,
		}

		// Set default values
		if shift.ShiftType == "" {
			shift.ShiftType = db.ScheduleTypeCustom
		}
		// Note: schedule_scope field exists in struct but not in DB table
		if shiftReq.ScheduleScope != "" {
			shift.ScheduleScope = shiftReq.ScheduleScope
		} else {
			shift.ScheduleScope = "group"
		}
		if shiftReq.ServiceID != nil {
			shift.ServiceID = shiftReq.ServiceID
		}

		// Insert shift with schedule_scope
		err = tx.QueryRow(`
			INSERT INTO shifts (scheduler_id, group_id, user_id, shift_type, start_time, end_time,
				is_active, is_recurring, rotation_days, service_id, schedule_scope,
				created_at, updated_at, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
			RETURNING id
		`, shift.SchedulerID, shift.GroupID, shift.UserID, shift.ShiftType, shift.StartTime, shift.EndTime,
			shift.IsActive, shift.IsRecurring, shift.RotationDays, shift.ServiceID, shift.ScheduleScope,
			shift.CreatedAt, shift.UpdatedAt, shift.CreatedBy).Scan(&shift.ID)

		if err != nil {
			log.Printf("Error creating shift: %v", err)
			return scheduler, nil, fmt.Errorf("failed to create shift: %w", err)
		}

		// Get user information for the shift
		err = tx.QueryRow(`
			SELECT name, email, team FROM users WHERE id = $1
		`, shift.UserID).Scan(&shift.UserName, &shift.UserEmail, &shift.UserTeam)

		if err != nil {
			log.Printf("Warning: failed to get user info for shift %s: %v", shift.ID, err)
		}

		// Set scheduler name
		shift.SchedulerName = scheduler.Name
		shift.SchedulerDisplayName = scheduler.DisplayName

		createdShifts = append(createdShifts, shift)
	}

	// Commit transaction
	if err = tx.Commit(); err != nil {
		return scheduler, nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("✅ Updated scheduler %s with %d new shifts", schedulerID, len(createdShifts))
	scheduler.Shifts = createdShifts
	return scheduler, createdShifts, nil
}
