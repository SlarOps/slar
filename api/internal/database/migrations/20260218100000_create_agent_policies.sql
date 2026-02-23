-- Migration: Create agent_policies table for declarative policy engine
-- Allows org/project admins to define tool access policies by role
-- without requiring user prompts for every tool invocation.

CREATE TABLE agent_policies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    org_id          UUID NOT NULL,
    project_id      UUID,               -- NULL = org-wide policy
    name            TEXT NOT NULL,
    description     TEXT,
    effect          TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
    principal_type  TEXT NOT NULL CHECK (principal_type IN ('role', 'user', '*')),
    principal_value TEXT,               -- role name | user_id | NULL for '*'
    tool_pattern    TEXT NOT NULL DEFAULT '*',  -- fnmatch glob or exact match
    priority        INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID,
    CONSTRAINT uq_policy_name_org UNIQUE (org_id, name)
);

CREATE INDEX idx_agent_policies_org     ON agent_policies(org_id, is_active);
CREATE INDEX idx_agent_policies_project ON agent_policies(org_id, project_id, is_active);

-- Version counter for Python cache invalidation (1 row per org)
CREATE TABLE agent_policy_versions (
    org_id     UUID PRIMARY KEY,
    version    BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-increment version on any policy change
CREATE OR REPLACE FUNCTION fn_bump_policy_version() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO agent_policy_versions(org_id, version, updated_at)
        VALUES (COALESCE(NEW.org_id, OLD.org_id), 1, NOW())
    ON CONFLICT (org_id) DO UPDATE
        SET version = agent_policy_versions.version + 1, updated_at = NOW();
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bump_policy_version
AFTER INSERT OR UPDATE OR DELETE ON agent_policies
FOR EACH ROW EXECUTE FUNCTION fn_bump_policy_version();

-- Auto-update updated_at on agent_policies
CREATE OR REPLACE FUNCTION fn_update_agent_policies_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policies_updated_at
BEFORE UPDATE ON agent_policies
FOR EACH ROW EXECUTE FUNCTION fn_update_agent_policies_updated_at();
