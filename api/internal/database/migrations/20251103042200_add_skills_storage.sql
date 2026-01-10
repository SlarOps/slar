-- Add skills storage support to existing user buckets
-- Skills will be stored in {user_id}/skills/ directory
-- File format: {user_id}/skills/{skill-name}.skill or {skill-name}.zip

-- No new bucket needed - skills will use existing user buckets
-- Just document the storage structure:

-- Storage Structure:
-- {user_id}/
--   ├── .mcp.json           (MCP configuration)
--   └── skills/             (Skills directory)
--       ├── skill1.skill    (Individual skill file)
--       ├── skill2.skill
--       └── skill-bundle.zip (Zipped skill bundle)

-- RLS policies already exist from 20251102235711_storage_rls_policies.sql
-- Users can read/write files in their own bucket, including skills/ subdirectory

-- This migration serves as documentation only
SELECT 'Skills storage structure documented' AS status;
