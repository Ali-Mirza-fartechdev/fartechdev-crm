-- Follow-up reminder reliability tests. A controlled clock (p_now) stands in for time passing;
-- the processor is the same function pg_cron invokes in production.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
set client_min_messages = notice;

do $$
declare
  L1 constant uuid := '11111111-0000-0000-0000-000000000001';
  L2 constant uuid := '11111111-0000-0000-0000-000000000002';
  fu uuid; fu2 uuid; fu3 uuid; fu4 uuid; fu5 uuid;
  due timestamptz; loc timestamp; n int; res record; nid uuid;
  v_before int; ver int;
begin
  -- 1 ─ persistence + timezone: three people in different zones schedule the same instant
  perform t.as_user(t.uid('s'));
  due := date_trunc('second', now() + interval '2 hours');
  loc := due at time zone 'Asia/Karachi';
  fu := public.create_follow_up(L1, null, 'Call Sarah about the proposal', 'call', loc::date, loc::time,
                                'Asia/Karachi', null, 'Bring pricing', 'high', '{60,15,0}');
  perform t.as_admin();
  perform t.ok((select due_at = due from public.follow_ups where id = fu), '1. follow-up persists with exact UTC instant (Asia/Karachi input)');

  perform t.as_user(t.uid('s'));
  loc := due at time zone 'America/New_York';
  fu2 := public.create_follow_up(L1, null, 'NY-zone entry', 'email', loc::date, loc::time, 'America/New_York');
  loc := due at time zone 'Pacific/Auckland';
  fu3 := public.create_follow_up(L1, null, 'AKL-zone entry', 'email', loc::date, loc::time, 'Pacific/Auckland');
  perform t.as_admin();
  perform t.ok((select count(distinct due_at) from public.follow_ups where id in (fu, fu2, fu3)) = 1,
               '10. same local-time input in 3 time zones resolves to ONE identical UTC instant');
  perform t.ok((select to_char(due_at at time zone 'Asia/Karachi','HH24:MI') = to_char(due at time zone 'Asia/Karachi','HH24:MI')
                from public.follow_ups where id = fu2), '10. display conversion back to Karachi is correct');
  delete from public.follow_ups where id in (fu2, fu3);

  -- 2 ─ reminder queue built from the persisted policy
  perform t.ok((select count(*) from public.follow_up_reminders where follow_up_id = fu and status = 'pending') = 4,
               '2. reminder policy {60,15,0} persisted as 3 reminders + 1 overdue occurrence');

  -- 2b ─ nothing fires early
  select * into res from app.process_due_reminders(now() + interval '30 minutes');
  perform t.ok(res.fired = 0 and not exists (select 1 from public.notifications where follow_up_id = fu), '2. nothing fires before its time');

  -- 2c ─ 1h-before fires exactly once, to the right person
  select * into res from app.process_due_reminders(due - interval '59 minutes');
  perform t.ok(res.fired = 1, '2. the 1-hour reminder fires when due');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu and user_id = t.uid('s')
                and title = 'Follow-up due in 1 hour') = 1, '8. notification is addressed to the assigned user');

  -- 7 ─ repeated scheduler executions never duplicate
  select count(*) into v_before from public.notifications where follow_up_id = fu;
  perform app.process_due_reminders(due - interval '59 minutes');
  perform app.process_due_reminders(due - interval '59 minutes');
  perform app.process_due_reminders(due - interval '58 minutes');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu) = v_before,
               '7. repeated scheduler runs create no duplicate notifications');
  begin
    insert into public.notifications(user_id,type,title,dedupe_key)
      select user_id,'x','dup',dedupe_key from public.notifications where follow_up_id = fu limit 1;
    raise exception 'FAIL: duplicate dedupe_key accepted';
  exception when unique_violation then
    raise notice 'PASS: 7. database unique index rejects a duplicate occurrence (concurrency-safe)';
  end;

  perform app.process_due_reminders(due - interval '14 minutes');
  select * into res from app.process_due_reminders(due + interval '1 second');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu) = 3,
               '2. 15-minute and due-now reminders each fired once (3 total)');
  perform t.ok(exists (select 1 from public.notifications where follow_up_id = fu and title = 'Follow-up due now'
                       and body like 'Call Sarah about the proposal — Sarah Khan · Northstar Digital%'),
               '2. due-now text names the follow-up and the related lead');

  -- 4 ─ unresolved follow-up becomes overdue, and stays visible
  perform t.ok((select is_overdue from public.follow_up_details where id = fu) is false, '4. not overdue before its time');
  update public.follow_ups set due_at = due_at where id = fu;     -- no-op: must NOT bump the schedule
  perform t.ok((select schedule_version from public.follow_ups where id = fu) = 1, '6. a no-change update does not reschedule');
  select * into res from app.process_due_reminders(due + interval '31 minutes');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu and type = 'follow_up_overdue') = 1,
               '4. overdue notification generated after the grace period');
  -- (is_overdue is evaluated against the real clock; verify the rule on a genuinely past due_at below)

  -- 5 ─ completing stops pending reminders, preserves history
  perform t.as_user(t.uid('s'));
  fu4 := public.create_follow_up(L1, null, 'Complete me', 'call', ((now()+interval '3 hours') at time zone 'UTC')::date,
                                 ((now()+interval '3 hours') at time zone 'UTC')::time, 'UTC', null, null, 'medium', '{15,0}');
  perform public.complete_follow_up(fu4, 'Spoke to client');
  perform t.as_admin();
  perform t.ok((select count(*) from public.follow_up_reminders where follow_up_id = fu4 and status = 'pending') = 0,
               '5. completing cancels every pending reminder');
  perform t.ok((select count(*) from public.follow_up_reminders where follow_up_id = fu4 and status = 'cancelled') >= 2,
               '5. cancelled occurrences are preserved as history');
  perform app.process_due_reminders(now() + interval '10 days');
  perform t.ok(not exists (select 1 from public.notifications where follow_up_id = fu4), '5. a completed follow-up never notifies');
  perform t.ok((select completed_at is not null and completed_by = t.uid('s') from public.follow_ups where id = fu4),
               '5. completion time and actor recorded');

  -- 6 ─ rescheduling invalidates the old occurrence and schedules the new one
  perform t.as_user(t.uid('s'));
  fu5 := public.create_follow_up(L1, null, 'Reschedule me', 'meeting',
          ((now()+interval '3 hours') at time zone 'UTC')::date, ((now()+interval '3 hours') at time zone 'UTC')::time, 'UTC');
  due := (select due_at from public.follow_ups where id = fu5);
  loc := (now() + interval '5 hours') at time zone 'UTC';
  perform public.reschedule_follow_up(fu5, loc::date, loc::time, 'UTC', null, 'Client asked for later');
  perform t.as_admin();
  perform t.ok((select schedule_version from public.follow_ups where id = fu5) = 2, '6. reschedule bumps schedule_version');
  perform t.ok((select count(*) from public.follow_up_reminders where follow_up_id = fu5 and schedule_version = 1 and status = 'pending') = 0,
               '6. old schedule has no pending occurrences');
  perform t.ok((select count(*) from public.follow_up_reminders where follow_up_id = fu5 and schedule_version = 2 and status = 'pending') = 2,
               '6. new schedule created (due-now + overdue)');
  perform app.process_due_reminders(due + interval '1 minute');
  perform t.ok(not exists (select 1 from public.notifications where follow_up_id = fu5), '6. stale reminder for the OLD time never fires');
  perform app.process_due_reminders((select due_at from public.follow_ups where id = fu5) + interval '1 minute');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu5 and type = 'follow_up_due') = 1,
               '6. reminder fires at the NEW time');

  -- 12 ─ scheduler downtime: nothing eligible is silently lost
  perform t.as_user(t.uid('s'));
  loc := (now() + interval '10 minutes') at time zone 'UTC';
  fu := public.create_follow_up(L1, null, 'Downtime case', 'call', loc::date, loc::time, 'UTC', null, null, 'medium', '{5,0}');
  perform t.as_admin();
  -- (scheduler is "down": it does not run again until 3 days later)
  select * into res from app.process_due_reminders(now() + interval '3 days');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu) = 3,
               '12. after 3 days of downtime all 3 eligible reminders (5-min, due, overdue) are still delivered');
  perform t.ok((select max_lag_seconds from public.scheduler_runs order by id desc limit 1) > 86400,
               '12. catch-up lag is recorded in scheduler_runs');

  -- offsets that were already in the past at creation are skipped, visibly
  perform t.as_user(t.uid('s'));
  loc := (now() + interval '10 minutes') at time zone 'UTC';
  fu := public.create_follow_up(L1, null, 'Soon', 'call', loc::date, loc::time, 'UTC', null, null, 'medium', '{15,0}');
  perform t.as_admin();
  perform t.ok((select status || ':' || reason from public.follow_up_reminders where follow_up_id = fu and offset_minutes = 15 and kind = 'reminder')
               = 'skipped:offset_already_passed', '2. "15 min before" on a follow-up 10 min away is skipped, not fired late');

  -- 4 ─ overdue is derived from a genuinely past timestamp
  update public.follow_ups set due_at = now() - interval '2 hours' where id = fu;     -- trusted/admin correction
  perform t.ok((select is_overdue from public.follow_up_details where id = fu), '4. pending + past due_at = overdue');
  update public.follow_ups set status = 'completed' where id = fu;
  perform t.ok((select is_overdue from public.follow_up_details where id = fu) is false, '4. completed follow-up is no longer overdue');

  -- past times are rejected on creation
  perform t.as_user(t.uid('s'));
  perform t.denied(format($f$select public.create_follow_up(%L,null,'Past','call',%L,%L,'UTC')$f$, L1,
     ((now() - interval '2 days') at time zone 'UTC')::date, ((now() - interval '2 days') at time zone 'UTC')::time),
     '2. cannot schedule a follow-up in the past');
  perform t.as_admin();
end $$;

-- 8, 9 ─ authorisation of recipients and read-state persistence
do $$
declare
  L1 constant uuid := '11111111-0000-0000-0000-000000000001';
  loc timestamp; nid uuid; n int; fu_cso uuid;
begin
  -- CSO schedules a follow-up FOR sales1 (leaders may delegate); the reminder must go to sales1 only
  perform t.as_user(t.uid('c'));
  loc := (now() + interval '1 hour') at time zone 'UTC';
  fu_cso := public.create_follow_up(L1, null, 'Delegated by CSO', 'call', loc::date, loc::time, 'UTC', t.uid('s'), null, 'medium', '{0}');
  perform t.as_admin();
  perform app.process_due_reminders(now() + interval '2 hours');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu_cso and type = 'follow_up_due' and user_id = t.uid('s')) = 1,
               '8. delegated follow-up notifies the assignee');
  perform t.ok((select count(*) from public.notifications where follow_up_id = fu_cso and type = 'follow_up_due' and user_id = t.uid('c')) = 0,
               '8. ...and not the person who created it');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.uid('s') and type = 'follow_up_assigned'),
               '8. assignee is also told about the assignment');

  -- another sales exec cannot see or touch it
  perform t.as_user(t.uid('x'));
  perform t.ok((select count(*) from public.follow_ups where id = fu_cso) = 0, '8. other sales exec cannot see the follow-up');
  perform t.ok((select count(*) from public.notifications where user_id = t.uid('s')) = 0, '8. other users cannot read someone else''s notifications');
  perform t.denied(format($f$select public.complete_follow_up(%L)$f$, fu_cso), '8. other sales exec cannot complete it');
  perform t.denied(format($f$select public.create_follow_up(%L,null,'x','call',current_date+1,'10:00','UTC')$f$, L1),
                   '8. cannot schedule a follow-up on a lead you do not own');
  update public.notifications set read_at = now() where user_id = t.uid('s');
  get diagnostics n = row_count;
  perform t.ok(n = 0, '8. cannot mark another user''s notification read (0 rows touched)');
  perform t.as_admin();

  -- 9 ─ read state persists
  perform t.as_user(t.uid('s'));
  select id into nid from public.notifications where user_id = t.uid('s') and read_at is null order by created_at limit 1;
  update public.notifications set read_at = now() where id = nid;
  perform t.as_admin();
  perform t.ok((select read_at is not null from public.notifications where id = nid), '9. read status persists in the database');
  perform t.as_user(t.uid('s'));
  update public.notifications set read_at = now() where user_id = t.uid('s') and read_at is null;   -- "mark all read"
  perform t.ok((select count(*) from public.notifications where read_at is null) = 0, '9. mark-all-read clears the unread count');
  perform t.as_admin();

end $$;
