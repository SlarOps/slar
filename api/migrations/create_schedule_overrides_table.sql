-- Migration: Create schedule_overrides table
-- This table stores override information for oncall schedules

DROP TABLE IF EXISTS schedule_overrides CASCADE;

CREATE TABLE schedule_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_schedule_id UUID NOT NULL,
    group_id UUID NOT NULL,
    new_user_id UUID NOT NULL, -- User who will override the original assignment
    override_reason TEXT NULL,
    override_type TEXT NULL, -- 'temporary', 'permanent', 'emergency', etc.
    override_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    override_end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT NULL
);

-- Create indexes for performance
CREATE INDEX idx_schedule_overrides_original_schedule ON schedule_overrides(original_schedule_id);
CREATE INDEX idx_schedule_overrides_group_id ON schedule_overrides(group_id);
CREATE INDEX idx_schedule_overrides_new_user_id ON schedule_overrides(new_user_id);
CREATE INDEX idx_schedule_overrides_time_range ON schedule_overrides(override_start_time, override_end_time);
CREATE INDEX idx_schedule_overrides_active ON schedule_overrides(is_active);

-- Add foreign key constraints (assuming these tables exist)
-- ALTER TABLE schedule_overrides ADD CONSTRAINT fk_schedule_overrides_original_schedule 
--     FOREIGN KEY (original_schedule_id) REFERENCES oncall_schedules(id) ON DELETE CASCADE;
-- ALTER TABLE schedule_overrides ADD CONSTRAINT fk_schedule_overrides_group_id 
--     FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
-- ALTER TABLE schedule_overrides ADD CONSTRAINT fk_schedule_overrides_new_user_id 
--     FOREIGN KEY (new_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Add comment
COMMENT ON TABLE schedule_overrides IS 
'Stores override assignments for oncall schedules. 
Allows temporary or permanent reassignment of on-call duties to different users.';
