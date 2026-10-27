-- FAR Tech CRM: COMPLETE database setup (migrations 0001-0008). ONLY for a brand-new empty Supabase project.

-- ===== 20260101000001_foundation.sql =====
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

-- ===== 20260101000002_core_schema.sql =====
-- FAR Tech CRM · 0002 · core business tables (RLS is enabled and policies are defined in 0003)

-- ───────────── clients ─────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  contact_name text check (char_length(contact_name) <= 120),
  email citext check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  website text check (char_length(website) <= 300),
  industry text check (char_length(industry) <= 120),
  address text check (char_length(address) <= 500),
  country text check (char_length(country) <= 80),
  notes text check (char_length(notes) <= 10000),
  is_active boolean not null default true,
  owner_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_owner_idx on public.clients(owner_id);
create index clients_name_idx on public.clients using gin (to_tsvector('simple', name));

-- ───────────── leads ─────────────
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  company text check (char_length(company) <= 200),
  job_title text check (char_length(job_title) <= 160),
  email citext check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  linkedin_url text check (char_length(linkedin_url) <= 400),
  website text check (char_length(website) <= 300),
  country text check (char_length(country) <= 80),
  industry text check (char_length(industry) <= 120),
  source public.lead_source not null default 'other',
  status public.lead_status not null default 'new',
  temperature text not null default 'cold' check (temperature in ('cold','warm','hot')),
  owner_id uuid references public.profiles(id),
  notes text check (char_length(notes) <= 10000),
  converted_client_id uuid references public.clients(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_owner_status_idx on public.leads(owner_id, status);
create index leads_status_idx on public.leads(status);
create index leads_created_idx on public.leads(created_at desc);

-- ───────────── pipeline + deals ─────────────
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position int not null unique,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  check (not (is_won and is_lost))
);
insert into public.pipeline_stages(name, position, is_won, is_lost) values
  ('Qualified',1,false,false),('Pain identified',2,false,false),('Call booked',3,false,false),
  ('Discovery done',4,false,false),('Proposal sent',5,false,false),('Negotiation',6,false,false),
  ('Closed won',7,true,false),('Closed lost',8,false,true);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  lead_id uuid references public.leads(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  stage_id uuid not null references public.pipeline_stages(id),
  value numeric(14,2) not null default 0 check (value >= 0),
  currency char(3) not null default 'USD',
  owner_id uuid not null references public.profiles(id),
  expected_close_date date,
  closed_at timestamptz,
  lost_reason text check (char_length(lost_reason) <= 500),
  notes text check (char_length(notes) <= 10000),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lead_id is not null or client_id is not null)
);
create index deals_owner_idx on public.deals(owner_id);
create index deals_stage_idx on public.deals(stage_id);

create table public.deal_stage_history (
  id bigint generated always as identity primary key,
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id),
  to_stage_id uuid not null references public.pipeline_stages(id),
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index deal_stage_history_deal_idx on public.deal_stage_history(deal_id, changed_at);

-- ───────────── projects, members, tasks ─────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (char_length(description) <= 10000),
  client_id uuid references public.clients(id) on delete restrict,
  status public.project_status not null default 'planning',
  project_manager_id uuid references public.profiles(id),
  team_lead_id uuid references public.profiles(id),
  start_date date,
  due_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index projects_pm_idx on public.projects(project_manager_id);
create index projects_tl_idx on public.projects(team_lead_id);
create index projects_client_idx on public.projects(client_id);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members(user_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 10000),
  status public.task_status not null default 'todo',
  priority public.priority_level not null default 'medium',
  assigned_to uuid references public.profiles(id),
  due_date date,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_assignee_idx on public.tasks(assigned_to, status);

-- ───────────── activity history ─────────────
create table public.activities (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('lead','client','deal','project','task')),
  entity_id uuid not null,
  actor_id uuid references public.profiles(id),
  kind text not null check (char_length(kind) <= 40),
  summary text not null check (char_length(summary) <= 5000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activities_entity_idx on public.activities(entity_type, entity_id, created_at desc);

-- ───────────── notifications (written only by SECURITY DEFINER code) ─────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (char_length(type) <= 60),
  title text not null check (char_length(title) <= 200),
  body text check (char_length(body) <= 2000),
  entity_type text check (entity_type in ('lead','client','deal','project','task','invoice')),
  entity_id uuid,
  follow_up_id uuid,                      -- FK added in 0004
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_uidx on public.notifications(dedupe_key) where dedupe_key is not null;
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create function app.notify(p_user uuid, p_type text, p_title text, p_body text,
  p_entity_type text, p_entity_id uuid, p_link text, p_dedupe text default null, p_meta jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if p_user is null then return null; end if;
  insert into public.notifications(user_id, type, title, body, entity_type, entity_id, link, dedupe_key, metadata)
  values (p_user, p_type, p_title, p_body, p_entity_type, p_entity_id, p_link, p_dedupe, p_meta)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ───────────── finance ─────────────
create sequence public.invoice_number_seq;

create function app.next_invoice_number() returns text language sql security definer
set search_path = public, app as $$
  select 'FT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0')
$$;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default app.next_invoice_number(),
  client_id uuid not null references public.clients(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  status public.invoice_status not null default 'draft',
  currency char(3) not null default 'USD',
  issue_date date not null default current_date,
  due_date date not null,
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  notes text check (char_length(notes) <= 5000),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date >= issue_date)
);
create index invoices_client_idx on public.invoices(client_id);
create index invoices_due_idx on public.invoices(due_date) where status = 'sent';

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position int not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0)
);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method text not null default 'bank_transfer' check (method in ('bank_transfer','cash','card','cheque','online','other')),
  reference text check (char_length(reference) <= 200),
  notes text check (char_length(notes) <= 1000),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments(invoice_id);

-- Totals, received money and balances are always derived from line items and payments.
-- An invoiced amount is never counted as received.
create view public.invoice_balances with (security_invoker = true) as
select
  i.id as invoice_id, i.invoice_number, i.client_id, i.project_id, i.status, i.currency,
  i.issue_date, i.due_date,
  coalesce(s.subtotal, 0) as subtotal,
  round(coalesce(s.subtotal, 0) * i.tax_rate / 100, 2) as tax_amount,
  round(coalesce(s.subtotal, 0) * (1 + i.tax_rate / 100), 2) as total,
  coalesce(p.paid, 0) as amount_paid,
  round(coalesce(s.subtotal, 0) * (1 + i.tax_rate / 100), 2) - coalesce(p.paid, 0) as balance_due,
  case
    when i.status in ('draft','void') then i.status::text
    when coalesce(p.paid,0) >= round(coalesce(s.subtotal,0) * (1 + i.tax_rate/100), 2)
         and coalesce(s.subtotal,0) > 0 then 'paid'
    when coalesce(p.paid,0) > 0 then 'partially_paid'
    else 'unpaid' end as payment_state,
  (i.status = 'sent'
    and round(coalesce(s.subtotal,0) * (1 + i.tax_rate/100), 2) - coalesce(p.paid,0) > 0
    and i.due_date < (now() at time zone (select default_timezone from public.organization_settings))::date
  ) as is_overdue
from public.invoices i
left join (select invoice_id, sum(quantity * unit_price) as subtotal
           from public.invoice_items group by invoice_id) s on s.invoice_id = i.id
left join (select invoice_id, sum(amount) as paid
           from public.payments group by invoice_id) p on p.invoice_id = i.id;

-- ───────────── generic updated_at / created_by triggers ─────────────
do $$
declare t text;
begin
  foreach t in array array['clients','leads','deals','projects','tasks','invoices'] loop
    execute format('create trigger trg_%1$s_touch before update on public.%1$s for each row execute function app.touch_updated_at()', t);
    execute format('create trigger trg_%1$s_created_by before insert on public.%1$s for each row execute function app.set_created_by()', t);
  end loop;
end $$;

-- recorded_by is likewise never browser-trusted
create function app.set_recorded_by() returns trigger language plpgsql as $$
begin if auth.uid() is not null then new.recorded_by := auth.uid(); end if; return new; end $$;
create trigger trg_payments_recorded_by before insert on public.payments
  for each row execute function app.set_recorded_by();

-- A payment may never push received money above the invoice total.
create function app.guard_payment() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_total numeric; v_paid numeric; v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = new.invoice_id for update;
  if v_status <> 'sent' then
    raise exception 'Payments can only be recorded against sent invoices' using errcode = '22023';
  end if;
  select total into v_total from public.invoice_balances where invoice_id = new.invoice_id;
  select coalesce(sum(amount),0) into v_paid from public.payments where invoice_id = new.invoice_id;
  if v_paid + new.amount > v_total then
    raise exception 'Payment exceeds the outstanding balance (% due)', v_total - v_paid using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_payments_guard before insert on public.payments
  for each row execute function app.guard_payment();

-- Sent invoices are immutable apart from status/notes/due date; line items freeze once sent.
create function app.guard_invoice_items() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_inv uuid := coalesce(new.invoice_id, old.invoice_id); v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = v_inv;
  if v_status <> 'draft' then
    raise exception 'Line items can only be changed while the invoice is a draft' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_invoice_items_guard before insert or update or delete on public.invoice_items
  for each row execute function app.guard_invoice_items();

-- Audit sensitive financial actions
create function app.audit_finance() returns trigger language plpgsql security definer
set search_path = public, app as $$
begin
  if tg_table_name = 'payments' then
    perform app.audit('payment.' || lower(tg_op), 'payment', coalesce(new.id, old.id)::text,
      jsonb_build_object('invoice_id', coalesce(new.invoice_id, old.invoice_id), 'amount', coalesce(new.amount, old.amount)));
  else
    perform app.audit('invoice.' || lower(tg_op), 'invoice', coalesce(new.id, old.id)::text,
      jsonb_build_object('status', coalesce(new.status, old.status)));
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_invoices_audit after insert or update or delete on public.invoices
  for each row execute function app.audit_finance();
create trigger trg_payments_audit after insert or delete on public.payments
  for each row execute function app.audit_finance();

-- ===== 20260101000003_access_rules_rls.sql =====
-- FAR Tech CRM · 0003 · record visibility, workflow rules, activity logging, Row Level Security
-- Grants are applied in 0005 after every table exists (deny-by-default).

-- ───────────── visibility helpers (SECURITY DEFINER; explicit logic, no reliance on caller RLS) ─────────────
create function app.is_project_member(p_project uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.project_members where project_id = p_project and user_id = p_user)
$$;

create function app.can_see_project(p_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (
    select 1 from public.projects p
    where p.id = p_id and (
      app.has_perm('projects.view_all')
      or p.project_manager_id = auth.uid()
      or p.team_lead_id = auth.uid()
      or app.is_project_member(p.id, auth.uid())))
$$;

create function app.can_see_lead(p_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (
    select 1 from public.leads l
    where l.id = p_id and (app.has_perm('leads.view_all') or l.owner_id = auth.uid()))
$$;

create function app.can_see_client(p_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (
    select 1 from public.clients c
    where c.id = p_id and (
      app.has_perm('clients.view_all')
      or c.owner_id = auth.uid()
      or exists (select 1 from public.projects p
                 where p.client_id = c.id and app.can_see_project(p.id))))
$$;

create function app.can_see_deal(p_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (
    select 1 from public.deals d
    where d.id = p_id and (app.has_perm('deals.view_all') or d.owner_id = auth.uid()))
$$;

create function app.can_see_task(p_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (
    select 1 from public.tasks t
    join public.projects p on p.id = t.project_id
    where t.id = p_id and (
      app.has_perm('tasks.view_all')
      or t.assigned_to = auth.uid()
      or t.created_by = auth.uid()
      or p.team_lead_id = auth.uid()
      or p.project_manager_id = auth.uid()))
$$;


-- Policy helpers that consult *other* tables only. A SELECT policy that re-queries its own table by id
-- cannot see a row inserted in the same statement, which would break INSERT ... RETURNING.
create function app.client_visible_via_project(p_client uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.projects p where p.client_id = p_client and app.can_see_project(p.id))
$$;

create function app.is_project_lead_or_pm(p_project uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.projects p
                 where p.id = p_project and (p.team_lead_id = auth.uid() or p.project_manager_id = auth.uid()))
$$;

create function app.can_see_entity(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select case p_type
    when 'lead' then app.can_see_lead(p_id)
    when 'client' then app.can_see_client(p_id)
    when 'deal' then app.can_see_deal(p_id)
    when 'project' then app.can_see_project(p_id)
    when 'task' then app.can_see_task(p_id)
    else false end
$$;

-- ───────────── workflow rules: projects ─────────────
create function app.validate_project() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_role public.app_role;
begin
  if new.project_manager_id is not null then
    select role into v_role from public.profiles where id = new.project_manager_id and is_active;
    if v_role is null or v_role not in ('project_manager','super_admin') then
      raise exception 'Project manager must be an active Project Manager' using errcode = '22023';
    end if;
  end if;
  if new.team_lead_id is not null then
    select role into v_role from public.profiles where id = new.team_lead_id and is_active;
    if v_role is distinct from 'team_lead' then
      raise exception 'Team lead must be an active Team Lead' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger trg_projects_validate before insert or update of project_manager_id, team_lead_id on public.projects
  for each row execute function app.validate_project();

create function app.validate_project_member() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id = new.user_id and is_active;
  if v_role is null or v_role not in ('developer','team_lead') then
    raise exception 'Only active Developers or Team Leads can be project members' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_project_members_validate before insert or update on public.project_members
  for each row execute function app.validate_project_member();

-- ───────────── workflow rules: tasks (enforced in the database, not just the UI) ─────────────
--  • Project Manager / Super Admin assign to the project's Team Lead or an assigned member.
--  • A Team Lead (of that project only) delegates to Developers who are members of that project.
--  • A Developer can only move the status of a task assigned to them.
create function app.enforce_task_rules() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_proj public.projects;
  v_assignee_role public.app_role;
begin
  if v_uid is null then return new; end if;            -- trusted server context (migrations, jobs)
  v_role := app.user_role();
  if v_role is null then raise exception 'Inactive or unknown user' using errcode = '42501'; end if;

  select * into v_proj from public.projects where id = new.project_id;
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'A task cannot be moved to another project' using errcode = '22023';
  end if;

  if v_role = 'developer' then
    if tg_op = 'INSERT' then
      raise exception 'Developers cannot create tasks' using errcode = '42501';
    end if;
    if old.assigned_to is distinct from v_uid then
      raise exception 'You can only update tasks assigned to you' using errcode = '42501';
    end if;
    if new.status = 'cancelled' then
      raise exception 'Developers cannot cancel tasks' using errcode = '42501';
    end if;
    if (to_jsonb(new) - 'status' - 'completed_at' - 'updated_at')
       <> (to_jsonb(old) - 'status' - 'completed_at' - 'updated_at') then
      raise exception 'Developers can only change the status of their tasks' using errcode = '42501';
    end if;
  elsif v_role in ('project_manager','super_admin') then
    null;
  elsif v_role = 'team_lead' then
    if v_proj.team_lead_id is distinct from v_uid then
      raise exception 'You can only manage tasks in projects you lead' using errcode = '42501';
    end if;
  else
    raise exception 'Your role cannot modify tasks' using errcode = '42501';
  end if;

  if v_role <> 'developer' and new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    select role into v_assignee_role from public.profiles where id = new.assigned_to and is_active;
    if v_assignee_role is null then
      raise exception 'Assignee must be an active user' using errcode = '22023';
    end if;
    if v_role = 'team_lead' then
      if new.assigned_to <> v_uid
         and not (v_assignee_role = 'developer' and app.is_project_member(new.project_id, new.assigned_to)) then
        raise exception 'Team Leads can only assign to Developers on this project' using errcode = '42501';
      end if;
    elsif not (new.assigned_to = v_proj.team_lead_id or app.is_project_member(new.project_id, new.assigned_to)) then
      raise exception 'Assignee must be the project Team Lead or an assigned member' using errcode = '22023';
    end if;
  end if;

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger trg_tasks_rules before insert or update on public.tasks
  for each row execute function app.enforce_task_rules();

-- ───────────── invoice lifecycle guard ─────────────
create function app.guard_invoice_update() returns trigger language plpgsql as $$
begin
  if old.status = 'void' then
    raise exception 'A void invoice cannot be changed' using errcode = '22023';
  end if;
  if old.status = 'sent' and new.status = 'draft' then
    raise exception 'A sent invoice cannot return to draft' using errcode = '22023';
  end if;
  if old.status <> 'draft' and (new.client_id <> old.client_id or new.currency <> old.currency
       or new.tax_rate <> old.tax_rate or new.issue_date <> old.issue_date) then
    raise exception 'Issued invoices only allow status, due date and notes to change' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_invoices_guard before update on public.invoices
  for each row execute function app.guard_invoice_update();

-- ───────────── deal stage tracking ─────────────
create function app.deal_before() returns trigger language plpgsql as $$
declare v_won boolean; v_lost boolean;
begin
  select is_won, is_lost into v_won, v_lost from public.pipeline_stages where id = new.stage_id;
  if v_won or v_lost then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_at := null;
  end if;
  return new;
end $$;
create trigger trg_deals_before before insert or update of stage_id on public.deals
  for each row execute function app.deal_before();

create function app.deal_after() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_from text; v_to text;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history(deal_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, auth.uid());
    select name into v_to from public.pipeline_stages where id = new.stage_id;
    if tg_op = 'UPDATE' then select name into v_from from public.pipeline_stages where id = old.stage_id; end if;
    insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
    values ('deal', new.id, auth.uid(), case when tg_op = 'INSERT' then 'created' else 'stage_change' end,
      case when tg_op = 'INSERT' then 'Deal created in ' || v_to
           else 'Stage changed from ' || v_from || ' to ' || v_to end,
      jsonb_build_object('from', v_from, 'to', v_to));
  end if;
  return new;
end $$;
create trigger trg_deals_after after insert or update of stage_id on public.deals
  for each row execute function app.deal_after();

-- ───────────── activity logging + assignment notifications ─────────────
create function app.log_changes() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare
  v_type text := tg_argv[0];
  o jsonb; n jsonb;
  v_name text;
begin
  n := to_jsonb(new);
  o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_name := coalesce(n->>'full_name', n->>'title', n->>'name', '');
  if tg_op = 'INSERT' then
    insert into public.activities(entity_type, entity_id, actor_id, kind, summary)
    values (v_type, new.id, auth.uid(), 'created', initcap(v_type) || ' created');
  else
    if o->>'status' is distinct from n->>'status' then
      insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
      values (v_type, new.id, auth.uid(), 'status_change',
        'Status changed from ' || replace(o->>'status','_',' ') || ' to ' || replace(n->>'status','_',' '),
        jsonb_build_object('from', o->>'status', 'to', n->>'status'));
    end if;
    if coalesce(o->>'owner_id', o->>'assigned_to') is distinct from coalesce(n->>'owner_id', n->>'assigned_to') then
      insert into public.activities(entity_type, entity_id, actor_id, kind, summary)
      values (v_type, new.id, auth.uid(), 'assignment', 'Assignee changed');
    end if;
  end if;

  -- Tell the new assignee (never the person who made the change). Read via jsonb: the row type differs per table.
  if v_type = 'task' and n->>'assigned_to' is not null
     and (tg_op = 'INSERT' or n->>'assigned_to' is distinct from o->>'assigned_to')
     and (n->>'assigned_to')::uuid is distinct from auth.uid() then
    perform app.notify((n->>'assigned_to')::uuid, 'task_assigned', 'Task assigned to you', n->>'title',
      'task', new.id, '/tasks/' || new.id::text);
  elsif v_type = 'lead' and n->>'owner_id' is not null
     and (tg_op = 'INSERT' or n->>'owner_id' is distinct from o->>'owner_id')
     and (n->>'owner_id')::uuid is distinct from auth.uid() then
    perform app.notify((n->>'owner_id')::uuid, 'lead_assigned', 'Lead assigned to you', n->>'full_name',
      'lead', new.id, '/leads/' || new.id::text);
  end if;
  return new;
end $$;
create trigger trg_leads_log after insert or update on public.leads
  for each row execute function app.log_changes('lead');
create trigger trg_projects_log after insert or update on public.projects
  for each row execute function app.log_changes('project');
create trigger trg_tasks_log after insert or update on public.tasks
  for each row execute function app.log_changes('task');

-- ───────────── RPCs (public schema = API surface; every one authorises explicitly) ─────────────
create function public.add_note(p_entity_type text, p_entity_id uuid, p_text text)
returns bigint language plpgsql security definer set search_path = public, app as $$
declare v_id bigint;
begin
  if not app.can_see_entity(p_entity_type, p_entity_id) then
    raise exception 'Record not found or not permitted' using errcode = '42501';
  end if;
  if p_text is null or char_length(btrim(p_text)) = 0 or char_length(p_text) > 5000 then
    raise exception 'Note must be 1–5000 characters' using errcode = '22023';
  end if;
  insert into public.activities(entity_type, entity_id, actor_id, kind, summary)
  values (p_entity_type, p_entity_id, auth.uid(), 'note', btrim(p_text))
  returning id into v_id;
  return v_id;
end $$;

create function public.convert_lead_to_client(p_lead_id uuid)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_lead public.leads; v_client uuid;
begin
  if not (app.can_see_lead(p_lead_id) and app.has_perm('clients.write')) then
    raise exception 'Not permitted to convert this lead' using errcode = '42501';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.converted_client_id is not null then
    raise exception 'Lead is already converted' using errcode = '22023';
  end if;
  insert into public.clients(name, contact_name, email, phone, website, industry, country, owner_id, created_by)
  values (coalesce(nullif(btrim(v_lead.company), ''), v_lead.full_name), v_lead.full_name, v_lead.email,
          v_lead.phone, v_lead.website, v_lead.industry, v_lead.country, v_lead.owner_id, auth.uid())
  returning id into v_client;
  update public.leads set status = 'converted', converted_client_id = v_client where id = p_lead_id;
  insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
  values ('client', v_client, auth.uid(), 'created', 'Client created from lead ' || v_lead.full_name,
          jsonb_build_object('lead_id', p_lead_id));
  return v_client;
end $$;

-- A user clears their own forced-password-change flag (after Supabase Auth has accepted the new password)
create function public.clear_must_change_password() returns void
language sql security definer set search_path = public, app as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

-- ───────────── Row Level Security ─────────────
do $$
declare t text;
begin
  foreach t in array array['organization_settings','profiles','role_permissions','user_preferences','audit_events',
    'clients','leads','pipeline_stages','deals','deal_stage_history','projects','project_members','tasks',
    'activities','notifications','invoices','invoice_items','payments'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- identity & configuration
create policy profiles_select on public.profiles for select to authenticated using (app.is_active_user());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and app.is_active_user()) with check (id = auth.uid());
-- role / is_active / username are not in the UPDATE column grant, so users cannot escalate themselves (see 0005).

create policy role_permissions_select on public.role_permissions for select to authenticated using (app.is_active_user());
create policy org_select on public.organization_settings for select to authenticated using (app.is_active_user());
create policy org_update on public.organization_settings for update to authenticated
  using (app.has_perm('settings.manage')) with check (app.has_perm('settings.manage'));
create policy prefs_all on public.user_preferences for all to authenticated
  using (user_id = auth.uid() and app.is_active_user()) with check (user_id = auth.uid());
create policy audit_select on public.audit_events for select to authenticated using (app.has_perm('audit.view'));
create policy stages_select on public.pipeline_stages for select to authenticated using (app.is_active_user());
create policy stages_write on public.pipeline_stages for all to authenticated
  using (app.has_perm('settings.manage')) with check (app.has_perm('settings.manage'));

-- leads
create policy leads_select on public.leads for select to authenticated
  using (app.is_active_user() and (app.has_perm('leads.view_all') or owner_id = auth.uid()));
create policy leads_insert on public.leads for insert to authenticated
  with check (app.has_perm('leads.create') and (app.has_perm('leads.view_all') or owner_id = auth.uid()));
create policy leads_update on public.leads for update to authenticated
  using (app.has_perm('leads.create') and (app.has_perm('leads.view_all') or owner_id = auth.uid()))
  with check (app.has_perm('leads.view_all') or owner_id = auth.uid());
create policy leads_delete on public.leads for delete to authenticated
  using (app.has_perm('leads.delete'));

-- clients
create policy clients_select on public.clients for select to authenticated
  using (app.is_active_user() and (app.has_perm('clients.view_all') or owner_id = auth.uid()
         or app.client_visible_via_project(id)));
create policy clients_insert on public.clients for insert to authenticated
  with check (app.has_perm('clients.write') and (app.has_perm('clients.manage_all') or owner_id = auth.uid()));
create policy clients_update on public.clients for update to authenticated
  using (app.has_perm('clients.write') and (app.has_perm('clients.manage_all') or owner_id = auth.uid()))
  with check (app.has_perm('clients.manage_all') or owner_id = auth.uid());
create policy clients_delete on public.clients for delete to authenticated
  using (app.has_perm('clients.manage_all'));

-- deals
create policy deals_select on public.deals for select to authenticated
  using (app.is_active_user() and (app.has_perm('deals.view_all') or owner_id = auth.uid()));
create policy deals_insert on public.deals for insert to authenticated
  with check (app.has_perm('deals.write')
    and (app.has_perm('deals.view_all') or owner_id = auth.uid())
    and (lead_id is null or app.can_see_lead(lead_id))
    and (client_id is null or app.can_see_client(client_id)));
create policy deals_update on public.deals for update to authenticated
  using (app.has_perm('deals.write') and (app.has_perm('deals.view_all') or owner_id = auth.uid()))
  with check (app.has_perm('deals.view_all') or owner_id = auth.uid());
create policy deals_delete on public.deals for delete to authenticated
  using (app.has_perm('deals.view_all') and app.has_perm('deals.write'));
create policy deal_history_select on public.deal_stage_history for select to authenticated
  using (app.can_see_deal(deal_id));

-- projects, members, tasks
create policy projects_select on public.projects for select to authenticated
  using (app.is_active_user() and (app.has_perm('projects.view_all') or project_manager_id = auth.uid()
         or team_lead_id = auth.uid() or app.is_project_member(id, auth.uid())));
create policy projects_write on public.projects for all to authenticated
  using (app.has_perm('projects.manage')) with check (app.has_perm('projects.manage'));
create policy members_select on public.project_members for select to authenticated
  using (app.can_see_project(project_id));
create policy members_write on public.project_members for all to authenticated
  using (app.has_perm('projects.manage')) with check (app.has_perm('projects.manage'));

create policy tasks_select on public.tasks for select to authenticated
  using (app.is_active_user() and (app.has_perm('tasks.view_all') or assigned_to = auth.uid()
         or created_by = auth.uid() or app.is_project_lead_or_pm(project_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (app.has_perm('tasks.create'));
create policy tasks_update on public.tasks for update to authenticated
  using ((app.has_perm('tasks.view_all') or assigned_to = auth.uid() or created_by = auth.uid() or app.is_project_lead_or_pm(project_id))
         and (app.has_perm('tasks.create') or assigned_to = auth.uid()))
  with check (app.has_perm('tasks.create') or assigned_to = auth.uid());
create policy tasks_delete on public.tasks for delete to authenticated
  using (app.has_perm('projects.manage') or (app.has_perm('tasks.create') and created_by = auth.uid()));

-- activity & notifications
create policy activities_select on public.activities for select to authenticated
  using (app.can_see_entity(entity_type, entity_id));
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and app.is_active_user());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() and app.is_active_user()) with check (user_id = auth.uid());

-- finance (invoiced ≠ received; only Finance and Super Admin)
create policy invoices_select on public.invoices for select to authenticated using (app.has_perm('finance.view'));
create policy invoices_insert on public.invoices for insert to authenticated with check (app.has_perm('finance.manage'));
create policy invoices_update on public.invoices for update to authenticated
  using (app.has_perm('finance.manage')) with check (app.has_perm('finance.manage'));
create policy invoices_delete on public.invoices for delete to authenticated
  using (app.has_perm('finance.manage') and status = 'draft');
create policy items_select on public.invoice_items for select to authenticated using (app.has_perm('finance.view'));
create policy items_write on public.invoice_items for all to authenticated
  using (app.has_perm('finance.manage')) with check (app.has_perm('finance.manage'));
create policy payments_select on public.payments for select to authenticated using (app.has_perm('finance.view'));
create policy payments_insert on public.payments for insert to authenticated with check (app.has_perm('finance.manage'));
create policy payments_delete on public.payments for delete to authenticated using (app.has_perm('finance.manage'));

-- ===== 20260101000004_followups_reminders.sql =====
-- FAR Tech CRM · 0004 · follow-ups and the server-side reminder engine
--
-- Design
--  • follow_ups.due_at is an absolute UTC instant (timestamptz). The local date/time a person types is
--    converted to it on the SERVER with their IANA timezone, so every device agrees.
--  • "Overdue" is never stored: it is  status = 'pending' AND due_at < now().
--  • Each (follow-up, schedule_version, kind, offset) is one row in follow_up_reminders: a persistent queue.
--  • app.process_due_reminders() is idempotent. It claims rows with FOR UPDATE SKIP LOCKED, validates them
--    against the live follow-up, and writes the notification with a unique dedupe_key, all in ONE transaction:
--    a crash rolls everything back and the next run retries, so nothing is lost and nothing is duplicated.
--  • Rescheduling bumps schedule_version, cancelling every older pending occurrence; completing or
--    cancelling cancels all pending occurrences. History rows are kept.
--  • If the scheduler is down, rows with fire_at <= now() stay pending and are all delivered on resume.

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  follow_up_type public.follow_up_type not null default 'call',
  priority public.priority_level not null default 'medium',
  due_at timestamptz not null,
  timezone text not null check (app.is_valid_tz(timezone)),
  assigned_to uuid not null references public.profiles(id),
  created_by uuid references public.profiles(id),
  notes text check (char_length(notes) <= 5000),
  status public.follow_up_status not null default 'pending',
  reminder_offsets int[] not null default '{0}'
    check (reminder_offsets <@ array[0,5,15,30,60,1440] and cardinality(reminder_offsets) <= 6),
  schedule_version int not null default 1,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lead_id is null) <> (client_id is null))
);
create index follow_ups_assignee_pending_idx on public.follow_ups(assigned_to, due_at) where status = 'pending';
create index follow_ups_due_pending_idx on public.follow_ups(due_at) where status = 'pending';
create index follow_ups_lead_idx on public.follow_ups(lead_id, due_at desc);
create index follow_ups_client_idx on public.follow_ups(client_id, due_at desc);

create table public.follow_up_reminders (
  id uuid primary key default gen_random_uuid(),
  follow_up_id uuid not null references public.follow_ups(id) on delete cascade,
  schedule_version int not null,
  kind text not null check (kind in ('reminder','overdue')),
  offset_minutes int not null default 0,
  due_at timestamptz not null,               -- snapshot of the follow-up time this occurrence belongs to
  fire_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','fired','cancelled','skipped')),
  reason text,
  fired_at timestamptz,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (follow_up_id, schedule_version, kind, offset_minutes)      -- one occurrence, ever
);
create index follow_up_reminders_due_idx on public.follow_up_reminders(fire_at) where status = 'pending';

alter table public.notifications
  add constraint notifications_follow_up_fk foreign key (follow_up_id)
  references public.follow_ups(id) on delete cascade;
create index notifications_follow_up_idx on public.notifications(follow_up_id);

create table public.scheduler_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  fired int not null default 0,
  cancelled int not null default 0,
  skipped int not null default 0,
  max_lag_seconds numeric not null default 0
);
create index scheduler_runs_ran_idx on public.scheduler_runs(ran_at desc);

create trigger trg_follow_ups_touch before update on public.follow_ups
  for each row execute function app.touch_updated_at();
create trigger trg_follow_ups_created_by before insert on public.follow_ups
  for each row execute function app.set_created_by();

-- ───────────── queue maintenance ─────────────
create function app.rebuild_follow_up_reminders(p_id uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare f public.follow_ups; v_overdue int;
begin
  select * into f from public.follow_ups where id = p_id;
  if not found then return; end if;

  -- Invalidate stale occurrences (old schedule) or all of them (no longer pending)
  update public.follow_up_reminders
     set status = 'cancelled',
         reason = case when f.status <> 'pending' then 'follow_up_' || f.status::text else 'superseded' end
   where follow_up_id = p_id and status = 'pending'
     and (f.status <> 'pending' or schedule_version <> f.schedule_version);

  if f.status <> 'pending' then return; end if;

  select greatest(overdue_notice_minutes, 1) into v_overdue from public.organization_settings;

  insert into public.follow_up_reminders
    (follow_up_id, schedule_version, kind, offset_minutes, due_at, fire_at, status, reason)
  select f.id, f.schedule_version, 'reminder', o, f.due_at, f.due_at - make_interval(mins => o),
         case when o > 0 and f.due_at - make_interval(mins => o) < now() then 'skipped' else 'pending' end,
         case when o > 0 and f.due_at - make_interval(mins => o) < now() then 'offset_already_passed' end
    from (select distinct unnest(f.reminder_offsets) as o) x
  union all
  select f.id, f.schedule_version, 'overdue', 0, f.due_at, f.due_at + make_interval(mins => v_overdue), 'pending', null
  on conflict (follow_up_id, schedule_version, kind, offset_minutes) do nothing;
end $$;

create function app.follow_up_before() returns trigger language plpgsql security definer
set search_path = public, app as $$
begin
  if not exists (select 1 from public.profiles where id = new.assigned_to and is_active) then
    raise exception 'Assignee must be an active user' using errcode = '22023';
  end if;
  new.reminder_offsets := coalesce((select array_agg(distinct o order by o) from unnest(new.reminder_offsets) o), '{}');

  if tg_op = 'INSERT' then
    new.schedule_version := 1;
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to and auth.uid() is not null
     and not (app.has_perm('followups.view_all') or old.created_by = auth.uid()) then
    raise exception 'Only the creator or a sales leader can reassign a follow-up' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'completed' then now() end;
    new.cancelled_at := case when new.status = 'cancelled' then now() end;
    if new.status <> 'completed' then new.completed_by := null; end if;
  end if;

  if new.status = 'pending' and (new.due_at is distinct from old.due_at
      or new.reminder_offsets is distinct from old.reminder_offsets
      or old.status <> 'pending') then
    new.schedule_version := old.schedule_version + 1;
  end if;
  return new;
end $$;
create trigger trg_follow_ups_before before insert or update on public.follow_ups
  for each row execute function app.follow_up_before();

create function app.follow_up_after() returns trigger language plpgsql security definer
set search_path = public, app as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status
     or new.schedule_version is distinct from old.schedule_version then
    perform app.rebuild_follow_up_reminders(new.id);
  end if;
  return new;
end $$;
create trigger trg_follow_ups_after after insert or update on public.follow_ups
  for each row execute function app.follow_up_after();

-- ───────────── authorisation for follow-up actions ─────────────
create function app.can_manage_follow_up(p_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (
    select 1 from public.follow_ups f
    where f.id = p_id and (f.assigned_to = auth.uid() or f.created_by = auth.uid()
                           or app.has_perm('followups.view_all')))
$$;

create function app.log_follow_up(p_f public.follow_ups, p_kind text, p_summary text) returns void
language sql security definer set search_path = public, app as $$
  insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
  values (case when p_f.lead_id is not null then 'lead' else 'client' end,
          coalesce(p_f.lead_id, p_f.client_id), auth.uid(), p_kind, p_summary,
          jsonb_build_object('follow_up_id', p_f.id))
$$;

-- ───────────── RPCs ─────────────
create function public.create_follow_up(
  p_lead_id uuid, p_client_id uuid, p_title text, p_type public.follow_up_type,
  p_local_date date, p_local_time time, p_timezone text, p_assigned_to uuid default null,
  p_notes text default null, p_priority public.priority_level default 'medium',
  p_reminder_offsets int[] default '{0}')
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_due timestamptz; v_assignee uuid; v_id uuid; f public.follow_ups;
begin
  if not app.has_perm('followups.create') then
    raise exception 'Your role cannot schedule follow-ups' using errcode = '42501';
  end if;
  if (p_lead_id is null) = (p_client_id is null) then
    raise exception 'Provide exactly one of lead or client' using errcode = '22023';
  end if;
  if (p_lead_id is not null and not app.can_see_lead(p_lead_id))
     or (p_client_id is not null and not app.can_see_client(p_client_id)) then
    raise exception 'Record not found or not permitted' using errcode = '42501';
  end if;
  if not app.is_valid_tz(p_timezone) then
    raise exception 'Unknown timezone' using errcode = '22023';
  end if;
  v_due := (p_local_date + p_local_time) at time zone p_timezone;      -- server-side conversion to a UTC instant
  if v_due < now() - interval '5 minutes' then
    raise exception 'Follow-up time is in the past' using errcode = '22023';
  end if;
  v_assignee := coalesce(p_assigned_to, auth.uid());
  if v_assignee <> auth.uid() and not app.has_perm('followups.view_all') then
    raise exception 'You can only assign follow-ups to yourself' using errcode = '42501';
  end if;

  insert into public.follow_ups(lead_id, client_id, title, follow_up_type, priority, due_at, timezone,
                                assigned_to, notes, reminder_offsets)
  values (p_lead_id, p_client_id, btrim(p_title), p_type, p_priority, v_due, p_timezone,
          v_assignee, p_notes, coalesce(p_reminder_offsets, '{0}'))
  returning * into f;
  perform app.log_follow_up(f, 'follow_up', 'Follow-up scheduled: ' || f.title);
  if v_assignee <> auth.uid() then
    perform app.notify(v_assignee, 'follow_up_assigned', 'Follow-up assigned to you', f.title,
      case when p_lead_id is not null then 'lead' else 'client' end,
      coalesce(p_lead_id, p_client_id),
      '/' || case when p_lead_id is not null then 'leads/' else 'clients/' end || coalesce(p_lead_id, p_client_id)::text);
  end if;
  return f.id;
end $$;

create function public.reschedule_follow_up(
  p_id uuid, p_local_date date, p_local_time time, p_timezone text,
  p_reminder_offsets int[] default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_due timestamptz; f public.follow_ups;
begin
  if not app.can_manage_follow_up(p_id) then
    raise exception 'Follow-up not found or not permitted' using errcode = '42501';
  end if;
  if not app.is_valid_tz(p_timezone) then raise exception 'Unknown timezone' using errcode = '22023'; end if;
  select * into f from public.follow_ups where id = p_id for update;
  if f.status <> 'pending' then
    raise exception 'Only pending follow-ups can be rescheduled' using errcode = '22023';
  end if;
  v_due := (p_local_date + p_local_time) at time zone p_timezone;
  if v_due < now() - interval '5 minutes' then
    raise exception 'Follow-up time is in the past' using errcode = '22023';
  end if;
  update public.follow_ups
     set due_at = v_due, timezone = p_timezone,
         reminder_offsets = coalesce(p_reminder_offsets, reminder_offsets)
   where id = p_id returning * into f;
  perform app.log_follow_up(f, 'follow_up', 'Follow-up rescheduled' ||
    coalesce(': ' || nullif(btrim(p_reason), ''), ''));
end $$;

create function public.complete_follow_up(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare f public.follow_ups;
begin
  if not app.can_manage_follow_up(p_id) then
    raise exception 'Follow-up not found or not permitted' using errcode = '42501';
  end if;
  update public.follow_ups set status = 'completed', completed_by = auth.uid()
   where id = p_id and status = 'pending' returning * into f;
  if not found then raise exception 'Follow-up is not pending' using errcode = '22023'; end if;
  perform app.log_follow_up(f, 'follow_up', 'Follow-up completed: ' || f.title ||
    coalesce(' — ' || nullif(btrim(p_note), ''), ''));
end $$;

create function public.cancel_follow_up(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare f public.follow_ups;
begin
  if not app.can_manage_follow_up(p_id) then
    raise exception 'Follow-up not found or not permitted' using errcode = '42501';
  end if;
  update public.follow_ups set status = 'cancelled' where id = p_id and status = 'pending' returning * into f;
  if not found then raise exception 'Follow-up is not pending' using errcode = '22023'; end if;
  perform app.log_follow_up(f, 'follow_up', 'Follow-up cancelled: ' || f.title ||
    coalesce(' — ' || nullif(btrim(p_reason), ''), ''));
end $$;

create function public.add_follow_up_note(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = public, app as $$
declare f public.follow_ups;
begin
  if not app.can_manage_follow_up(p_id) then
    raise exception 'Follow-up not found or not permitted' using errcode = '42501';
  end if;
  if p_text is null or char_length(btrim(p_text)) = 0 or char_length(p_text) > 5000 then
    raise exception 'Note must be 1–5000 characters' using errcode = '22023';
  end if;
  select * into f from public.follow_ups where id = p_id;
  perform app.log_follow_up(f, 'note', btrim(p_text));
end $$;

-- ───────────── read model ─────────────
create view public.follow_up_details with (security_invoker = true) as
select f.*,
  case when f.lead_id is not null then 'lead' else 'client' end as entity_type,
  coalesce(f.lead_id, f.client_id) as entity_id,
  coalesce(concat_ws(' · ', l.full_name, l.company), c.name) as entity_name,
  p.full_name as assigned_to_name,
  (f.status = 'pending' and f.due_at < now()) as is_overdue
from public.follow_ups f
left join public.leads l on l.id = f.lead_id
left join public.clients c on c.id = f.client_id
left join public.profiles p on p.id = f.assigned_to;

-- ───────────── the processor ─────────────
create function app.process_due_reminders(p_now timestamptz default now(), p_batch int default 500)
returns table(fired int, cancelled int, skipped int)
language plpgsql security definer set search_path = public, app as $$
declare
  r record; f public.follow_ups;
  v_tz text; v_active boolean; v_name text; v_when text; v_title text; v_type text; v_body text;
  v_nid uuid; v_dedupe text; v_link text; v_mins numeric; v_lag numeric := 0;
  c_fired int := 0; c_cancelled int := 0; c_skipped int := 0;
begin
  for r in
    select * from public.follow_up_reminders
     where status = 'pending' and fire_at <= p_now
     order by fire_at
     limit p_batch
     for update skip locked
  loop
    select * into f from public.follow_ups where id = r.follow_up_id;

    -- stale: follow-up gone, resolved, rescheduled, or edited since this occurrence was queued
    if not found or f.status <> 'pending' or f.schedule_version <> r.schedule_version or f.due_at <> r.due_at then
      update public.follow_up_reminders set status = 'cancelled', reason = coalesce(reason, 'stale') where id = r.id;
      c_cancelled := c_cancelled + 1;
      continue;
    end if;

    select timezone, is_active into v_tz, v_active from public.profiles where id = f.assigned_to;
    if not coalesce(v_active, false) then
      update public.follow_up_reminders set status = 'skipped', reason = 'recipient_inactive' where id = r.id;
      c_skipped := c_skipped + 1;
      continue;
    end if;

    v_name := case when f.lead_id is not null
      then (select concat_ws(' · ', full_name, company) from public.leads where id = f.lead_id)
      else (select name from public.clients where id = f.client_id) end;
    v_when := to_char(f.due_at at time zone v_tz, 'DD Mon YYYY, HH12:MI AM');
    v_mins := extract(epoch from (f.due_at - p_now)) / 60;

    if r.kind = 'overdue' then
      v_title := 'Follow-up overdue';  v_type := 'follow_up_overdue';
    elsif r.offset_minutes = 0 or v_mins <= 0 then
      v_title := 'Follow-up due now';  v_type := 'follow_up_due';
    else
      v_title := 'Follow-up due in ' || case r.offset_minutes
        when 5 then '5 minutes' when 15 then '15 minutes' when 30 then '30 minutes'
        when 60 then '1 hour' when 1440 then '1 day' else r.offset_minutes || ' minutes' end;
      v_type := 'follow_up_reminder';
    end if;

    v_body := f.title || ' — ' || coalesce(v_name, 'record') || '. Scheduled for ' || v_when || '.';
    v_link := '/' || case when f.lead_id is not null then 'leads/' else 'clients/' end
              || coalesce(f.lead_id, f.client_id)::text || '?followup=' || f.id::text;
    v_dedupe := 'fur:' || r.id::text;

    insert into public.notifications(user_id, type, title, body, entity_type, entity_id, follow_up_id, link, metadata, dedupe_key)
    values (f.assigned_to, v_type, v_title, v_body,
            case when f.lead_id is not null then 'lead' else 'client' end, coalesce(f.lead_id, f.client_id),
            f.id, v_link,
            jsonb_build_object('due_at', f.due_at, 'kind', r.kind, 'offset_minutes', r.offset_minutes),
            v_dedupe)
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_nid;
    if v_nid is null then
      select id into v_nid from public.notifications where dedupe_key = v_dedupe;
    end if;

    update public.follow_up_reminders
       set status = 'fired', fired_at = p_now, notification_id = v_nid where id = r.id;
    c_fired := c_fired + 1;
    v_lag := greatest(v_lag, extract(epoch from (p_now - r.fire_at)));
  end loop;

  insert into public.scheduler_runs(ran_at, fired, cancelled, skipped, max_lag_seconds)
  values (p_now, c_fired, c_cancelled, c_skipped, v_lag);
  delete from public.scheduler_runs where ran_at < p_now - interval '7 days';

  return query select c_fired, c_cancelled, c_skipped;
end $$;

-- ───────────── RLS ─────────────
alter table public.follow_ups enable row level security;
alter table public.follow_up_reminders enable row level security;
alter table public.scheduler_runs enable row level security;

create policy follow_ups_select on public.follow_ups for select to authenticated
  using (app.is_active_user() and (assigned_to = auth.uid() or created_by = auth.uid()
         or app.has_perm('followups.view_all')));
-- No insert/delete policy: follow-ups are created and resolved only through the RPCs above.
create policy follow_ups_update on public.follow_ups for update to authenticated
  using (app.can_manage_follow_up(id)) with check (app.can_manage_follow_up(id));
create policy reminders_select on public.follow_up_reminders for select to authenticated
  using (app.has_perm('audit.view')
         or follow_up_id in (select id from public.follow_ups where assigned_to = auth.uid()));
create policy scheduler_runs_select on public.scheduler_runs for select to authenticated
  using (app.has_perm('audit.view'));

-- Live UI updates (delivery itself never depends on a browser being open)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
    alter publication supabase_realtime add table public.follow_ups;
  end if;
end $$;

-- ===== 20260101000005_grants_and_schedule.sql =====
-- FAR Tech CRM · 0005 · deny-by-default grants, default preferences, reminder scheduler
-- RLS (0003/0004) decides WHICH rows; these grants decide WHICH operations and columns exist at all.

-- New profile → default preferences row
create function app.create_default_prefs() returns trigger language plpgsql security definer
set search_path = public, app as $$
begin
  insert into public.user_preferences(user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger trg_profiles_prefs after insert on public.profiles
  for each row execute function app.create_default_prefs();

-- ───────────── start from nothing ─────────────
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Only functions defined by these migrations: extension functions (citext operators, etc.) must stay callable.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon, authenticated;

-- ───────────── reads (rows still filtered by RLS) ─────────────
grant select on
  public.profiles, public.role_permissions, public.organization_settings, public.user_preferences,
  public.audit_events, public.pipeline_stages, public.clients, public.leads, public.deals,
  public.deal_stage_history, public.projects, public.project_members, public.tasks, public.activities,
  public.notifications, public.invoices, public.invoice_items, public.payments, public.invoice_balances,
  public.follow_ups, public.follow_up_reminders, public.follow_up_details, public.scheduler_runs
to authenticated;

-- ───────────── writes: explicit columns only ─────────────
grant update (full_name, phone, avatar_url, timezone) on public.profiles to authenticated;   -- NOT role / is_active / username
grant insert, update (theme, sidebar_collapsed, default_reminder_offsets) on public.user_preferences to authenticated;
grant update (company_name, default_timezone, default_currency, overdue_notice_minutes) on public.organization_settings to authenticated;
grant insert, update, delete on public.pipeline_stages to authenticated;

grant insert (full_name, company, job_title, email, phone, linkedin_url, website, country, industry,
              source, status, temperature, owner_id, notes),
      update (full_name, company, job_title, email, phone, linkedin_url, website, country, industry,
              source, status, temperature, owner_id, notes),
      delete on public.leads to authenticated;
grant insert (name, contact_name, email, phone, website, industry, address, country, notes, is_active, owner_id),
      update (name, contact_name, email, phone, website, industry, address, country, notes, is_active, owner_id),
      delete on public.clients to authenticated;
grant insert (title, lead_id, client_id, stage_id, value, currency, owner_id, expected_close_date, lost_reason, notes),
      update (title, lead_id, client_id, stage_id, value, currency, owner_id, expected_close_date, lost_reason, notes),
      delete on public.deals to authenticated;
grant insert (name, description, client_id, status, project_manager_id, team_lead_id, start_date, due_date),
      update (name, description, client_id, status, project_manager_id, team_lead_id, start_date, due_date),
      delete on public.projects to authenticated;
grant insert, delete on public.project_members to authenticated;
grant insert (project_id, title, description, status, priority, assigned_to, due_date),
      update (title, description, status, priority, assigned_to, due_date),
      delete on public.tasks to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (title, notes, priority, follow_up_type, assigned_to) on public.follow_ups to authenticated;

grant insert (client_id, project_id, status, currency, issue_date, due_date, tax_rate, notes),
      update (status, due_date, tax_rate, notes, project_id), delete on public.invoices to authenticated;
grant insert, update, delete on public.invoice_items to authenticated;
grant insert (invoice_id, amount, paid_at, method, reference, notes), delete on public.payments to authenticated;

-- ───────────── functions callable by signed-in users ─────────────
-- predicates referenced by RLS policies, column defaults and check constraints
grant execute on function
  app.is_active_user(), app.user_role(), app.has_perm(text), app.is_valid_tz(text),
  app.is_project_member(uuid, uuid), app.can_see_project(uuid), app.can_see_lead(uuid),
  app.can_see_client(uuid), app.can_see_deal(uuid), app.can_see_task(uuid),
  app.can_see_entity(text, uuid), app.can_manage_follow_up(uuid), app.next_invoice_number(),
  app.client_visible_via_project(uuid), app.is_project_lead_or_pm(uuid)
to authenticated;
-- the API surface
grant execute on function
  public.add_note(text, uuid, text), public.convert_lead_to_client(uuid), public.clear_must_change_password(),
  public.create_follow_up(uuid, uuid, text, public.follow_up_type, date, time, text, uuid, text, public.priority_level, int[]),
  public.reschedule_follow_up(uuid, date, time, text, int[], text),
  public.complete_follow_up(uuid, text), public.cancel_follow_up(uuid, text), public.add_follow_up_note(uuid, text)
to authenticated;

-- ───────────── server role (Edge Functions only; never shipped to a browser) ─────────────
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;

-- ───────────── scheduler: runs inside the database, independent of any browser ─────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'far-process-follow-up-reminders';
    perform cron.schedule('far-process-follow-up-reminders', '* * * * *', 'select app.process_due_reminders()');
  else
    raise notice 'pg_cron is not available in this database. Enable it (Dashboard → Database → Extensions) and run supabase/scripts/schedule_reminders.sql';
  end if;
exception when others then
  raise notice 'Could not schedule the reminder job automatically (%). Run supabase/scripts/schedule_reminders.sql after enabling pg_cron.', sqlerrm;
end $$;

-- ===== 20260101000006_quotes_currency_targets_messages.sql =====
-- FAR Tech CRM · 0006 · multi-currency, quotes → Finance approval → won deals, targets, messaging, deletes
-- Additive: safe to run once on a database that already has migrations 0001–0005 applied. Existing data is kept.

-- ───────────── permissions for the new capabilities ─────────────
insert into public.role_permissions(role, permission) values
 ('super_admin','rates.manage'),('cso','rates.manage'),
 ('super_admin','targets.manage'),('cso','targets.manage'),
 ('super_admin','quotes.view_all'),('cso','quotes.view_all'),
 ('super_admin','quotes.create'),('cso','quotes.create'),('sales_executive','quotes.create'),
 ('super_admin','quotes.review'),('finance','quotes.review'),
 ('super_admin','reports.sales'),('cso','reports.sales')
on conflict do nothing;

-- ───────────── currencies (all ISO 4217 codes) ─────────────
create table public.currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  is_active boolean not null default true
);
insert into public.currencies(code, name) values
('AED', 'United Arab Emirates Dirham'),
('AFN', 'Afghan Afghani'),
('ALL', 'Albanian Lek'),
('AMD', 'Armenian Dram'),
('ANG', 'Netherlands Antillean Guilder'),
('AOA', 'Angolan Kwanza'),
('ARS', 'Argentine Peso'),
('AUD', 'Australian Dollar'),
('AWG', 'Aruban Florin'),
('AZN', 'Azerbaijani Manat'),
('BAM', 'Bosnia-Herzegovina Convertible Mark'),
('BBD', 'Barbadian Dollar'),
('BDT', 'Bangladeshi Taka'),
('BGN', 'Bulgarian Lev'),
('BHD', 'Bahraini Dinar'),
('BIF', 'Burundian Franc'),
('BMD', 'Bermudan Dollar'),
('BND', 'Brunei Dollar'),
('BOB', 'Bolivian Boliviano'),
('BRL', 'Brazilian Real'),
('BSD', 'Bahamian Dollar'),
('BTN', 'Bhutanese Ngultrum'),
('BWP', 'Botswanan Pula'),
('BYN', 'Belarusian Ruble'),
('BZD', 'Belize Dollar'),
('CAD', 'Canadian Dollar'),
('CDF', 'Congolese Franc'),
('CHF', 'Swiss Franc'),
('CLP', 'Chilean Peso'),
('CNY', 'Chinese Yuan'),
('COP', 'Colombian Peso'),
('CRC', 'Costa Rican Colón'),
('CUC', 'Cuban Convertible Peso'),
('CUP', 'Cuban Peso'),
('CVE', 'Cape Verdean Escudo'),
('CZK', 'Czech Koruna'),
('DJF', 'Djiboutian Franc'),
('DKK', 'Danish Krone'),
('DOP', 'Dominican Peso'),
('DZD', 'Algerian Dinar'),
('EGP', 'Egyptian Pound'),
('ERN', 'Eritrean Nakfa'),
('ETB', 'Ethiopian Birr'),
('EUR', 'Euro'),
('FJD', 'Fijian Dollar'),
('FKP', 'Falkland Islands Pound'),
('GBP', 'British Pound'),
('GEL', 'Georgian Lari'),
('GHS', 'Ghanaian Cedi'),
('GIP', 'Gibraltar Pound'),
('GMD', 'Gambian Dalasi'),
('GNF', 'Guinean Franc'),
('GTQ', 'Guatemalan Quetzal'),
('GYD', 'Guyanaese Dollar'),
('HKD', 'Hong Kong Dollar'),
('HNL', 'Honduran Lempira'),
('HRK', 'Croatian Kuna'),
('HTG', 'Haitian Gourde'),
('HUF', 'Hungarian Forint'),
('IDR', 'Indonesian Rupiah'),
('ILS', 'Israeli New Shekel'),
('INR', 'Indian Rupee'),
('IQD', 'Iraqi Dinar'),
('IRR', 'Iranian Rial'),
('ISK', 'Icelandic Króna'),
('JMD', 'Jamaican Dollar'),
('JOD', 'Jordanian Dinar'),
('JPY', 'Japanese Yen'),
('KES', 'Kenyan Shilling'),
('KGS', 'Kyrgyz Som'),
('KHR', 'Cambodian Riel'),
('KMF', 'Comorian Franc'),
('KPW', 'North Korean Won'),
('KRW', 'South Korean Won'),
('KWD', 'Kuwaiti Dinar'),
('KYD', 'Cayman Islands Dollar'),
('KZT', 'Kazakhstani Tenge'),
('LAK', 'Laotian Kip'),
('LBP', 'Lebanese Pound'),
('LKR', 'Sri Lankan Rupee'),
('LRD', 'Liberian Dollar'),
('LSL', 'Lesotho Loti'),
('LYD', 'Libyan Dinar'),
('MAD', 'Moroccan Dirham'),
('MDL', 'Moldovan Leu'),
('MGA', 'Malagasy Ariary'),
('MKD', 'Macedonian Denar'),
('MMK', 'Myanmar Kyat'),
('MNT', 'Mongolian Tugrik'),
('MOP', 'Macanese Pataca'),
('MRU', 'Mauritanian Ouguiya'),
('MUR', 'Mauritian Rupee'),
('MVR', 'Maldivian Rufiyaa'),
('MWK', 'Malawian Kwacha'),
('MXN', 'Mexican Peso'),
('MYR', 'Malaysian Ringgit'),
('MZN', 'Mozambican Metical'),
('NAD', 'Namibian Dollar'),
('NGN', 'Nigerian Naira'),
('NIO', 'Nicaraguan Córdoba'),
('NOK', 'Norwegian Krone'),
('NPR', 'Nepalese Rupee'),
('NZD', 'New Zealand Dollar'),
('OMR', 'Omani Rial'),
('PAB', 'Panamanian Balboa'),
('PEN', 'Peruvian Sol'),
('PGK', 'Papua New Guinean Kina'),
('PHP', 'Philippine Peso'),
('PKR', 'Pakistani Rupee'),
('PLN', 'Polish Zloty'),
('PYG', 'Paraguayan Guarani'),
('QAR', 'Qatari Riyal'),
('RON', 'Romanian Leu'),
('RSD', 'Serbian Dinar'),
('RUB', 'Russian Ruble'),
('RWF', 'Rwandan Franc'),
('SAR', 'Saudi Riyal'),
('SBD', 'Solomon Islands Dollar'),
('SCR', 'Seychellois Rupee'),
('SDG', 'Sudanese Pound'),
('SEK', 'Swedish Krona'),
('SGD', 'Singapore Dollar'),
('SHP', 'St. Helena Pound'),
('SLE', 'Sierra Leonean Leone'),
('SLL', 'Sierra Leonean Leone (1964—2022)'),
('SOS', 'Somali Shilling'),
('SRD', 'Surinamese Dollar'),
('SSP', 'South Sudanese Pound'),
('STN', 'São Tomé & Príncipe Dobra'),
('SVC', 'Salvadoran Colón'),
('SYP', 'Syrian Pound'),
('SZL', 'Swazi Lilangeni'),
('THB', 'Thai Baht'),
('TJS', 'Tajikistani Somoni'),
('TMT', 'Turkmenistani Manat'),
('TND', 'Tunisian Dinar'),
('TOP', 'Tongan Paʻanga'),
('TRY', 'Turkish Lira'),
('TTD', 'Trinidad & Tobago Dollar'),
('TWD', 'New Taiwan Dollar'),
('TZS', 'Tanzanian Shilling'),
('UAH', 'Ukrainian Hryvnia'),
('UGX', 'Ugandan Shilling'),
('USD', 'US Dollar'),
('UYU', 'Uruguayan Peso'),
('UZS', 'Uzbekistani Som'),
('VES', 'Venezuelan Bolívar'),
('VND', 'Vietnamese Dong'),
('VUV', 'Vanuatu Vatu'),
('WST', 'Samoan Tala'),
('XAF', 'Central African CFA Franc'),
('XCD', 'East Caribbean Dollar'),
('XCG', 'Caribbean guilder'),
('XDR', 'Special Drawing Rights'),
('XOF', 'West African CFA Franc'),
('XPF', 'CFP Franc'),
('XSU', 'Sucre'),
('YER', 'Yemeni Rial'),
('ZAR', 'South African Rand'),
('ZMW', 'Zambian Kwacha'),
('ZWG', 'Zimbabwean Gold'),
('ZWL', 'Zimbabwean Dollar (2009–2024)')
on conflict do nothing;

alter table public.deals add constraint deals_currency_fk foreign key (currency) references public.currencies(code);
alter table public.invoices add constraint invoices_currency_fk foreign key (currency) references public.currencies(code);
alter table public.organization_settings add constraint org_currency_fk foreign key (default_currency) references public.currencies(code);

-- Month-end conversion rates, entered by Super Admin / CSO. One row per month per currency.
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  month date not null check (month = date_trunc('month', month)::date),
  currency char(3) not null references public.currencies(code),
  usd_per_unit numeric(18,8) not null check (usd_per_unit > 0),
  pkr_per_unit numeric(18,6) not null check (pkr_per_unit > 0),
  notes text check (char_length(notes) <= 500),
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (month, currency)
);
create trigger trg_rates_touch before update on public.exchange_rates for each row execute function app.touch_updated_at();
create function app.set_entered_by() returns trigger language plpgsql as $$
begin if auth.uid() is not null then new.entered_by := auth.uid(); end if; return new; end $$;
create trigger trg_rates_by before insert or update on public.exchange_rates for each row execute function app.set_entered_by();

-- ───────────── pipeline probability + won-by-Finance rule ─────────────
alter table public.pipeline_stages add column probability int not null default 0 check (probability between 0 and 100);
update public.pipeline_stages set probability = case name
  when 'Qualified' then 20 when 'Pain identified' then 30 when 'Call booked' then 40 when 'Discovery done' then 50
  when 'Proposal sent' then 60 when 'Negotiation' then 75 when 'Closed won' then 100 else 0 end;

alter table public.deals add column won_confirmed_at timestamptz;
alter table public.deals add column won_confirmed_by uuid references public.profiles(id);
-- Deals that were already in a won stage keep counting (closed_at is their win time)
update public.deals d set won_confirmed_at = coalesce(d.closed_at, d.updated_at)
  from public.pipeline_stages s where s.id = d.stage_id and s.is_won and d.won_confirmed_at is null;

create function app.guard_deal_stage() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_new_won boolean; v_old_won boolean := false;
begin
  select is_won into v_new_won from public.pipeline_stages where id = new.stage_id;
  if tg_op = 'UPDATE' then select is_won into v_old_won from public.pipeline_stages where id = old.stage_id; end if;
  if auth.uid() is not null and coalesce(current_setting('app.won_ok', true), '') <> '1' then
    if v_new_won and not coalesce(v_old_won, false) then
      raise exception 'A deal becomes Won only when Finance approves its quote' using errcode = '42501';
    end if;
    if coalesce(v_old_won, false) and not v_new_won then
      raise exception 'A won deal can only be reopened by removing its invoice' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_deals_guard before insert or update of stage_id on public.deals
  for each row execute function app.guard_deal_stage();

-- ───────────── quotes ─────────────
create type public.quote_status as enum ('draft','submitted','approved','rejected','cancelled');
create sequence public.quote_number_seq;
create function app.next_quote_number() returns text language sql security definer set search_path = public, app as $$
  select 'Q-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 5, '0') $$;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique default app.next_quote_number(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  status public.quote_status not null default 'draft',
  currency char(3) not null references public.currencies(code),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 200),
  customer_company text check (char_length(customer_company) <= 200),
  customer_email text check (char_length(customer_email) <= 200),
  customer_country text check (char_length(customer_country) <= 80),
  project_title text not null check (char_length(btrim(project_title)) between 1 and 200),
  project_description text check (char_length(project_description) <= 10000),
  delivery_date date,
  payment_terms text check (char_length(payment_terms) <= 2000),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  notes text check (char_length(notes) <= 5000),
  upfront_type text check (upfront_type in ('none','percent','fixed')),
  upfront_value numeric(14,2) check (upfront_value >= 0),
  finance_notes text check (char_length(finance_notes) <= 2000),
  rejection_reason text check (char_length(rejection_reason) <= 2000),
  submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid references public.profiles(id),
  invoice_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_deal_idx on public.quotes(deal_id);
create index quotes_status_idx on public.quotes(status);
create trigger trg_quotes_touch before update on public.quotes for each row execute function app.touch_updated_at();
create trigger trg_quotes_created_by before insert on public.quotes for each row execute function app.set_created_by();

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position int not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0)
);
create index quote_items_quote_idx on public.quote_items(quote_id);

create view public.quote_totals with (security_invoker = true) as
select q.id as quote_id,
  coalesce(sum(i.quantity * i.unit_price), 0) as subtotal,
  round(coalesce(sum(i.quantity * i.unit_price), 0) * q.tax_rate / 100, 2) as tax_amount,
  round(coalesce(sum(i.quantity * i.unit_price), 0) * (1 + q.tax_rate / 100), 2) as total
from public.quotes q left join public.quote_items i on i.quote_id = q.id group by q.id, q.tax_rate;

create function app.guard_quote_items() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_status public.quote_status;
begin
  select status into v_status from public.quotes where id = coalesce(new.quote_id, old.quote_id);
  if v_status is not null and v_status not in ('draft','rejected') then
    raise exception 'A quote can only be edited while it is a draft or has been returned by Finance' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_quote_items_guard before insert or update or delete on public.quote_items
  for each row execute function app.guard_quote_items();

-- invoices now remember where they came from, and any upfront Finance required
alter table public.invoices add column quote_id uuid references public.quotes(id) on delete set null;
alter table public.invoices add column deal_id uuid references public.deals(id) on delete set null;
alter table public.invoices add column upfront_amount numeric(14,2) not null default 0 check (upfront_amount >= 0);
alter table public.quotes add constraint quotes_invoice_fk foreign key (invoice_id) references public.invoices(id) on delete set null;
create index invoices_deal_idx on public.invoices(deal_id);

drop view public.invoice_balances;
create view public.invoice_balances with (security_invoker = true) as
select
  i.id as invoice_id, i.invoice_number, i.client_id, i.project_id, i.deal_id, i.quote_id, i.status, i.currency,
  i.issue_date, i.due_date,
  coalesce(s.subtotal, 0) as subtotal,
  round(coalesce(s.subtotal, 0) * i.tax_rate / 100, 2) as tax_amount,
  round(coalesce(s.subtotal, 0) * (1 + i.tax_rate / 100), 2) as total,
  coalesce(p.paid, 0) as amount_paid,
  round(coalesce(s.subtotal, 0) * (1 + i.tax_rate / 100), 2) - coalesce(p.paid, 0) as balance_due,
  case
    when i.status in ('draft','void') then i.status::text
    when coalesce(p.paid,0) >= round(coalesce(s.subtotal,0) * (1 + i.tax_rate/100), 2) and coalesce(s.subtotal,0) > 0 then 'paid'
    when coalesce(p.paid,0) > 0 then 'partially_paid'
    else 'unpaid' end as payment_state,
  (i.status = 'sent'
    and round(coalesce(s.subtotal,0) * (1 + i.tax_rate/100), 2) - coalesce(p.paid,0) > 0
    and i.due_date < (now() at time zone (select default_timezone from public.organization_settings))::date
  ) as is_overdue,
  i.upfront_amount,
  (i.upfront_amount > 0 and coalesce(p.paid,0) >= i.upfront_amount) as upfront_received,
  p.last_paid_at
from public.invoices i
left join (select invoice_id, sum(quantity * unit_price) as subtotal from public.invoice_items group by invoice_id) s on s.invoice_id = i.id
left join (select invoice_id, sum(amount) as paid, max(paid_at) as last_paid_at from public.payments group by invoice_id) p on p.invoice_id = i.id;

-- ───────────── sales targets (carry forward until a new one is set) ─────────────
create table public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  target_usd numeric(16,2) check (target_usd >= 0),
  target_pkr numeric(16,2) check (target_pkr >= 0),
  notes text check (char_length(notes) <= 500),
  set_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month),
  check (target_usd is not null or target_pkr is not null)
);
create trigger trg_targets_touch before update on public.sales_targets for each row execute function app.touch_updated_at();
create function app.validate_target() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if auth.uid() is not null then new.set_by := auth.uid(); end if;
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'sales_executive' and is_active) then
    raise exception 'Targets can only be assigned to active Sales Executives' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_targets_validate before insert or update on public.sales_targets for each row execute function app.validate_target();

-- ───────────── messaging ─────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index messages_pair_idx on public.messages(sender_id, recipient_id, created_at desc);
create index messages_unread_idx on public.messages(recipient_id) where read_at is null;

-- Who may START a conversation. Anyone may REPLY to a person who has messaged them.
create function app.can_message(p_sender uuid, p_recipient uuid) returns boolean
language plpgsql stable security definer set search_path = public, app as $$
declare s public.app_role; r public.app_role;
begin
  if p_sender = p_recipient then return false; end if;
  select role into s from public.profiles where id = p_sender and is_active;
  select role into r from public.profiles where id = p_recipient and is_active;
  if s is null or r is null then return false; end if;
  if exists (select 1 from public.messages where sender_id = p_recipient and recipient_id = p_sender) then return true; end if;
  return case s
    when 'super_admin' then true
    when 'cso' then r in ('sales_executive','finance','project_manager')
    when 'sales_executive' then r in ('cso','project_manager')
    when 'project_manager' then r in ('super_admin','cso','developer','team_lead')
    when 'finance' then r in ('super_admin','cso')
    when 'team_lead' then r in ('project_manager','developer')
    else false end;
end $$;

create function public.send_message(p_recipient uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_name text;
begin
  if not app.can_message(auth.uid(), p_recipient) then
    raise exception 'You are not allowed to message this person' using errcode = '42501';
  end if;
  insert into public.messages(sender_id, recipient_id, body) values (auth.uid(), p_recipient, btrim(p_body)) returning id into v_id;
  if not exists (select 1 from public.notifications where user_id = p_recipient and type = 'message'
                 and read_at is null and metadata->>'from' = auth.uid()::text) then
    select full_name into v_name from public.profiles where id = auth.uid();
    insert into public.notifications(user_id, type, title, body, link, metadata)
    values (p_recipient, 'message', 'New message from ' || v_name, left(btrim(p_body), 140),
            '/messages?with=' || auth.uid()::text, jsonb_build_object('from', auth.uid()));
  end if;
  return v_id;
end $$;

create function public.chat_contacts() returns table(id uuid, full_name text, role public.app_role, can_start boolean,
  last_body text, last_at timestamptz, last_from_me boolean, unread bigint)
language sql stable set search_path = public, app as $$
  select p.id, p.full_name, p.role, app.can_message(auth.uid(), p.id),
    lm.body, lm.created_at, (lm.sender_id = auth.uid()),
    (select count(*) from public.messages m where m.sender_id = p.id and m.recipient_id = auth.uid() and m.read_at is null)
  from public.profiles p
  left join lateral (select m.body, m.created_at, m.sender_id from public.messages m
      where (m.sender_id = p.id and m.recipient_id = auth.uid()) or (m.sender_id = auth.uid() and m.recipient_id = p.id)
      order by m.created_at desc limit 1) lm on true
  where p.is_active and p.id <> auth.uid() and (app.can_message(auth.uid(), p.id) or lm.created_at is not null)
  order by lm.created_at desc nulls last, p.full_name
$$;

-- ───────────── visibility helpers ─────────────
create function app.can_see_quote(p_id uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (select 1 from public.quotes q where q.id = p_id and (
    app.has_perm('quotes.view_all') or q.created_by = auth.uid() or app.can_see_deal(q.deal_id)
    or (app.has_perm('finance.view') and q.status <> 'draft'))) $$;
create function app.can_edit_quote(p_id uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (select 1 from public.quotes q where q.id = p_id
    and q.status in ('draft','rejected') and (q.created_by = auth.uid() or app.has_perm('quotes.view_all'))) $$;
create function app.can_see_invoice(p_id uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.is_active_user() and exists (select 1 from public.invoices i where i.id = p_id and (
    app.has_perm('finance.view') or (i.deal_id is not null and app.can_see_deal(i.deal_id)))) $$;

-- ───────────── RLS ─────────────
alter table public.currencies enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.sales_targets enable row level security;
alter table public.messages enable row level security;

create policy currencies_select on public.currencies for select to authenticated using (app.is_active_user());
create policy rates_select on public.exchange_rates for select to authenticated using (app.is_active_user());
create policy rates_write on public.exchange_rates for all to authenticated
  using (app.has_perm('rates.manage')) with check (app.has_perm('rates.manage'));

create policy quotes_select on public.quotes for select to authenticated
  using (app.is_active_user() and (app.has_perm('quotes.view_all') or created_by = auth.uid() or app.can_see_deal(deal_id)
         or (app.has_perm('finance.view') and status <> 'draft')));
create policy quotes_insert on public.quotes for insert to authenticated
  with check (app.has_perm('quotes.create') and status = 'draft' and app.can_see_deal(deal_id));
create policy quotes_update on public.quotes for update to authenticated
  using (status in ('draft','rejected') and (created_by = auth.uid() or app.has_perm('quotes.view_all')))
  with check (status in ('draft','rejected'));
create policy quotes_delete on public.quotes for delete to authenticated
  using (status in ('draft','rejected','cancelled') and (created_by = auth.uid() or app.has_perm('quotes.view_all')));
create policy quote_items_select on public.quote_items for select to authenticated using (app.can_see_quote(quote_id));
create policy quote_items_write on public.quote_items for all to authenticated
  using (app.can_edit_quote(quote_id)) with check (app.can_edit_quote(quote_id));

create policy targets_select on public.sales_targets for select to authenticated
  using (app.has_perm('targets.manage') or (user_id = auth.uid() and app.is_active_user()));
create policy targets_write on public.sales_targets for all to authenticated
  using (app.has_perm('targets.manage')) with check (app.has_perm('targets.manage'));

create policy messages_select on public.messages for select to authenticated
  using (app.is_active_user() and (sender_id = auth.uid() or recipient_id = auth.uid()));
create policy messages_mark_read on public.messages for update to authenticated
  using (recipient_id = auth.uid() and app.is_active_user()) with check (recipient_id = auth.uid());
create policy messages_delete on public.messages for delete to authenticated using (sender_id = auth.uid());

-- invoices/items/payments become visible to the sales owner of the deal (so they can hand them to the client)
drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using (app.has_perm('finance.view') or (deal_id is not null and app.can_see_deal(deal_id)));
drop policy items_select on public.invoice_items;
create policy items_select on public.invoice_items for select to authenticated using (app.can_see_invoice(invoice_id));
drop policy payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (app.can_see_invoice(invoice_id));

-- ───────────── quote workflow RPCs ─────────────
create function app.notify_role(p_role public.app_role, p_type text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public, app as $$
declare r record;
begin
  for r in select id from public.profiles where role = p_role and is_active loop
    perform app.notify(r.id, p_type, p_title, p_body, 'deal', null, p_link);
  end loop;
end $$;

create function public.submit_quote(p_id uuid) returns void language plpgsql security definer
set search_path = public, app as $$
declare q public.quotes; v_total numeric; v_stage uuid; v_pos int; v_cur_pos int; v_cur_won boolean;
begin
  select * into q from public.quotes where id = p_id for update;
  if not found or not (q.created_by = auth.uid() or app.has_perm('quotes.view_all')) or not app.is_active_user() then
    raise exception 'Quote not found or not permitted' using errcode = '42501';
  end if;
  if q.status not in ('draft','rejected') then raise exception 'Only draft or returned quotes can be submitted' using errcode = '22023'; end if;
  select total into v_total from public.quote_totals where quote_id = p_id;
  if coalesce(v_total, 0) <= 0 then raise exception 'Add at least one priced line item before submitting' using errcode = '22023'; end if;
  if coalesce(btrim(q.project_description), '') = '' then raise exception 'Describe the project before submitting' using errcode = '22023'; end if;

  update public.quotes set status = 'submitted', submitted_at = now(), rejection_reason = null where id = p_id;
  select s.position, s.is_won or s.is_lost into v_cur_pos, v_cur_won
    from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = q.deal_id;
  select id, position into v_stage, v_pos from public.pipeline_stages where name = 'Proposal sent';
  update public.deals set value = v_total, currency = q.currency,
         stage_id = case when not v_cur_won and v_cur_pos < v_pos then v_stage else stage_id end
   where id = q.deal_id;
  insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
  values ('deal', q.deal_id, auth.uid(), 'quote', 'Quote ' || q.quote_number || ' submitted to Finance', jsonb_build_object('quote_id', p_id));
  perform app.notify_role('finance', 'quote_submitted', 'Quote awaiting approval',
    q.quote_number || ' · ' || q.project_title || ' · ' || q.currency || ' ' || to_char(v_total, 'FM999,999,999,990.00'),
    '/finance?tab=quotes&quote=' || p_id::text);
end $$;

create function public.reject_quote(p_id uuid, p_reason text) returns void language plpgsql security definer
set search_path = public, app as $$
declare q public.quotes;
begin
  if not app.has_perm('quotes.review') then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'Give the sales owner a reason' using errcode = '22023'; end if;
  select * into q from public.quotes where id = p_id for update;
  if not found or q.status <> 'submitted' then raise exception 'Only submitted quotes can be returned' using errcode = '22023'; end if;
  update public.quotes set status = 'rejected', rejection_reason = btrim(p_reason), reviewed_at = now(), reviewed_by = auth.uid() where id = p_id;
  insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
  values ('deal', q.deal_id, auth.uid(), 'quote', 'Quote ' || q.quote_number || ' returned by Finance: ' || btrim(p_reason), jsonb_build_object('quote_id', p_id));
  perform app.notify(q.created_by, 'quote_rejected', 'Quote returned by Finance', q.quote_number || ': ' || btrim(p_reason),
    'deal', q.deal_id, '/deals?deal=' || q.deal_id::text);
end $$;

create function public.approve_quote(p_id uuid, p_upfront_type text default 'none', p_upfront_value numeric default 0,
  p_due_date date default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  q public.quotes; d public.deals; l public.leads; v_total numeric; v_upfront numeric := 0; v_client uuid; v_inv uuid;
  v_won uuid; v_due date := coalesce(p_due_date, current_date + 14);
begin
  if not app.has_perm('quotes.review') then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into q from public.quotes where id = p_id for update;
  if not found or q.status <> 'submitted' then raise exception 'Only submitted quotes can be approved' using errcode = '22023'; end if;
  select * into d from public.deals where id = q.deal_id for update;
  select total into v_total from public.quote_totals where quote_id = p_id;
  if p_upfront_type not in ('none','percent','fixed') then raise exception 'Unknown upfront type' using errcode = '22023'; end if;
  if p_upfront_type = 'percent' then
    if p_upfront_value is null or p_upfront_value <= 0 or p_upfront_value > 100 then raise exception 'Upfront percent must be between 1 and 100' using errcode = '22023'; end if;
    v_upfront := round(v_total * p_upfront_value / 100, 2);
  elsif p_upfront_type = 'fixed' then
    if p_upfront_value is null or p_upfront_value <= 0 or p_upfront_value > v_total then raise exception 'Upfront amount must be more than 0 and not above the total' using errcode = '22023'; end if;
    v_upfront := p_upfront_value;
  end if;
  if v_due < current_date then raise exception 'Due date is in the past' using errcode = '22023'; end if;

  -- the customer must be a client before an invoice can exist
  v_client := d.client_id;
  if v_client is null then
    select * into l from public.leads where id = d.lead_id for update;
    insert into public.clients(name, contact_name, email, phone, website, industry, country, owner_id, created_by)
    values (coalesce(nullif(btrim(l.company), ''), l.full_name), l.full_name, l.email, l.phone, l.website, l.industry, l.country, d.owner_id, auth.uid())
    returning id into v_client;
    update public.leads set status = 'converted', converted_client_id = v_client where id = l.id;
    update public.deals set client_id = v_client where id = d.id;
    update public.deals set client_id = v_client where lead_id = l.id and client_id is null;
  end if;

  insert into public.invoices(client_id, status, currency, issue_date, due_date, tax_rate, notes, quote_id, deal_id, upfront_amount)
  values (v_client, 'draft', q.currency, current_date, v_due, q.tax_rate,
          concat_ws(E'\n', 'Project: ' || q.project_title, nullif(btrim(p_notes), '')), q.id, q.deal_id, v_upfront)
  returning id into v_inv;
  insert into public.invoice_items(invoice_id, position, description, quantity, unit_price)
    select v_inv, position, description, quantity, unit_price from public.quote_items where quote_id = p_id;
  update public.invoices set status = 'sent' where id = v_inv;

  update public.quotes set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), invoice_id = v_inv,
         upfront_type = p_upfront_type, upfront_value = case when p_upfront_type = 'none' then null else p_upfront_value end,
         finance_notes = nullif(btrim(p_notes), '') where id = p_id;

  select id into v_won from public.pipeline_stages where is_won limit 1;
  perform set_config('app.won_ok', '1', true);
  update public.deals set stage_id = v_won, value = v_total, currency = q.currency, won_confirmed_at = now(), won_confirmed_by = auth.uid() where id = d.id;
  perform set_config('app.won_ok', '', true);

  insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
  values ('deal', d.id, auth.uid(), 'won', 'Finance approved quote ' || q.quote_number || '. Deal won. Invoice issued.',
          jsonb_build_object('quote_id', q.id, 'invoice_id', v_inv, 'upfront', v_upfront));
  perform app.audit('quote.approved', 'quote', q.id::text, jsonb_build_object('invoice_id', v_inv, 'total', v_total, 'upfront', v_upfront));
  perform app.notify(q.created_by, 'quote_approved', 'Deal won: quote approved',
    q.quote_number || ' approved' || case when v_upfront > 0 then ' · upfront ' || q.currency || ' ' || to_char(v_upfront, 'FM999,999,999,990.00') else ' · no upfront required' end,
    'deal', d.id, '/deals?deal=' || d.id::text);
  perform app.notify_role('project_manager', 'deal_won', 'New won deal to set up', q.project_title, '/deals?deal=' || d.id::text);
  return v_inv;
end $$;

-- ───────────── deletes (explicit, audited, with clear blocking messages) ─────────────
create function public.delete_lead(p_id uuid) returns void language plpgsql security definer
set search_path = public, app as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_id;
  if not found or not app.is_active_user() or not (app.has_perm('leads.view_all') or (l.owner_id = auth.uid() and app.has_perm('leads.create'))) then
    raise exception 'Lead not found or not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.deals d where d.lead_id = p_id and d.client_id is null and d.won_confirmed_at is not null) then
    raise exception 'This lead has a won deal. Remove its invoice first' using errcode = '22023';
  end if;
  delete from public.deals where lead_id = p_id and client_id is null;
  update public.deals set lead_id = null where lead_id = p_id;
  delete from public.activities where entity_type = 'lead' and entity_id = p_id;
  delete from public.leads where id = p_id;
  perform app.audit('lead.deleted', 'lead', p_id::text, jsonb_build_object('name', l.full_name));
end $$;

create function public.delete_client(p_id uuid) returns void language plpgsql security definer
set search_path = public, app as $$
declare c public.clients;
begin
  select * into c from public.clients where id = p_id;
  if not found or not app.is_active_user() or not (app.has_perm('clients.manage_all') or (c.owner_id = auth.uid() and app.has_perm('clients.write'))) then
    raise exception 'Client not found or not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.invoices where client_id = p_id) then
    raise exception 'This client has invoices. Ask Finance to delete them first' using errcode = '22023';
  end if;
  if exists (select 1 from public.projects where client_id = p_id) then
    raise exception 'This client has projects. Delete or reassign the projects first' using errcode = '22023';
  end if;
  delete from public.deals where client_id = p_id;
  update public.leads set converted_client_id = null where converted_client_id = p_id;
  delete from public.activities where entity_type = 'client' and entity_id = p_id;
  delete from public.clients where id = p_id;
  perform app.audit('client.deleted', 'client', p_id::text, jsonb_build_object('name', c.name));
end $$;

create function public.delete_deal(p_id uuid) returns void language plpgsql security definer
set search_path = public, app as $$
declare d public.deals;
begin
  select * into d from public.deals where id = p_id;
  if not found or not app.is_active_user() or not (app.has_perm('deals.view_all') or (d.owner_id = auth.uid() and app.has_perm('deals.write'))) then
    raise exception 'Deal not found or not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.invoices where deal_id = p_id) then
    raise exception 'This deal has an invoice. Ask Finance to delete the invoice first' using errcode = '22023';
  end if;
  delete from public.activities where entity_type = 'deal' and entity_id = p_id;
  delete from public.deals where id = p_id;
  perform app.audit('deal.deleted', 'deal', p_id::text, jsonb_build_object('title', d.title));
end $$;

create function public.delete_invoice(p_id uuid, p_with_payments boolean default false) returns void
language plpgsql security definer set search_path = public, app as $$
declare i public.invoices; n int; v_stage uuid;
begin
  if not app.has_perm('finance.manage') then raise exception 'Not permitted' using errcode = '42501'; end if;
  select * into i from public.invoices where id = p_id;
  if not found then raise exception 'Invoice not found' using errcode = '42501'; end if;
  select count(*) into n from public.payments where invoice_id = p_id;
  if n > 0 and not p_with_payments then
    raise exception 'This invoice has % recorded payment(s). Confirm that they should be deleted too', n using errcode = '22023';
  end if;
  delete from public.payments where invoice_id = p_id;
  delete from public.invoices where id = p_id;
  if i.quote_id is not null then update public.quotes set status = 'cancelled' where id = i.quote_id; end if;
  if i.deal_id is not null and exists (select 1 from public.deals where id = i.deal_id and won_confirmed_at is not null) then
    select id into v_stage from public.pipeline_stages where name = 'Negotiation';
    perform set_config('app.won_ok', '1', true);
    update public.deals set stage_id = v_stage, won_confirmed_at = null, won_confirmed_by = null where id = i.deal_id;
    perform set_config('app.won_ok', '', true);
    insert into public.activities(entity_type, entity_id, actor_id, kind, summary)
    values ('deal', i.deal_id, auth.uid(), 'reopened', 'Invoice ' || i.invoice_number || ' was deleted. Deal reopened in Negotiation.');
    perform app.notify((select owner_id from public.deals where id = i.deal_id), 'invoice_deleted', 'Invoice deleted, deal reopened',
      i.invoice_number, 'deal', i.deal_id, '/deals?deal=' || i.deal_id::text);
  end if;
  perform app.audit('invoice.deleted', 'invoice', p_id::text, jsonb_build_object('number', i.invoice_number, 'payments_deleted', n));
end $$;

create function public.delete_follow_up(p_id uuid) returns void language plpgsql security definer
set search_path = public, app as $$
begin
  if not app.can_manage_follow_up(p_id) then raise exception 'Follow-up not found or not permitted' using errcode = '42501'; end if;
  delete from public.follow_ups where id = p_id;
end $$;

-- convert_lead_to_client now carries the lead's deals over to the new client
create or replace function public.convert_lead_to_client(p_lead_id uuid)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_lead public.leads; v_client uuid;
begin
  if not (app.can_see_lead(p_lead_id) and app.has_perm('clients.write')) then
    raise exception 'Not permitted to convert this lead' using errcode = '42501';
  end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.converted_client_id is not null then raise exception 'Lead is already converted' using errcode = '22023'; end if;
  insert into public.clients(name, contact_name, email, phone, website, industry, country, owner_id, created_by)
  values (coalesce(nullif(btrim(v_lead.company), ''), v_lead.full_name), v_lead.full_name, v_lead.email,
          v_lead.phone, v_lead.website, v_lead.industry, v_lead.country, v_lead.owner_id, auth.uid())
  returning id into v_client;
  update public.leads set status = 'converted', converted_client_id = v_client where id = p_lead_id;
  update public.deals set client_id = v_client where lead_id = p_lead_id and client_id is null;
  insert into public.activities(entity_type, entity_id, actor_id, kind, summary, metadata)
  values ('client', v_client, auth.uid(), 'created', 'Client created from lead ' || v_lead.full_name, jsonb_build_object('lead_id', p_lead_id));
  return v_client;
end $$;

-- ───────────── grants ─────────────
revoke delete on public.leads, public.clients, public.deals from authenticated;
grant select on public.currencies, public.exchange_rates, public.quotes, public.quote_items, public.quote_totals,
  public.sales_targets, public.messages, public.invoice_balances to authenticated;
grant insert, update, delete on public.exchange_rates to authenticated;
grant insert, update, delete on public.sales_targets to authenticated;
grant insert (deal_id, currency, customer_name, customer_company, customer_email, customer_country, project_title,
              project_description, delivery_date, payment_terms, tax_rate, notes),
      update (currency, customer_name, customer_company, customer_email, customer_country, project_title,
              project_description, delivery_date, payment_terms, tax_rate, notes),
      delete on public.quotes to authenticated;
grant insert, update, delete on public.quote_items to authenticated;
grant update (read_at) on public.messages to authenticated;
grant delete on public.messages to authenticated;
grant all on public.currencies, public.exchange_rates, public.quotes, public.quote_items, public.sales_targets, public.messages to service_role;
grant select on public.quote_totals, public.invoice_balances to service_role;

grant execute on function app.can_message(uuid, uuid), app.can_see_quote(uuid), app.can_edit_quote(uuid),
  app.can_see_invoice(uuid), app.next_quote_number() to authenticated;
grant execute on function public.send_message(uuid, text), public.chat_contacts(),
  public.submit_quote(uuid), public.reject_quote(uuid, text), public.approve_quote(uuid, text, numeric, date, text),
  public.delete_lead(uuid), public.delete_client(uuid), public.delete_deal(uuid), public.delete_invoice(uuid, boolean),
  public.delete_follow_up(uuid), public.convert_lead_to_client(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ===== 20260101000007_targets_by_role.sql =====
-- FAR Tech CRM · 0007 · target assignment rules
--   Super Admin  → can set targets for Sales Executives AND for the CSO
--   CSO          → can set targets for Sales Executives ONLY (never for themselves or another CSO)
-- Run once, after 0006.

insert into public.role_permissions(role, permission) values ('super_admin','targets.assign_cso') on conflict do nothing;

create function app.role_of(p_user uuid) returns public.app_role
language sql stable security definer set search_path = public, app as $$
  select role from public.profiles where id = p_user
$$;
grant execute on function app.role_of(uuid) to authenticated;

create or replace function app.validate_target() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_role public.app_role;
begin
  if auth.uid() is not null then new.set_by := auth.uid(); end if;
  select role into v_role from public.profiles where id = new.user_id and is_active;
  if v_role is null or v_role not in ('sales_executive','cso') then
    raise exception 'Targets can only be assigned to active Sales Executives or the CSO' using errcode = '22023';
  end if;
  if v_role = 'cso' and auth.uid() is not null and not app.has_perm('targets.assign_cso') then
    raise exception 'Only the Super Admin can set the CSO''s target' using errcode = '42501';
  end if;
  return new;
end $$;

drop policy targets_select on public.sales_targets;
drop policy targets_write on public.sales_targets;
-- read: your own target; Super Admin everything; CSO the Sales Executives' targets
create policy targets_select on public.sales_targets for select to authenticated
  using (app.is_active_user() and (
    user_id = auth.uid()
    or app.has_perm('targets.assign_cso')
    or (app.has_perm('targets.manage') and app.role_of(user_id) = 'sales_executive')));
-- write: Super Admin for Sales Executives + CSO; CSO for Sales Executives only
create policy targets_write on public.sales_targets for all to authenticated
  using (app.has_perm('targets.assign_cso') or (app.has_perm('targets.manage') and app.role_of(user_id) = 'sales_executive'))
  with check (app.has_perm('targets.assign_cso') or (app.has_perm('targets.manage') and app.role_of(user_id) = 'sales_executive'));

-- ===== 20260101000008_meetings.sql =====
-- FAR Tech CRM · 0008 · video meetings (1-to-1 and group; scheduled or instant). Run once, after 0007.
-- Rules: anyone may invite anyone. A SCHEDULED meeting must be accepted by invitees and started by the host.
-- An INSTANT call starts immediately and rings the invitees (a notification); joining counts as accepting.
-- Only the host and invitees can see a meeting; only the host and people who accepted/joined can get a room token.

create type public.meeting_status as enum ('scheduled','live','ended','cancelled');

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  host_id uuid not null references public.profiles(id) on delete cascade,
  status public.meeting_status not null default 'scheduled',
  scheduled_at timestamptz,
  timezone text check (timezone is null or app.is_valid_tz(timezone)),
  room_name text not null unique default ('crm-' || replace(gen_random_uuid()::text, '-', '')),
  notes text check (char_length(notes) <= 2000),
  started_at timestamptz, ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_at is not null or started_at is not null)
);
create index meetings_host_idx on public.meetings(host_id, created_at desc);
create index meetings_sched_idx on public.meetings(scheduled_at) where status = 'scheduled';
create trigger trg_meetings_touch before update on public.meetings for each row execute function app.touch_updated_at();

create table public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null default 'pending' check (response in ('pending','accepted','declined')),
  responded_at timestamptz, joined_at timestamptz,
  primary key (meeting_id, user_id)
);
create index meeting_participants_user_idx on public.meeting_participants(user_id);

create function app.is_meeting_member(p_meeting uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.meetings m where m.id = p_meeting and (m.host_id = p_user
    or exists (select 1 from public.meeting_participants p where p.meeting_id = m.id and p.user_id = p_user)))
$$;

alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
create policy meetings_select on public.meetings for select to authenticated
  using (app.is_active_user() and app.is_meeting_member(id, auth.uid()));
create policy meeting_participants_select on public.meeting_participants for select to authenticated
  using (app.is_active_user() and app.is_meeting_member(meeting_id, auth.uid()));
-- no insert/update/delete policies: everything goes through the RPCs below

create function app.fmt_when(p_at timestamptz, p_user uuid) returns text language sql stable security definer set search_path = public, app as $$
  select to_char(p_at at time zone coalesce((select timezone from public.profiles where id = p_user), 'UTC'), 'DD Mon YYYY, HH12:MI AM')
$$;

create function public.create_meeting(p_title text, p_invitees uuid[], p_instant boolean default false,
  p_local_date date default null, p_local_time time default null, p_timezone text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_at timestamptz; v_ids uuid[]; r uuid; v_name text;
begin
  if not app.is_active_user() then raise exception 'Not permitted' using errcode = '42501'; end if;
  select array_agg(distinct p.id) into v_ids from public.profiles p where p.id = any(coalesce(p_invitees, '{}')) and p.is_active and p.id <> auth.uid();
  if v_ids is null or cardinality(v_ids) = 0 then raise exception 'Choose at least one person to invite' using errcode = '22023'; end if;
  if cardinality(v_ids) > 100 then raise exception 'A meeting can have at most 100 invitees' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'Give the meeting a title' using errcode = '22023'; end if;
  if not p_instant then
    if p_local_date is null or p_local_time is null or not app.is_valid_tz(p_timezone) then raise exception 'Choose a date, time and timezone' using errcode = '22023'; end if;
    v_at := (p_local_date + p_local_time) at time zone p_timezone;
    if v_at < now() - interval '5 minutes' then raise exception 'The meeting time is in the past' using errcode = '22023'; end if;
  end if;
  insert into public.meetings(title, host_id, status, scheduled_at, timezone, notes, started_at)
  values (btrim(p_title), auth.uid(), case when p_instant then 'live'::public.meeting_status else 'scheduled'::public.meeting_status end, v_at, p_timezone, nullif(btrim(p_notes), ''), case when p_instant then now() end)
  returning id into v_id;
  insert into public.meeting_participants(meeting_id, user_id) select v_id, unnest(v_ids);
  select full_name into v_name from public.profiles where id = auth.uid();
  foreach r in array v_ids loop
    if p_instant then
      perform app.notify(r, 'meeting_call', v_name || ' is calling you', btrim(p_title), null, null, '/meetings?meeting=' || v_id::text);
    else
      perform app.notify(r, 'meeting_invite', 'Meeting request from ' || v_name, btrim(p_title) || ' · ' || app.fmt_when(v_at, r), null, null, '/meetings?meeting=' || v_id::text);
    end if;
  end loop;
  return v_id;
end $$;

create function public.respond_meeting(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare m public.meetings; v_name text;
begin
  select * into m from public.meetings where id = p_id;
  if not found or m.status not in ('scheduled','live') then raise exception 'This meeting is no longer open' using errcode = '22023'; end if;
  update public.meeting_participants set response = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where meeting_id = p_id and user_id = auth.uid();
  if not found then raise exception 'You are not invited to this meeting' using errcode = '42501'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform app.notify(m.host_id, 'meeting_response', v_name || case when p_accept then ' accepted' else ' declined' end, m.title, null, null, '/meetings?meeting=' || p_id::text);
end $$;

create function public.start_meeting(p_id uuid) returns void language plpgsql security definer set search_path = public, app as $$
declare m public.meetings; r record; v_name text;
begin
  select * into m from public.meetings where id = p_id for update;
  if not found or m.host_id <> auth.uid() then raise exception 'Only the host can start the meeting' using errcode = '42501'; end if;
  if m.status = 'live' then return; end if;
  if m.status <> 'scheduled' then raise exception 'This meeting is %', m.status using errcode = '22023'; end if;
  update public.meetings set status = 'live', started_at = now() where id = p_id;
  select full_name into v_name from public.profiles where id = auth.uid();
  for r in select user_id from public.meeting_participants where meeting_id = p_id and response <> 'declined' loop
    perform app.notify(r.user_id, 'meeting_started', v_name || ' started the meeting', m.title, null, null, '/meetings?meeting=' || p_id::text);
  end loop;
end $$;

create function public.end_meeting(p_id uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  update public.meetings set status = 'ended', ended_at = now() where id = p_id and host_id = auth.uid() and status in ('scheduled','live');
  if not found then raise exception 'Only the host can end an open meeting' using errcode = '42501'; end if;
end $$;

create function public.cancel_meeting(p_id uuid) returns void language plpgsql security definer set search_path = public, app as $$
declare m public.meetings; r record; v_name text;
begin
  update public.meetings set status = 'cancelled', ended_at = now() where id = p_id and host_id = auth.uid() and status in ('scheduled','live') returning * into m;
  if not found then raise exception 'Only the host can cancel an open meeting' using errcode = '42501'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  for r in select user_id from public.meeting_participants where meeting_id = p_id loop
    perform app.notify(r.user_id, 'meeting_cancelled', 'Meeting cancelled', m.title || ' (by ' || v_name || ')', null, null, '/meetings');
  end loop;
end $$;

create function public.add_meeting_invitees(p_id uuid, p_invitees uuid[]) returns void
language plpgsql security definer set search_path = public, app as $$
declare m public.meetings; r uuid; v_name text; v_new uuid[];
begin
  select * into m from public.meetings where id = p_id;
  if not found or m.host_id <> auth.uid() or m.status not in ('scheduled','live') then raise exception 'Only the host can invite people to an open meeting' using errcode = '42501'; end if;
  if (select count(*) from public.meeting_participants where meeting_id = p_id) + coalesce(cardinality(p_invitees), 0) > 100 then raise exception 'A meeting can have at most 100 invitees' using errcode = '22023'; end if;
  with ins as (insert into public.meeting_participants(meeting_id, user_id)
    select p_id, p.id from public.profiles p where p.id = any(coalesce(p_invitees, '{}')) and p.is_active and p.id <> m.host_id
    on conflict do nothing returning user_id) select array_agg(user_id) into v_new from ins;
  select full_name into v_name from public.profiles where id = auth.uid();
  foreach r in array coalesce(v_new, '{}') loop
    perform app.notify(r, case when m.status = 'live' then 'meeting_call' else 'meeting_invite' end,
      case when m.status = 'live' then v_name || ' is calling you' else 'Meeting request from ' || v_name end,
      m.title || coalesce(' · ' || app.fmt_when(m.scheduled_at, r), ''), null, null, '/meetings?meeting=' || p_id::text);
  end loop;
end $$;

create function public.delete_meeting(p_id uuid) returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from public.meetings where id = p_id and (host_id = auth.uid() or app.has_perm('users.manage'))) then
    raise exception 'Meeting not found or not permitted' using errcode = '42501';
  end if;
  delete from public.meetings where id = p_id;
end $$;

-- A person joins: invitees auto-accept (this is how an instant call is answered). Marks joined_at.
create function public.join_meeting(p_id uuid) returns void language plpgsql security definer set search_path = public, app as $$
declare m public.meetings;
begin
  select * into m from public.meetings where id = p_id;
  if not found or not app.is_active_user() or not app.is_meeting_member(p_id, auth.uid()) then raise exception 'Meeting not found' using errcode = '42501'; end if;
  if m.status = 'scheduled' then raise exception 'The host has not started this meeting yet' using errcode = '22023'; end if;
  if m.status <> 'live' then raise exception 'This meeting is over' using errcode = '22023'; end if;
  update public.meeting_participants set response = 'accepted', responded_at = coalesce(responded_at, now()), joined_at = now() where meeting_id = p_id and user_id = auth.uid();
end $$;

-- Used ONLY by the Edge Function (service role): authorises a LiveKit token independently of the browser.
create function public.meeting_join_check(p_user uuid, p_meeting uuid) returns table(room_name text, display_name text, is_host boolean)
language sql stable security definer set search_path = public, app as $$
  select m.room_name, pr.full_name, (m.host_id = p_user)
    from public.meetings m join public.profiles pr on pr.id = p_user and pr.is_active
   where m.id = p_meeting and m.status = 'live'
     and (m.host_id = p_user or exists (select 1 from public.meeting_participants p where p.meeting_id = m.id and p.user_id = p_user and p.response = 'accepted'))
$$;

-- reminders for scheduled meetings, run by the same pg_cron job as follow-up reminders
create function app.process_meeting_reminders(p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = public, app as $$
declare m record; r record;
begin
  for m in select * from public.meetings where status = 'scheduled' and scheduled_at between p_now - interval '30 minutes' and p_now + interval '10 minutes' loop
    for r in select m.host_id as uid union select user_id from public.meeting_participants where meeting_id = m.id and response = 'accepted' loop
      if m.scheduled_at > p_now then
        perform app.notify(r.uid, 'meeting_reminder', 'Meeting starting soon', m.title || ' · ' || app.fmt_when(m.scheduled_at, r.uid), null, null, '/meetings?meeting=' || m.id::text, 'mtgrem:' || m.id::text || ':' || r.uid::text);
      elsif r.uid = m.host_id then
        perform app.notify(r.uid, 'meeting_due', 'Time to start your meeting', m.title, null, null, '/meetings?meeting=' || m.id::text, 'mtgdue:' || m.id::text);
      end if;
    end loop;
  end loop;
end $$;

alter function app.process_due_reminders(timestamptz, int) rename to process_follow_up_reminders;
create function app.process_due_reminders(p_now timestamptz default now(), p_batch int default 500)
returns table(fired int, cancelled int, skipped int) language plpgsql security definer set search_path = public, app as $$
begin
  perform app.process_meeting_reminders(p_now);
  return query select f.fired, f.cancelled, f.skipped from app.process_follow_up_reminders(p_now, p_batch) f;
end $$;

-- grants
grant select on public.meetings, public.meeting_participants to authenticated;
grant all on public.meetings, public.meeting_participants to service_role;
grant execute on function app.is_meeting_member(uuid, uuid) to authenticated;
grant execute on function public.create_meeting(text, uuid[], boolean, date, time, text, text), public.respond_meeting(uuid, boolean),
  public.start_meeting(uuid), public.end_meeting(uuid), public.cancel_meeting(uuid), public.add_meeting_invitees(uuid, uuid[]),
  public.delete_meeting(uuid), public.join_meeting(uuid) to authenticated;
revoke execute on function public.meeting_join_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.meeting_join_check(uuid, uuid) to service_role;
grant execute on all functions in schema app to service_role;
revoke execute on function app.process_due_reminders(timestamptz, int), app.process_follow_up_reminders(timestamptz, int), app.process_meeting_reminders(timestamptz) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.meetings;
    alter publication supabase_realtime add table public.meeting_participants;
  end if;
end $$;
