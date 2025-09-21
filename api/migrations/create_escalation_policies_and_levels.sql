-- Migration: Create escalation_policies, escalation_levels, and alert_escalations (Datadog-style)

-- Escalation policies
CREATE TABLE IF NOT EXISTS public.escalation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  repeat_max_times integer NOT NULL DEFAULT 1,
  escalate_after_minutes integer NOT NULL DEFAULT 5,
  group_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_escalation_policies_group ON public.escalation_policies(group_id);
CREATE INDEX IF NOT EXISTS idx_escalation_policies_active ON public.escalation_policies(is_active);

ALTER TABLE public.escalation_policies
  ADD CONSTRAINT IF NOT EXISTS fk_escalation_policies_group
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

-- Escalation levels (grouped by level_number)
CREATE TABLE IF NOT EXISTS public.escalation_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL,
  level_number integer NOT NULL,
  target_type text NOT NULL, -- user, group, scheduler, current_schedule, external
  target_id text NULL,       -- UUID as text for flexible target types
  timeout_minutes integer NOT NULL DEFAULT 5,
  notification_methods jsonb NOT NULL DEFAULT '[]',
  message_template text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalation_levels_policy ON public.escalation_levels(policy_id);
CREATE INDEX IF NOT EXISTS idx_escalation_levels_step ON public.escalation_levels(level_number);

ALTER TABLE public.escalation_levels
  ADD CONSTRAINT IF NOT EXISTS fk_escalation_levels_policy
    FOREIGN KEY (policy_id) REFERENCES public.escalation_policies(id) ON DELETE CASCADE;

-- Alert escalations (history)
CREATE TABLE IF NOT EXISTS public.alert_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id text NOT NULL,
  escalation_policy_id uuid NOT NULL,
  escalation_level integer NOT NULL,
  target_type text NOT NULL,
  target_id text,
  status text NOT NULL, -- executing, completed, failed, acknowledged, timeout
  error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  response_time_seconds integer,
  notification_methods jsonb NOT NULL DEFAULT '[]',
  target_name text
);

CREATE INDEX IF NOT EXISTS idx_alert_escalations_alert ON public.alert_escalations(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_escalations_policy ON public.alert_escalations(escalation_policy_id);

-- Optional FKs (uncomment if tables exist at run time)
-- ALTER TABLE public.alert_escalations
--   ADD CONSTRAINT fk_alert_escalations_alert
--     FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE CASCADE;
ALTER TABLE public.alert_escalations
  ADD CONSTRAINT IF NOT EXISTS fk_alert_escalations_policy
    FOREIGN KEY (escalation_policy_id) REFERENCES public.escalation_policies(id) ON DELETE CASCADE;

