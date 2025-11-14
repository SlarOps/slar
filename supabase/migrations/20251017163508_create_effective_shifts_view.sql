-- Migration: Create effective_shifts view
-- This view combines shifts with schedule_overrides and user information
-- providing a clean interface to query effective on-call assignments
-- 
-- Usage: SELECT * FROM effective_shifts WHERE group_id = $1 AND start_time <= NOW() AND end_time >= NOW()

DROP VIEW IF EXISTS effective_shifts CASCADE;

CREATE OR REPLACE VIEW effective_shifts AS
SELECT 
    -- Shift identifiers
    s.id as shift_id,
    s.scheduler_id,
    s.group_id,
    s.rotation_cycle_id,
    
    -- User identifiers
    s.user_id as original_user_id,
    COALESCE(so.new_user_id, s.user_id) as effective_user_id,
    
    -- Shift details
    s.shift_type,
    s.start_time,
    s.end_time,
    s.is_active,
    s.is_recurring,
    s.rotation_days,
    
    -- Override information
    CASE WHEN so.id IS NOT NULL THEN true ELSE false END as is_overridden,
    CASE WHEN so.id IS NOT NULL 
         AND so.override_start_time <= s.start_time 
         AND so.override_end_time >= s.end_time 
         THEN true ELSE false END as is_full_override,
    so.id as override_id,
    so.override_reason,
    so.override_type,
    so.override_start_time,
    so.override_end_time,
    
    -- Effective user info (the person actually on-call - override if exists, otherwise original)
    COALESCE(u_override.id, u_original.id) as user_id,
    COALESCE(u_override.name, u_original.name) as user_name,
    COALESCE(u_override.email, u_original.email) as user_email,
    COALESCE(u_override.team, u_original.team) as user_team,
    COALESCE(u_override.phone, u_original.phone) as user_phone,
    
    -- Original user info (always present - the scheduled person)
    u_original.name as original_user_name,
    u_original.email as original_user_email,
    u_original.team as original_user_team,
    u_original.phone as original_user_phone,
    
    -- Override user info (only when override exists - the replacement)
    u_override.name as override_user_name,
    u_override.email as override_user_email,
    u_override.team as override_user_team,
    u_override.phone as override_user_phone,
    
    -- Scheduler info
    sc.name as scheduler_name,
    sc.display_name as scheduler_display_name,
    
    -- Service-specific scheduling
    s.service_id,
    s.schedule_scope,
    
    -- Metadata
    s.created_at,
    s.updated_at,
    s.created_by

FROM shifts s
JOIN schedulers sc ON s.scheduler_id = sc.id
LEFT JOIN schedule_overrides so ON s.id = so.original_schedule_id 
    AND so.is_active = true
    AND CURRENT_TIMESTAMP BETWEEN so.override_start_time AND so.override_end_time
LEFT JOIN users u_original ON s.user_id = u_original.id
LEFT JOIN users u_override ON so.new_user_id = u_override.id

WHERE s.is_active = true AND sc.is_active = true;

-- Add helpful comment
COMMENT ON VIEW effective_shifts IS 
'Provides effective shift information with schedule overrides applied.
This view automatically handles override logic, returning the actual on-call user.

Key fields:
- effective_user_id: The person currently on-call (with overrides applied)
- original_user_id: The originally scheduled person
- is_overridden: TRUE if this shift has an active override
- user_name/user_email: Effective user info (use these for assignments/notifications)

Example queries:
-- Get current on-call user for a scheduler
SELECT effective_user_id FROM effective_shifts 
WHERE scheduler_id = $1 AND start_time <= NOW() AND end_time >= NOW()
ORDER BY start_time ASC LIMIT 1;

-- Get current on-call user for a group
SELECT effective_user_id FROM effective_shifts 
WHERE group_id = $1 AND start_time <= NOW() AND end_time >= NOW()
ORDER BY start_time ASC LIMIT 1;

-- Get all shifts with overrides
SELECT * FROM effective_shifts WHERE is_overridden = true;
';

