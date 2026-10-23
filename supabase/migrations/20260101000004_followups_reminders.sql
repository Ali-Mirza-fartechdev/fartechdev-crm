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
