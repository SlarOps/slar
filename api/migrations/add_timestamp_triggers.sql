-- Migration: Add automatic timestamp triggers for all tables
-- This ensures updated_at is always set to UTC time on any UPDATE

-- ===========================
-- 1. INCIDENTS TABLE TRIGGERS
-- ===========================

-- Function to update updated_at with UTC time
CREATE OR REPLACE FUNCTION update_incidents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for incidents table
DROP TRIGGER IF EXISTS trigger_incidents_updated_at ON incidents;
CREATE TRIGGER trigger_incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_incidents_updated_at();

-- ===========================
-- BUSINESS LOGIC TRIGGERS
-- ===========================

-- Function to automatically set assigned_at when assigned_to changes
CREATE OR REPLACE FUNCTION set_incident_assigned_at()
RETURNS TRIGGER AS $$
BEGIN
    -- On INSERT: Set assigned_at if assigned_to is provided
    IF TG_OP = 'INSERT' THEN
        IF NEW.assigned_to IS NOT NULL AND NEW.assigned_at IS NULL THEN
            NEW.assigned_at = NOW() AT TIME ZONE 'UTC';
        END IF;
    END IF;

    -- On UPDATE: Handle assigned_to changes
    IF TG_OP = 'UPDATE' THEN
        -- If assigned_to changed from NULL to something, set assigned_at
        IF OLD.assigned_to IS NULL AND NEW.assigned_to IS NOT NULL THEN
            NEW.assigned_at = NOW() AT TIME ZONE 'UTC';
        END IF;

        -- If assigned_to changed to NULL, clear assigned_at
        IF OLD.assigned_to IS NOT NULL AND NEW.assigned_to IS NULL THEN
            NEW.assigned_at = NULL;
        END IF;

        -- If assigned_to changed to different user, update assigned_at
        IF OLD.assigned_to IS NOT NULL AND NEW.assigned_to IS NOT NULL
           AND OLD.assigned_to != NEW.assigned_to THEN
            NEW.assigned_at = NOW() AT TIME ZONE 'UTC';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for automatic assigned_at management
DROP TRIGGER IF EXISTS trigger_incident_assigned_at ON incidents;
CREATE TRIGGER trigger_incident_assigned_at
    BEFORE INSERT OR UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION set_incident_assigned_at();

-- ===========================
-- 2. ALERTS TABLE TRIGGERS (if exists)
-- ===========================

CREATE OR REPLACE FUNCTION update_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Check if alerts table exists before creating trigger
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alerts') THEN
        DROP TRIGGER IF EXISTS trigger_alerts_updated_at ON alerts;
        CREATE TRIGGER trigger_alerts_updated_at
            BEFORE UPDATE ON alerts
            FOR EACH ROW
            EXECUTE FUNCTION update_alerts_updated_at();
    END IF;
END $$;

-- ===========================
-- 3. SERVICES TABLE TRIGGERS
-- ===========================

-- Update existing services trigger to use UTC
CREATE OR REPLACE FUNCTION update_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Recreate trigger for services (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'services') THEN
        DROP TRIGGER IF EXISTS trigger_services_updated_at ON services;
        CREATE TRIGGER trigger_services_updated_at
            BEFORE UPDATE ON services
            FOR EACH ROW
            EXECUTE FUNCTION update_services_updated_at();
    END IF;
END $$;

-- ===========================
-- 4. USERS TABLE TRIGGERS
-- ===========================

CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
        CREATE TRIGGER trigger_users_updated_at
            BEFORE UPDATE ON users
            FOR EACH ROW
            EXECUTE FUNCTION update_users_updated_at();
    END IF;
END $$;

-- ===========================
-- 5. GROUPS TABLE TRIGGERS
-- ===========================

CREATE OR REPLACE FUNCTION update_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'groups') THEN
        DROP TRIGGER IF EXISTS trigger_groups_updated_at ON groups;
        CREATE TRIGGER trigger_groups_updated_at
            BEFORE UPDATE ON groups
            FOR EACH ROW
            EXECUTE FUNCTION update_groups_updated_at();
    END IF;
END $$;

-- ===========================
-- 6. UPDATE DEFAULT VALUES TO UTC
-- ===========================

-- Update default values for created_at and updated_at to use UTC
DO $$
BEGIN
    -- Update incidents table defaults
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'incidents') THEN
        ALTER TABLE incidents ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');
        ALTER TABLE incidents ALTER COLUMN updated_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');
    END IF;
    
    -- Update other tables if they exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alerts') THEN
        ALTER TABLE alerts ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');
        ALTER TABLE alerts ALTER COLUMN updated_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'services') THEN
        ALTER TABLE services ALTER COLUMN created_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');
        ALTER TABLE services ALTER COLUMN updated_at SET DEFAULT (NOW() AT TIME ZONE 'UTC');
    END IF;
END $$;

-- Add comments
COMMENT ON FUNCTION update_incidents_updated_at() IS 'Automatically updates updated_at to UTC time on incidents table updates';
COMMENT ON FUNCTION update_services_updated_at() IS 'Automatically updates updated_at to UTC time on services table updates';

-- Verification query
SELECT 
    schemaname,
    tablename,
    triggername,
    tgtype,
    tgenabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' 
AND triggername LIKE '%updated_at%'
ORDER BY tablename, triggername;
