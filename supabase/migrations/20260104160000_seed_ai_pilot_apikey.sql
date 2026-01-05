-- Seed AI Pilot System User and API Key
-- This enables AI Pilot to authenticate via APIKeyService (database lookup)

-- Enable pgcrypto for bcrypt hashing
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create AI Pilot System User (if not exists)
INSERT INTO users (id, name, email, phone, role, team, fcm_token, is_active, created_at, updated_at, provider, provider_id)
VALUES (
    '00000000-0000-0000-0000-000000000100',
    'AI Pilot',
    'ai-pilot@system.local',
    'system',
    'System',
    'System',
    'System',
    true,
    NOW(),
    NOW(),
    'system',
    '10000000-0000-0000-0000-000000000100'
) ON CONFLICT (id) DO NOTHING;

-- 2. Create API Key for AI Pilot
-- Key format: dev_<24-char-random>
-- The actual key value is stored in api_key column (visible only during creation)
-- The bcrypt hash is stored in api_key_hash for validation
INSERT INTO api_keys (
    id,
    user_id,
    name,
    api_key,
    api_key_hash,
    permissions,
    description,
    environment,
    is_active,
    expires_at,
    rate_limit_per_hour,
    rate_limit_per_day,
    created_by
)
VALUES (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000100', -- AI Pilot user
    'AI Pilot Internal Key',
    'dev_aipilot_internal_key01', -- Visible key (for dev setup - copy this to SLAR_API_TOKEN)
    extensions.crypt('dev_aipilot_internal_key01', extensions.gen_salt('bf')), -- BCrypt hash
    ARRAY['read:incidents', 'write:incidents', 'read:services', 'read:logs', 'read:metrics', 'create_alerts', 'read_alerts'],
    'Internal API key for AI Pilot incident analysis worker',
    'development',
    true,
    NULL, -- Never expires
    10000, -- 10k requests/hour
    100000, -- 100k requests/day
    '00000000-0000-0000-0000-000000000100'
) ON CONFLICT (id) DO NOTHING;

-- Output for reference
DO $$
BEGIN
    RAISE NOTICE 'AI Pilot API Key seeded. Set SLAR_API_TOKEN=dev_aipilot_internal_key01';
END $$;
