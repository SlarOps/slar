-- Migration: Add rotation metadata table to store rotation configuration
-- This allows reconstructing Rotation, Override, and Final groups when editing

-- Create rotation_configurations table
CREATE TABLE IF NOT EXISTS rotation_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduler_id UUID NOT NULL REFERENCES schedulers(id) ON DELETE CASCADE,
    
    -- Rotation configuration
    rotation_type VARCHAR(50) NOT NULL DEFAULT 'default', -- 'default' or 'override'
    name VARCHAR(255) NOT NULL, -- 'Rotation' or 'Override'
    
    -- Shift settings (for default rotation)
    shift_length VARCHAR(50), -- 'one_day', 'one_week', 'two_weeks', 'one_month'
    handoff_day VARCHAR(20), -- 'monday', 'tuesday', etc.
    handoff_time TIME, -- Time of handoff (e.g., '16:00')
    
    -- Override settings
    is_override BOOLEAN DEFAULT FALSE,
    
    -- Start/End (for both types)
    start_date DATE NOT NULL,
    start_time TIME,
    end_date DATE,
    end_time TIME,
    has_end_date BOOLEAN DEFAULT FALSE,
    
    -- Participants (stored as JSON array of user_ids)
    participants JSONB, -- [{"user_id": "...", "user_name": "...", "order": 1}, ...]
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    
    -- Indexes
    CONSTRAINT rotation_configurations_scheduler_id_key UNIQUE(scheduler_id, rotation_type)
);

-- Create indexes for performance
CREATE INDEX idx_rotation_configurations_scheduler_id ON rotation_configurations(scheduler_id);
CREATE INDEX idx_rotation_configurations_type ON rotation_configurations(rotation_type);

-- Add trigger to update updated_at
CREATE TRIGGER update_rotation_configurations_updated_at
    BEFORE UPDATE ON rotation_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment
COMMENT ON TABLE rotation_configurations IS 'Stores rotation configuration metadata for schedulers to enable edit functionality with full context';
COMMENT ON COLUMN rotation_configurations.rotation_type IS 'Type of rotation: default (regular rotation) or override (temporary override)';
COMMENT ON COLUMN rotation_configurations.participants IS 'JSON array of participants with their order in rotation';

