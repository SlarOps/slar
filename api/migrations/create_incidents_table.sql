create table public.incidents (
  id uuid not null,
  title text not null,
  description text null,
  status text not null default 'triggered'::text,
  urgency text not null default 'high'::text,
  priority text null,
  created_at timestamp without time zone not null default (now() AT TIME ZONE 'UTC'::text),
  updated_at timestamp without time zone not null default (now() AT TIME ZONE 'UTC'::text),
  assigned_to uuid null,
  assigned_at timestamp without time zone null,
  acknowledged_by uuid null,
  acknowledged_at timestamp without time zone null,
  resolved_by uuid null,
  resolved_at timestamp without time zone null,
  source text not null,
  integration_id text null,
  service_id uuid null,
  external_id text null,
  external_url text null,
  escalation_policy_id uuid null,
  current_escalation_level integer null default 0,
  last_escalated_at timestamp without time zone null,
  escalation_status text null default 'none'::text,
  group_id uuid null,
  api_key_id text null,
  severity text null,
  incident_key text null,
  alert_count integer null default 1,
  labels jsonb null,
  custom_fields jsonb null,
  constraint incidents_pkey primary key (id),
  constraint incidents_assigned_to_fkey foreign KEY (assigned_to) references users (id) on update CASCADE on delete set null,
  constraint incidents_escalation_policy_fkey foreign KEY (escalation_policy_id) references escalation_policies (id) on update CASCADE on delete set null,
  constraint incidents_group_id_fkey foreign KEY (group_id) references groups (id) on update CASCADE on delete CASCADE,
  constraint incidents_resolved_by_fkey foreign KEY (resolved_by) references users (id) on update CASCADE on delete set null,
  constraint incidents_acknowledged_by_fkey foreign KEY (acknowledged_by) references users (id) on update CASCADE on delete set null,
  constraint valid_escalation_status check (
    (
      escalation_status = any (
        array[
          'none'::text,
          'pending'::text,
          'escalating'::text,
          'completed'::text,
          'stopped'::text
        ]
      )
    )
  ),
  constraint valid_status check (
    (
      status = any (
        array[
          'triggered'::text,
          'acknowledged'::text,
          'resolved'::text
        ]
      )
    )
  ),
  constraint valid_urgency check (
    (urgency = any (array['low'::text, 'high'::text]))
  )
) TABLESPACE pg_default;

create index IF not exists idx_incidents_service_id on public.incidents using btree (service_id) TABLESPACE pg_default;

create index IF not exists idx_incidents_status on public.incidents using btree (status) TABLESPACE pg_default;

create index IF not exists idx_incidents_assigned_to on public.incidents using btree (assigned_to) TABLESPACE pg_default;

create index IF not exists idx_incidents_created_at on public.incidents using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_incidents_group_id on public.incidents using btree (group_id) TABLESPACE pg_default;

create index IF not exists idx_incidents_incident_key on public.incidents using btree (incident_key) TABLESPACE pg_default;

create index IF not exists idx_incidents_external_id on public.incidents using btree (external_id) TABLESPACE pg_default;

create trigger trigger_incident_assigned_at BEFORE INSERT
or
update on incidents for EACH row
execute FUNCTION set_incident_assigned_at ();

create trigger trigger_incidents_updated_at BEFORE
update on incidents for EACH row
execute FUNCTION update_incidents_updated_at ();
