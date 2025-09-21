-- Migration: Create Integrations Architecture
-- Phase 1: Basic integration management and service linking

-- ===========================
-- 1. CREATE INTEGRATIONS TABLE
-- ===========================

CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    
    -- Configuration (JSON for flexibility)
    config JSONB NOT NULL DEFAULT '{}',
    
    -- Webhook settings
    webhook_secret VARCHAR(255), -- For webhook validation
    
    -- Status and health
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    heartbeat_interval INTEGER DEFAULT 300, -- seconds
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT,
    
    -- Constraints
    CONSTRAINT integrations_name_not_empty CHECK (length(trim(name)) > 0),
    CONSTRAINT integrations_type_valid CHECK (type IN ('prometheus', 'datadog', 'grafana', 'webhook', 'aws', 'custom')),
    CONSTRAINT integrations_name_unique UNIQUE (name)
);

-- Add comment
COMMENT ON TABLE integrations IS 'External monitoring integrations that send alerts to the system';
COMMENT ON COLUMN integrations.config IS 'JSON configuration specific to integration type (endpoints, auth, etc.)';
COMMENT ON COLUMN integrations.webhook_secret IS 'Secret for validating incoming webhooks';

-- ===========================
-- 2. CREATE SERVICE_INTEGRATIONS TABLE
-- ===========================

CREATE TABLE service_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL,
    integration_id UUID NOT NULL,
    
    -- Routing conditions specific to this service-integration pair
    routing_conditions JSONB NOT NULL DEFAULT '{}',
    
    -- Priority for routing (lower number = higher priority)
    priority INTEGER NOT NULL DEFAULT 100,
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT,
    
    -- Foreign key constraints
    CONSTRAINT fk_service_integrations_service 
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    CONSTRAINT fk_service_integrations_integration 
        FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
    
    -- Unique constraint to prevent duplicate mappings
    CONSTRAINT service_integrations_unique UNIQUE(service_id, integration_id),
    
    -- Priority constraint
    CONSTRAINT service_integrations_priority_valid CHECK (priority >= 1 AND priority <= 1000)
);

-- Add comment
COMMENT ON TABLE service_integrations IS 'Many-to-many mapping between services and integrations with routing conditions';
COMMENT ON COLUMN service_integrations.routing_conditions IS 'JSON conditions for routing alerts from this integration to this service';
COMMENT ON COLUMN service_integrations.priority IS 'Priority for this integration when multiple integrations match (lower = higher priority)';

-- ===========================
-- 3. CREATE INTEGRATION_TEMPLATES TABLE (for future use)
-- ===========================

CREATE TABLE integration_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Default configuration template
    default_config JSONB NOT NULL DEFAULT '{}',
    
    -- Configuration schema for validation
    config_schema JSONB NOT NULL DEFAULT '{}',
    
    -- Webhook payload transformation rules (for future use)
    payload_transform JSONB,
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT integration_templates_type_valid CHECK (type IN ('prometheus', 'datadog', 'grafana', 'webhook', 'aws', 'custom')),
    CONSTRAINT integration_templates_name_unique UNIQUE (type, name)
);

-- Add comment
COMMENT ON TABLE integration_templates IS 'Templates for creating integrations with predefined configurations';

-- ===========================
-- 4. CREATE INDEXES FOR PERFORMANCE
-- ===========================

-- Integrations indexes
CREATE INDEX idx_integrations_type ON integrations(type);
CREATE INDEX idx_integrations_active ON integrations(is_active);
CREATE INDEX idx_integrations_created_at ON integrations(created_at);

-- Service integrations indexes
CREATE INDEX idx_service_integrations_service_id ON service_integrations(service_id);
CREATE INDEX idx_service_integrations_integration_id ON service_integrations(integration_id);
CREATE INDEX idx_service_integrations_active ON service_integrations(is_active);
CREATE INDEX idx_service_integrations_priority ON service_integrations(priority);

-- Composite index for routing queries
CREATE INDEX idx_service_integrations_routing ON service_integrations(integration_id, is_active, priority);

-- ===========================
-- 5. INSERT DEFAULT INTEGRATION TEMPLATES
-- ===========================

INSERT INTO integration_templates (type, name, description, default_config, config_schema) VALUES
-- Prometheus template
('prometheus', 'Prometheus Default', 'Standard Prometheus AlertManager integration', 
 '{"endpoint": "", "auth_type": "none", "timeout": 30}',
 '{"type": "object", "properties": {"endpoint": {"type": "string"}, "auth_type": {"type": "string", "enum": ["none", "basic", "bearer"]}, "timeout": {"type": "number"}}, "required": ["endpoint"]}'),

-- Datadog template
('datadog', 'Datadog Default', 'Standard Datadog webhook integration',
 '{"site": "datadoghq.com", "validate_signature": true}',
 '{"type": "object", "properties": {"site": {"type": "string"}, "validate_signature": {"type": "boolean"}}}'),

-- Generic webhook template
('webhook', 'Generic Webhook', 'Generic webhook integration for custom monitoring tools',
 '{"auth_type": "none", "payload_format": "json"}',
 '{"type": "object", "properties": {"auth_type": {"type": "string", "enum": ["none", "signature", "header"]}, "payload_format": {"type": "string", "enum": ["json", "form", "xml"]}}}');

-- ===========================
-- 6. ADD COMPUTED COLUMNS (PostgreSQL 12+)
-- ===========================

-- Add webhook URL as computed column
ALTER TABLE integrations ADD COLUMN webhook_url VARCHAR GENERATED ALWAYS AS (
    'https://api.slar.io/webhook/' || type || '/' || id::text
) STORED;

-- Add comment
COMMENT ON COLUMN integrations.webhook_url IS 'Auto-generated webhook URL for this integration';

-- ===========================
-- 7. CREATE FUNCTIONS FOR MAINTENANCE
-- ===========================

-- Function to update integration heartbeat
CREATE OR REPLACE FUNCTION update_integration_heartbeat(integration_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE integrations 
    SET last_heartbeat = NOW() 
    WHERE id = integration_uuid AND is_active = true;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get integration health status
CREATE OR REPLACE FUNCTION get_integration_health_status(integration_uuid UUID)
RETURNS TEXT AS $$
DECLARE
    last_beat TIMESTAMP WITH TIME ZONE;
    interval_seconds INTEGER;
    status TEXT;
BEGIN
    SELECT last_heartbeat, heartbeat_interval 
    INTO last_beat, interval_seconds
    FROM integrations 
    WHERE id = integration_uuid;
    
    IF last_beat IS NULL THEN
        RETURN 'unknown';
    END IF;
    
    IF last_beat < NOW() - INTERVAL '1 second' * (interval_seconds * 2) THEN
        RETURN 'unhealthy';
    ELSIF last_beat < NOW() - INTERVAL '1 second' * interval_seconds THEN
        RETURN 'warning';
    ELSE
        RETURN 'healthy';
    END IF;
END;
$$ LANGUAGE plpgsql;
