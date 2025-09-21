-- Migration: Create alerts table (legacy alerts used by AlertService)
-- This coexists with incidents. Keep for compatibility with current code paths.

CREATE TABLE IF NOT EXISTS public.alerts (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  severity text,
  source text,
  assigned_to uuid,
  assigned_at timestamptz,
  acked_by uuid,
  acked_at timestamptz,
  escalation_rule_id uuid, -- legacy field (JOIN in AlertService)
  current_escalation_level integer DEFAULT 0,
  last_escalated_at timestamptz,
  escalation_status text DEFAULT 'none',
  group_id uuid
);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON public.alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_group ON public.alerts(group_id);

-- Optional foreign keys (uncomment if desired)
-- ALTER TABLE public.alerts
--   ADD CONSTRAINT fk_alerts_assigned_to FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;
-- ALTER TABLE public.alerts
--   ADD CONSTRAINT fk_alerts_group FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;

