-- Migration: Create skill repositories and installed skills tables
-- Option 1B: Separate Skill Tab - Support standalone skill repositories
-- Date: 2026-02-14

-- ============================================================
-- Table: skill_repositories
-- Stores skill-only repositories (no marketplace.json required)
-- ============================================================

CREATE TABLE IF NOT EXISTS skill_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,  -- Repository name (e.g., "openskills")
    repository_url TEXT NOT NULL,  -- GitHub URL
    branch TEXT NOT NULL DEFAULT 'main',
    skills JSONB,  -- Array of discovered skills: [{"name": "...", "description": "...", "path": "..."}]
    git_commit_sha TEXT,  -- Current commit SHA
    credential_name TEXT,  -- Optional: Vault credential for private repos
    status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'inactive' | 'error'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,  -- Last git fetch time

    -- Unique constraint: one repo per user
    CONSTRAINT unique_user_skill_repo UNIQUE (user_id, name)
);

-- Indexes for skill_repositories
CREATE INDEX IF NOT EXISTS idx_skill_repositories_user_id ON skill_repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_repositories_status ON skill_repositories(status);
CREATE INDEX IF NOT EXISTS idx_skill_repositories_user_status ON skill_repositories(user_id, status);

-- ============================================================
-- Table: installed_skills
-- Tracks individually installed skills (not entire plugins)
-- ============================================================

CREATE TABLE IF NOT EXISTS installed_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,  -- Skill name (e.g., "vnstock-analyzer")
    repository_name TEXT NOT NULL,  -- Reference to skill_repositories.name
    skill_path TEXT NOT NULL,  -- Relative path to SKILL.md (e.g., "vnstock-analyzer/SKILL.md")
    version TEXT,  -- Skill version (from frontmatter or repo commit)
    status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'inactive'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint: one skill per user per repository
    CONSTRAINT unique_user_skill_install UNIQUE (user_id, skill_name, repository_name)
);

-- Indexes for installed_skills
CREATE INDEX IF NOT EXISTS idx_installed_skills_user_id ON installed_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_installed_skills_repository ON installed_skills(repository_name);
CREATE INDEX IF NOT EXISTS idx_installed_skills_user_repo ON installed_skills(user_id, repository_name);
CREATE INDEX IF NOT EXISTS idx_installed_skills_status ON installed_skills(status);

-- ============================================================
-- Comments for documentation
-- ============================================================

COMMENT ON TABLE skill_repositories IS 'Skill-only repositories that do not require marketplace.json structure';
COMMENT ON TABLE installed_skills IS 'Individual skills installed by users from skill repositories';

COMMENT ON COLUMN skill_repositories.skills IS 'JSONB array of discovered skills with metadata: [{"name": "skill-name", "description": "...", "path": "path/to/SKILL.md"}]';
COMMENT ON COLUMN installed_skills.skill_path IS 'Relative path from repository root to SKILL.md file';
COMMENT ON COLUMN installed_skills.repository_name IS 'References skill_repositories.name (not ID for human-readable lookup)';
