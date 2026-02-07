-- Migration: Add UNIQUE constraint on email and create user_identities table
-- Purpose: Enable email-based user lookup for multi-provider authentication
-- Date: 2026-02-03

-- =============================================================================
-- STEP 1: Add index on email for performance (before adding unique constraint)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- =============================================================================
-- STEP 2: Add UNIQUE constraint on email
-- NOTE: This will fail if there are duplicate emails. Run cleanup first:
--   SELECT email, COUNT(*), array_agg(id) FROM users GROUP BY email HAVING COUNT(*) > 1;
-- =============================================================================
DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_email_unique' AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
        RAISE NOTICE 'Added UNIQUE constraint on users.email';
    ELSE
        RAISE NOTICE 'UNIQUE constraint on users.email already exists';
    END IF;
END $$;

-- =============================================================================
-- STEP 3: Create user_identities table for multi-provider support
-- This allows one user to have multiple linked identity providers
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Link to users table
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Identity provider info
    provider TEXT NOT NULL,           -- 'oidc', 'dex', 'cf-access', 'google', etc.
    provider_sub TEXT NOT NULL,       -- Original 'sub' claim from IdP (unique per provider)
    
    -- Metadata
    email_at_link TEXT,               -- Email when this identity was linked
    provider_metadata JSONB,          -- Additional provider-specific data
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    
    -- Constraints
    UNIQUE(provider, provider_sub)    -- Same provider+sub can only link to one user
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider_sub ON user_identities(provider, provider_sub);

-- =============================================================================
-- STEP 4: Migrate existing provider data to user_identities
-- This preserves existing provider_id mappings
-- =============================================================================
INSERT INTO user_identities (user_id, provider, provider_sub, email_at_link, created_at, last_used_at)
SELECT 
    id as user_id,
    COALESCE(provider, 'oidc') as provider,
    COALESCE(provider_id::text, id::text) as provider_sub,  -- Use provider_id or fallback to id
    email as email_at_link,
    created_at,
    updated_at as last_used_at
FROM users
WHERE id IS NOT NULL
ON CONFLICT (provider, provider_sub) DO NOTHING;

-- =============================================================================
-- STEP 5: Add comments for documentation
-- =============================================================================
COMMENT ON TABLE user_identities IS 'Stores linked identity providers for each user. Enables multi-provider authentication (Google, GitHub, CF Access, etc.) with account linking based on email.';
COMMENT ON COLUMN user_identities.provider IS 'Identity provider name: oidc, dex, cf-access, google, github, etc.';
COMMENT ON COLUMN user_identities.provider_sub IS 'The "sub" (subject) claim from the identity provider - unique per provider';
COMMENT ON COLUMN user_identities.email_at_link IS 'Email address at the time this identity was linked - for audit purposes';
