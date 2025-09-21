-- Migration: Create services table
-- This table stores service information within groups (PagerDuty-style services)

DROP TABLE IF EXISTS services CASCADE;

CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    routing_key TEXT UNIQUE NOT NULL, -- Unique webhook key for this service
    escalation_rule_id UUID NULL, -- Service-specific escalation policy
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT NULL,
    
    -- Integration settings (stored as JSONB for flexibility)
    integrations JSONB DEFAULT '{}',
    notification_settings JSONB DEFAULT '{}'
);

-- Create indexes for performance
CREATE INDEX idx_services_group_id ON services(group_id);
CREATE INDEX idx_services_routing_key ON services(routing_key);
CREATE INDEX idx_services_active ON services(is_active);
CREATE INDEX idx_services_escalation_rule ON services(escalation_rule_id);

-- Add foreign key constraints
-- ALTER TABLE services ADD CONSTRAINT fk_services_group_id 
--     FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
-- ALTER TABLE services ADD CONSTRAINT fk_services_escalation_rule_id 
--     FOREIGN KEY (escalation_rule_id) REFERENCES escalation_rules(id) ON DELETE SET NULL;

-- Add unique constraint for service name within group
CREATE UNIQUE INDEX idx_services_name_per_group ON services(group_id, name) WHERE is_active = true;

-- Add comment
COMMENT ON TABLE services IS 
'Stores services within groups. Each service can have its own escalation policies and scheduling.
Similar to PagerDuty services - represents different applications/systems that can generate alerts.';

COMMENT ON COLUMN services.routing_key IS 
'Unique webhook key used to route alerts to this service. Used in alert ingestion URLs.';

COMMENT ON COLUMN services.integrations IS 
'JSON object storing integration configurations (Datadog, Prometheus, etc.)';

COMMENT ON COLUMN services.notification_settings IS 
'JSON object storing notification preferences for this service';

-- Create trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW
    EXECUTE FUNCTION update_services_updated_at();
