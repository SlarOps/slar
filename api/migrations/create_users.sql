create table public.users (
  id uuid not null default gen_random_uuid (),
  name text not null,
  email text not null,
  phone text null,
  role text not null,
  team text not null,
  fcm_token text null,
  is_active boolean null default true,
  created_at timestamp without time zone not null,
  updated_at timestamp without time zone not null,
  provider text null,
  provider_id uuid not null,
  constraint users_pkey primary key (id),
  constraint users_id_key unique (id),
  constraint users_provider_id_key unique (provider_id)
) TABLESPACE pg_default;

create trigger trigger_users_updated_at BEFORE
update on users for EACH row
execute FUNCTION update_users_updated_at ();