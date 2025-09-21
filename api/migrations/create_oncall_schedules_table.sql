-- Migration: Create oncall_schedules table
-- This table stores on-call schedule information for groups and users

DROP TABLE IF EXISTS oncall_schedules CASCADE;

CREATE TABLE oncall_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    schedule_type TEXT NOT NULL, -- 'daily', 'weekly', 'custom', etc.
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    rotation_days INTEGER NOT NULL DEFAULT 0, -- For recurring schedules
    rotation_cycle_id UUID NULL, -- Links to rotation cycle if auto-generated
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT NULL
);

-- Create indexes for performance
CREATE INDEX idx_oncall_schedules_group_id ON oncall_schedules(group_id);
CREATE INDEX idx_oncall_schedules_user_id ON oncall_schedules(user_id);
CREATE INDEX idx_oncall_schedules_time_range ON oncall_schedules(start_time, end_time);
CREATE INDEX idx_oncall_schedules_active ON oncall_schedules(is_active);
CREATE INDEX idx_oncall_schedules_rotation_cycle ON oncall_schedules(rotation_cycle_id);

-- Add foreign key constraints (assuming these tables exist)
-- ALTER TABLE oncall_schedules ADD CONSTRAINT fk_oncall_schedules_group_id 
--     FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
-- ALTER TABLE oncall_schedules ADD CONSTRAINT fk_oncall_schedules_user_id 
--     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Add comment
COMMENT ON TABLE oncall_schedules IS 
'Stores on-call schedule assignments for users within groups. 
Supports both manual schedules and auto-generated rotation schedules.';
