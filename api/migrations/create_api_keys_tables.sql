-- Migration: Create API keys tables (api_keys, api_key_rate_limits, api_key_usage_logs, api_key_stats view)

-- Core API keys table
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  group_id uuid,
  name text NOT NULL,
  api_key text NOT NULL,      -- stored for lookup/regeneration (protect access)
  api_key_hash text NOT NULL, -- bcrypt hash for verification
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz,
  rate_limit_per_hour integer NOT NULL DEFAULT 1000,
  rate_limit_per_day integer NOT NULL DEFAULT 10000,
  total_requests integer NOT NULL DEFAULT 0,
  total_alerts_created integer NOT NULL DEFAULT 0,
  description text,
  environment text NOT NULL,
  created_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_unique_key ON public.api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_group ON public.api_keys(group_id);

ALTER TABLE public.api_keys
  ADD CONSTRAINT IF NOT EXISTS fk_api_keys_user
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
-- Optional: link to group
ALTER TABLE public.api_keys
  ADD CONSTRAINT IF NOT EXISTS fk_api_keys_group
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;

-- Rate limit window counters
CREATE TABLE IF NOT EXISTS public.api_key_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  window_type text NOT NULL, -- hour, day
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_rate_limits_window ON public.api_key_rate_limits(api_key_id, window_start, window_type);
ALTER TABLE public.api_key_rate_limits
  ADD CONSTRAINT IF NOT EXISTS fk_api_rate_limits_key
    FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;

-- Usage logs for observability
CREATE TABLE IF NOT EXISTS public.api_key_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL,
  endpoint text NOT NULL,
  method text NOT NULL,
  ip_address text,
  user_agent text,
  request_size integer,
  response_status integer,
  response_time_ms integer,
  alert_id text,
  alert_title text,
  alert_severity text,
  request_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key ON public.api_key_usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_time ON public.api_key_usage_logs(created_at);
ALTER TABLE public.api_key_usage_logs
  ADD CONSTRAINT IF NOT EXISTS fk_api_usage_key
    FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;

-- Simple stats view to satisfy API calls (can be enhanced later)
CREATE OR REPLACE VIEW public.api_key_stats AS
SELECT 
  k.id,
  k.name,
  k.user_id,
  ''::text AS user_name,
  ''::text AS user_email,
  k.group_id,
  ''::text AS group_name,
  k.environment,
  k.is_active,
  k.created_at,
  k.last_used_at,
  k.total_requests,
  k.total_alerts_created,
  k.rate_limit_per_hour,
  k.rate_limit_per_day,
  0::integer AS requests_last_24h,
  0::integer AS alerts_last_24h,
  0::integer AS errors_last_24h,
  0::integer AS avg_response_time_ms,
  'ok'::text AS status
FROM public.api_keys k;

