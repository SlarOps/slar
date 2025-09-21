-- Migration: Minimal legacy escalation_rules table (for AlertService LEFT JOIN)
-- If you fully migrated to escalation_policies, this can be kept minimal.

CREATE TABLE IF NOT EXISTS public.escalation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalation_rules_name ON public.escalation_rules(name);

