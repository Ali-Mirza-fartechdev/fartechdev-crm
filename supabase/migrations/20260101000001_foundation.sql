-- FAR Tech CRM · 0001 · foundation: extensions, enums, helpers, identity, permissions
-- Independent of any previous CRM. Reference data only; no business records are seeded.

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ───────────── enums ─────────────
create type public.app_role as enum
  ('super_admin','cso','sales_executive','project_manager','team_lead','developer','finance');
create type public.lead_status as enum
  ('new','contacting','connected','in_conversation','no_response','qualified','converted','lost','archived');
create type public.lead_source as enum
  ('linkedin','instagram','facebook','x','whatsapp','referral','website','other');
create type public.priority_level as enum ('low','medium','high','urgent');
create type public.follow_up_type as enum ('call','email','meeting','message','whatsapp','linkedin','other');
create type public.follow_up_status as enum ('pending','completed','cancelled');
create type public.project_status as enum ('planning','active','on_hold','completed','cancelled');
create type public.task_status as enum ('todo','in_progress','in_review','blocked','done','cancelled');
create type public.invoice_status as enum ('draft','sent','void');

-- ───────────── generic trigger helpers ─────────────
create function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create function app.set_created_by() returns trigger language plpgsql as $$
begin
  -- A browser-supplied created_by is never trusted: authenticated callers always own what they create.
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;

create function app.is_valid_tz(tz text) returns boolean language sql stable as $$
  select exists (select 1 from pg_timezone_names where name = tz)
$$;

-- ───────────── organisation settings (singleton) ─────────────
create table public.organization_settings (
  id boolean primary key default true check (id),
  company_name text not null default 'FAR Tech & Developers',
  default_timezone text not null default 'Asia/Karachi' check (app.is_valid_tz(default_timezone)),
  default_currency char(3) not null default 'USD',
  overdue_notice_minutes int not null default 30 check (overdue_notice_minutes between 1 and 10080),
  updated_at timestamptz not null default now()
);
insert into public.organization_settings default values;
create trigger trg_org_touch before update on public.organization_settings
  for each row execute function app.touch_updated_at();

-- ───────────── profiles (application identity; auth identity lives in auth.users) ─────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  username citext not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  role public.app_role not null,
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  timezone text not null default 'Asia/Karachi' check (app.is_valid_tz(timezone)),
  phone text check (phone is null or char_length(phone) <= 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles(role) where is_active;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ───────────── permission matrix ─────────────
create table public.role_permissions (
  role public.app_role not null,
  permission text not null,
  primary key (role, permission)
);

insert into public.role_permissions(role, permission) values
 -- Super Admin
 ('super_admin','users.manage'),('super_admin','settings.manage'),('super_admin','audit.view'),
 ('super_admin','leads.view_all'),('super_admin','leads.create'),('super_admin','leads.delete'),
 ('super_admin','deals.view_all'),('super_admin','deals.write'),
 ('super_admin','clients.view_all'),('super_admin','clients.write'),('super_admin','clients.manage_all'),
 ('super_admin','followups.view_all'),('super_admin','followups.create'),
 ('super_admin','projects.view_all'),('super_admin','projects.manage'),
 ('super_admin','tasks.view_all'),('super_admin','tasks.create'),
 ('super_admin','finance.view'),('super_admin','finance.manage'),
 ('super_admin','reports.sales'),('super_admin','reports.projects'),('super_admin','reports.finance'),
 -- CSO: organisation-wide sales; read-only on delivery
 ('cso','leads.view_all'),('cso','leads.create'),('cso','leads.delete'),
 ('cso','deals.view_all'),('cso','deals.write'),
 ('cso','clients.view_all'),('cso','clients.write'),('cso','clients.manage_all'),
 ('cso','followups.view_all'),('cso','followups.create'),
 ('cso','projects.view_all'),('cso','reports.sales'),
 -- Sales Executive: own leads, deals, clients, follow-ups (scoping is enforced in RLS)
 ('sales_executive','leads.create'),('sales_executive','deals.write'),
 ('sales_executive','clients.write'),('sales_executive','followups.create'),
 -- Project Manager
 ('project_manager','clients.view_all'),('project_manager','followups.create'),
 ('project_manager','projects.view_all'),('project_manager','projects.manage'),
 ('project_manager','tasks.view_all'),('project_manager','tasks.create'),
 ('project_manager','reports.projects'),
 -- Team Lead: own projects only (scoped in policies/triggers)
 ('team_lead','tasks.create'),
 -- Finance
 ('finance','clients.view_all'),('finance','projects.view_all'),
 ('finance','finance.view'),('finance','finance.manage'),('finance','reports.finance');
-- Developer: no organisation-wide permissions; assigned work only.

-- ───────────── authorisation helpers (SECURITY DEFINER so policies can't recurse) ─────────────
create function app.is_active_user() returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

create function app.user_role() returns public.app_role
language sql stable security definer set search_path = public, app as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function app.has_perm(p text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.profiles pr
    join public.role_permissions rp on rp.role = pr.role
    where pr.id = auth.uid() and pr.is_active and rp.permission = p)
$$;

-- ───────────── user preferences ─────────────
create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light','dark','system')),
  sidebar_collapsed boolean not null default false,
  default_reminder_offsets int[] not null default '{15,0}'
    check (default_reminder_offsets <@ array[0,5,15,30,60,1440] and cardinality(default_reminder_offsets) <= 6),
  updated_at timestamptz not null default now()
);
create trigger trg_prefs_touch before update on public.user_preferences
  for each row execute function app.touch_updated_at();

-- ───────────── audit trail ─────────────
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events(created_at desc);
create index audit_events_actor_idx on public.audit_events(actor_id, created_at desc);

create function app.audit(p_action text, p_entity_type text, p_entity_id text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public, app as $$
  insert into public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_meta,'{}'::jsonb))
$$;

create function app.audit_profile_changes() returns trigger language plpgsql security definer
set search_path = public, app as $$
begin
  if new.role is distinct from old.role then
    perform app.audit('user.role_changed','profile', new.id::text,
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.is_active is distinct from old.is_active then
    perform app.audit(case when new.is_active then 'user.activated' else 'user.deactivated' end,
      'profile', new.id::text, '{}');
  end if;
  return new;
end $$;
create trigger trg_profiles_audit after update on public.profiles
  for each row execute function app.audit_profile_changes();
