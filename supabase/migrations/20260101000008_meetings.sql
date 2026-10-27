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
