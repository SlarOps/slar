-- Migration: Create rotation_cycles table (used by scheduling/shifts)

CREATE TABLE IF NOT EXISTS public.rotation_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  rotation_type text NOT NULL, -- daily, weekly, custom
  rotation_days integer NOT NULL DEFAULT 0, -- 1=daily, 7=weekly, etc.
  start_date date NOT NULL,
  start_time text NOT NULL, -- kept as text to match Go model scanning
  end_time text NOT NULL,   -- kept as text to match Go model scanning
  member_order jsonb NOT NULL DEFAULT '[]', -- array of user IDs in order
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_rotation_cycles_group ON public.rotation_cycles(group_id);
CREATE INDEX IF NOT EXISTS idx_rotation_cycles_active ON public.rotation_cycles(is_active);

ALTER TABLE public.rotation_cycles
  ADD CONSTRAINT IF NOT EXISTS fk_rotation_cycles_group
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

COMMENT ON TABLE public.rotation_cycles IS 'Automatic rotation configuration per group for on-call scheduling.';

