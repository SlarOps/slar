-- Migration: Create uptime_services table for uptime monitoring
-- This table stores services that should be monitored for uptime

CREATE TABLE IF NOT EXISTS uptime_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'http', -- http, https, tcp, ping
    method VARCHAR(10) NOT NULL DEFAULT 'GET', -- GET, POST, HEAD, PUT
    interval_seconds INTEGER NOT NULL DEFAULT 300, -- Check interval in seconds (5 minutes default)
    timeout_seconds INTEGER NOT NULL DEFAULT 30, -- Timeout in seconds
    expected_status INTEGER NOT NULL DEFAULT 200, -- Expected HTTP status code
    
    -- Service configuration
    headers JSONB DEFAULT '{}', -- Custom headers for HTTP checks
    body TEXT, -- Request body for POST/PUT requests
    follow_redirects BOOLEAN NOT NULL DEFAULT true,
    verify_ssl BOOLEAN NOT NULL DEFAULT true,
    
    -- Status and control
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT,
    
    -- Optional service integration
    service_id UUID, -- Link to services table if exists
    group_id UUID, -- Link to groups table
    
    -- Constraints
    CONSTRAINT uptime_services_name_not_empty CHECK (length(trim(name)) > 0),
    CONSTRAINT uptime_services_url_not_empty CHECK (length(trim(url)) > 0),
    CONSTRAINT uptime_services_type_valid CHECK (type IN ('http', 'https', 'tcp', 'ping')),
    CONSTRAINT uptime_services_method_valid CHECK (method IN ('GET', 'POST', 'HEAD', 'PUT', 'PATCH')),
    CONSTRAINT uptime_services_interval_positive CHECK (interval_seconds > 0),
    CONSTRAINT uptime_services_timeout_positive CHECK (timeout_seconds > 0),
    CONSTRAINT uptime_services_expected_status_valid CHECK (expected_status >= 100 AND expected_status < 600)
);

-- Create indexes for performance
CREATE INDEX idx_uptime_services_active ON uptime_services(is_active);
CREATE INDEX idx_uptime_services_enabled ON uptime_services(is_enabled);
CREATE INDEX idx_uptime_services_type ON uptime_services(type);
CREATE INDEX idx_uptime_services_service_id ON uptime_services(service_id);
CREATE INDEX idx_uptime_services_group_id ON uptime_services(group_id);
CREATE INDEX idx_uptime_services_created_at ON uptime_services(created_at);

-- Add foreign key constraints (commented out until tables exist)
-- ALTER TABLE uptime_services ADD CONSTRAINT fk_uptime_services_service_id 
--     FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
-- ALTER TABLE uptime_services ADD CONSTRAINT fk_uptime_services_group_id 
--     FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- Create trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_uptime_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_uptime_services_updated_at
    BEFORE UPDATE ON uptime_services
    FOR EACH ROW
    EXECUTE FUNCTION update_uptime_services_updated_at();

-- Add comments
COMMENT ON TABLE uptime_services IS 'Services to be monitored for uptime and availability';
COMMENT ON COLUMN uptime_services.url IS 'URL to monitor (http/https) or hostname/IP (tcp/ping)';
COMMENT ON COLUMN uptime_services.type IS 'Type of check: http, https, tcp, or ping';
COMMENT ON COLUMN uptime_services.method IS 'HTTP method for http/https checks';
COMMENT ON COLUMN uptime_services.interval_seconds IS 'How often to check the service (in seconds)';
COMMENT ON COLUMN uptime_services.timeout_seconds IS 'Timeout for the check (in seconds)';
COMMENT ON COLUMN uptime_services.expected_status IS 'Expected HTTP status code for success';
COMMENT ON COLUMN uptime_services.headers IS 'Custom headers for HTTP requests (JSON object)';
COMMENT ON COLUMN uptime_services.body IS 'Request body for POST/PUT requests';
COMMENT ON COLUMN uptime_services.follow_redirects IS 'Whether to follow HTTP redirects';
COMMENT ON COLUMN uptime_services.verify_ssl IS 'Whether to verify SSL certificates for HTTPS';
COMMENT ON COLUMN uptime_services.service_id IS 'Optional link to services table';
COMMENT ON COLUMN uptime_services.group_id IS 'Optional link to groups table for organization';

-- Insert some sample data for testing
INSERT INTO uptime_services (name, url, type, method, interval_seconds, timeout_seconds, expected_status, is_active, is_enabled) VALUES
('Google', 'https://www.google.com', 'https', 'GET', 300, 30, 200, true, true),
('Example API', 'https://httpbin.org/status/200', 'https', 'GET', 180, 15, 200, true, true),
('Local Service', 'http://localhost:8080/health', 'http', 'GET', 60, 10, 200, true, false);
