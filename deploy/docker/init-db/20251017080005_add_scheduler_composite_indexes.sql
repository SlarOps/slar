-- Migration: Add composite indexes for scheduler and shifts performance optimization
-- Date: 2025-10-17
-- Purpose: Improve query performance for common schedule lookup patterns

-- ============================================
-- SHIFTS TABLE COMPOSITE INDEXES
-- ============================================

-- Index for fetching active shifts by scheduler with time filtering
CREATE INDEX IF NOT EXISTS idx_shifts_scheduler_active_time 
ON public.shifts(scheduler_id, is_active, start_time, end_time)
WHERE is_active = true;

-- Index for fetching active shifts by group with time filtering  
CREATE INDEX IF NOT EXISTS idx_shifts_group_active_time
ON public.shifts(group_id, is_active, start_time, end_time)
WHERE is_active = true;

-- Index for fetching shifts by user with time filtering
CREATE INDEX IF NOT EXISTS idx_shifts_user_active_time
ON public.shifts(user_id, is_active, start_time, end_time)
WHERE is_active = true;

-- Index for overlapping shift detection
CREATE INDEX IF NOT EXISTS idx_shifts_overlap_detection
ON public.shifts(group_id, start_time, end_time)
WHERE is_active = true;

-- Index for service-specific shift lookups
CREATE INDEX IF NOT EXISTS idx_shifts_service_time
ON public.shifts(service_id, is_active, start_time, end_time)
WHERE service_id IS NOT NULL AND is_active = true;

-- ============================================
-- SCHEDULERS TABLE COMPOSITE INDEXES
-- ============================================

-- Index for fetching active schedulers by group with name search
CREATE INDEX IF NOT EXISTS idx_schedulers_group_active_name
ON public.schedulers(group_id, is_active, name)
WHERE is_active = true;

-- Index for rotation type filtering
CREATE INDEX IF NOT EXISTS idx_schedulers_group_rotation_type
ON public.schedulers(group_id, rotation_type, is_active)
WHERE is_active = true;

-- ============================================
-- VACUUM & ANALYZE
-- ============================================

-- Analyze tables to update statistics for query planner
ANALYZE public.shifts;
ANALYZE public.schedulers;

