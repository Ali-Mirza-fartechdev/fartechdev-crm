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
