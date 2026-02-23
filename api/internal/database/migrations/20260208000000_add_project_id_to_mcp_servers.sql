-- Add project_id to user_mcp_servers if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_mcp_servers' AND column_name = 'project_id') THEN
        ALTER TABLE user_mcp_servers ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Drop the old unique constraint (user_id, server_name)
ALTER TABLE user_mcp_servers DROP CONSTRAINT IF EXISTS unique_user_mcp_server;

-- We want to allow:
-- 1. Personal servers: (user_id, server_name) where project_id IS NULL
-- 2. Project servers: (project_id, server_name) where project_id IS NOT NULL

-- For Postgres 15+, we can use NULLs NOT DISTINCT in unique, but let's stick to partial indexes or a cleaner constraints approach for compatibility.
-- Actually, simple unique on (project_id, server_name) would allow multiple NULL project_ids (which is what we want for personal servers? No, personal servers are user-scoped).

-- Existing was: unique (user_id, server_name).
-- If we just add project_id, and keep user_id for personal servers, we have two types of records.
-- A project server might have user_id set (creator) or not?
-- Best practice:
-- - Personal: user_id=X, project_id=NULL.
-- - Project: user_id=X (creator/owner), project_id=Y.

-- So we need TWO unique constraints (partial indexes):

-- 1. Unique server name per user for personal servers (project_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_mcp_server_personal 
ON user_mcp_servers (user_id, server_name) 
WHERE project_id IS NULL;

-- 2. Unique server name per project (regardless of who created it)
CREATE UNIQUE INDEX IF NOT EXISTS unique_project_mcp_server 
ON user_mcp_servers (project_id, server_name) 
WHERE project_id IS NOT NULL;
