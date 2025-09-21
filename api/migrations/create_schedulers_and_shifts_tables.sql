-- Migration: Create schedulers and shifts tables (new scheduling model)

-- Schedulers: containers for shifts
CREATE TABLE IF NOT EXISTS public.schedulers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_name text,
  group_id uuid NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  rotation_type text NOT NULL DEFAULT 'manual', -- manual, round_robin, weekly
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text
);

CREATE INDEX IF NOT EXISTS idx_schedulers_group ON public.schedulers(group_id);
CREATE INDEX IF NOT EXISTS idx_schedulers_active ON public.schedulers(is_active);

ALTER TABLE public.schedulers
  ADD CONSTRAINT IF NOT EXISTS fk_schedulers_group
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

-- Shifts: concrete assignments within a scheduler
CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduler_id uuid NOT NULL,
  rotation_cycle_id uuid NULL,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  shift_type text NOT NULL, -- daily, weekly, custom
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_recurring boolean NOT NULL DEFAULT false,
  rotation_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text,
  service_id uuid NULL,
  schedule_scope text NOT NULL DEFAULT 'group' -- group or service
);

CREATE INDEX IF NOT EXISTS idx_shifts_scheduler ON public.shifts(scheduler_id);
CREATE INDEX IF NOT EXISTS idx_shifts_group ON public.shifts(group_id);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON public.shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_active ON public.shifts(is_active);
CREATE INDEX IF NOT EXISTS idx_shifts_time ON public.shifts(start_time, end_time);

ALTER TABLE public.shifts
  ADD CONSTRAINT IF NOT EXISTS fk_shifts_scheduler
    FOREIGN KEY (scheduler_id) REFERENCES public.schedulers(id) ON DELETE CASCADE;
ALTER TABLE public.shifts
  ADD CONSTRAINT IF NOT EXISTS fk_shifts_rotation_cycle
    FOREIGN KEY (rotation_cycle_id) REFERENCES public.rotation_cycles(id) ON DELETE SET NULL;
ALTER TABLE public.shifts
  ADD CONSTRAINT IF NOT EXISTS fk_shifts_user
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
-- service_id optional; enable FK if services table is present
-- ALTER TABLE public.shifts
--   ADD CONSTRAINT fk_shifts_service
--     FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE SET NULL;

COMMENT ON TABLE public.schedulers IS 'Schedulers define who can be on-call and contain shifts.';
COMMENT ON TABLE public.shifts IS 'Shifts are time windows assigning users to on-call duty.';

