-- Migration: Create groups and group_members tables (core entities)

-- Groups table
CREATE TABLE IF NOT EXISTS public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL, -- escalation, team, project, department
  visibility text NOT NULL DEFAULT 'private', -- private, public, organization
  is_active boolean NOT NULL DEFAULT true,
  escalation_timeout integer NOT NULL DEFAULT 300, -- seconds
  escalation_method text NOT NULL DEFAULT 'sequential', -- parallel, sequential, round_robin
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_groups_active ON public.groups(is_active);
CREATE INDEX IF NOT EXISTS idx_groups_type ON public.groups(type);

-- Unique name per type (optional, relax if not desired)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_unique_name_per_type ON public.groups(name, type);

-- Group members table
CREATE TABLE IF NOT EXISTS public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member', -- member, leader, backup
  escalation_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notification_preferences jsonb NOT NULL DEFAULT '{}',
  added_at timestamptz NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_group_members_group ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON public.group_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_unique ON public.group_members(group_id, user_id) WHERE is_active = true;

-- Foreign keys (enable if referenced tables exist)
ALTER TABLE public.group_members
  ADD CONSTRAINT IF NOT EXISTS fk_group_members_group
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
ALTER TABLE public.group_members
  ADD CONSTRAINT IF NOT EXISTS fk_group_members_user
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

COMMENT ON TABLE public.groups IS 'Groups/teams that own services, schedules, and escalation policies.';
COMMENT ON TABLE public.group_members IS 'Membership of users in groups with optional escalation order.';

