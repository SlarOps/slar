-- Migration: Create effective_schedules view
-- This view combines oncall_schedules with overrides and user information
-- providing a clean interface for the application to query effective schedules

DROP VIEW IF EXISTS effective_schedules;

CREATE VIEW effective_schedules AS
SELECT 
    os.id as schedule_id,
    os.group_id,
    COALESCE(so.new_user_id, os.user_id) as effective_user_id,
    os.schedule_type,
    os.start_time,
    os.end_time,
    os.is_active,
    os.is_recurring,
    os.rotation_days,
    os.rotation_cycle_id,
    so.id as override_id,
    so.override_reason,
    so.override_type,
    CASE WHEN so.id IS NOT NULL THEN true ELSE false END as is_overridden,
    CASE WHEN so.id IS NOT NULL AND so.override_start_time = os.start_time AND so.override_end_time = os.end_time 
         THEN true ELSE false END as is_full_override,
    
    -- Effective user info (override user if exists, otherwise original user)
    COALESCE(ou.name, u.name) as effective_user_name,
    COALESCE(ou.email, u.email) as effective_user_email,
    COALESCE(ou.team, u.team) as effective_user_team,
    
    -- Original user info (always present)
    os.user_id as original_user_id,
    u.name as original_user_name,
    u.email as original_user_email,
    u.team as original_user_team,
    
    -- Override user info (only when override exists)
    ou.name as override_user_name,
    ou.email as override_user_email,
    ou.team as override_user_team,
    
    -- Override time info
    so.override_start_time,
    so.override_end_time,
    
    -- Metadata
    os.created_at,
    os.updated_at,
    os.created_by

FROM oncall_schedules os
JOIN users u ON os.user_id = u.id
LEFT JOIN schedule_overrides so ON os.id = so.original_schedule_id 
    AND so.is_active = true 
    AND NOW() BETWEEN so.override_start_time AND so.override_end_time
LEFT JOIN users ou ON so.new_user_id = ou.id;

-- Add comment explaining the view
COMMENT ON VIEW effective_schedules IS 
'Provides effective schedule information with overrides applied. 
Combines oncall_schedules, schedule_overrides, and user information 
to show who is actually on-call at any given time.';


