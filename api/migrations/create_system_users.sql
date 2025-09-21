-- Create system users for automated actions
-- These users represent automated systems that can perform incident actions

-- Insert system users with fixed UUIDs for consistency
INSERT INTO users (id, name, email, role, team, provider_id, is_active, created_at, updated_at) VALUES
  -- Prometheus system user
  ('00000000-0000-0000-0000-000000000001', 'Prometheus', 'prometheus@system.local', 'system', 'System', '10000000-0000-0000-0000-000000000001', true, NOW(), NOW()),

  -- Datadog system user
  ('00000000-0000-0000-0000-000000000002', 'Datadog', 'datadog@system.local', 'system', 'System', '10000000-0000-0000-0000-000000000002', true, NOW(), NOW()),

  -- Grafana system user
  ('00000000-0000-0000-0000-000000000003', 'Grafana', 'grafana@system.local', 'system', 'System', '10000000-0000-0000-0000-000000000003', true, NOW(), NOW()),

  -- AWS CloudWatch system user
  ('00000000-0000-0000-0000-000000000004', 'AWS CloudWatch', 'cloudwatch@system.local', 'system', 'System', '10000000-0000-0000-0000-000000000004', true, NOW(), NOW()),

  -- Generic webhook system user
  ('00000000-0000-0000-0000-000000000005', 'Webhook System', 'webhook@system.local', 'system', 'System', '10000000-0000-0000-0000-000000000005', true, NOW(), NOW()),

  -- API system user (for programmatic access)
  ('00000000-0000-0000-0000-000000000006', 'API System', 'api@system.local', 'system', 'System', '10000000-0000-0000-0000-000000000006', true, NOW(), NOW())

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  team = EXCLUDED.team,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Create system role if it doesn't exist
-- This assumes you have a roles table or role enum
-- Adjust based on your actual user schema
