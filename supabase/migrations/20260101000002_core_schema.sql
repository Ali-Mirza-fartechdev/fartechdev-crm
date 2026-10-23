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
