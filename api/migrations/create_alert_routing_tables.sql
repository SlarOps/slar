-- Migration: Create alert routing tables (tables, rules, logs)

-- Routing tables (like VPC route tables)
CREATE TABLE IF NOT EXISTS public.alert_routing_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_alert_routing_tables_active ON public.alert_routing_tables(is_active);
CREATE INDEX IF NOT EXISTS idx_alert_routing_tables_priority ON public.alert_routing_tables(priority);

-- Routing rules
CREATE TABLE IF NOT EXISTS public.alert_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_table_id uuid NOT NULL,
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  match_conditions jsonb NOT NULL DEFAULT '{}',
  target_group_id uuid,
  escalation_rule_id uuid,
  time_conditions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_table ON public.alert_routing_rules(routing_table_id);
CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_active ON public.alert_routing_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_priority ON public.alert_routing_rules(priority);

ALTER TABLE public.alert_routing_rules
  ADD CONSTRAINT IF NOT EXISTS fk_routing_rules_table
    FOREIGN KEY (routing_table_id) REFERENCES public.alert_routing_tables(id) ON DELETE CASCADE;
-- Optional foreign keys (uncomment if desired)
-- ALTER TABLE public.alert_routing_rules
--   ADD CONSTRAINT fk_routing_rules_group
--     FOREIGN KEY (target_group_id) REFERENCES public.groups(id) ON DELETE SET NULL;

-- Routing logs
CREATE TABLE IF NOT EXISTS public.alert_route_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id text,
  routing_table_id uuid,
  routing_rule_id uuid,
  target_group_id uuid,
  matched_at timestamptz NOT NULL DEFAULT NOW(),
  matched_reason text,
  match_conditions jsonb,
  alert_attributes jsonb,
  evaluation_time_ms integer,
  routing_table_name text,
  routing_rule_name text,
  target_group_name text
);

CREATE INDEX IF NOT EXISTS idx_alert_route_logs_alert ON public.alert_route_logs(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_route_logs_matched_at ON public.alert_route_logs(matched_at);

