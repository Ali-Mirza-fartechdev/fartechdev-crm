\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
do $$
declare m_inst uuid; m_sched uuid; n int; loc timestamp; chk record;
begin
  -- instant group call: a developer calls the CSO and a finance user (anyone can invite anyone)
  perform t.as_user(t.uid('d'));
  m_inst := public.create_meeting('Quick sync', array[t.uid('c'), t.uid('f'), t.uid('d')], true);
  perform t.as_admin();
  perform t.ok((select status = 'live' and started_at is not null from public.meetings where id = m_inst), '50. an instant call starts immediately');
  perform t.ok((select count(*) from public.meeting_participants where meeting_id = m_inst) = 2, '50. the host is not counted as their own invitee (2 invitees)');
  perform t.ok((select count(*) from public.notifications where type = 'meeting_call' and body = 'Quick sync') = 2, '50. each invitee is notified "X is calling you"');

  -- privacy
  perform t.as_user(t.uid('s'));
  perform t.ok((select count(*) from public.meetings) = 0, '50. an uninvited user cannot see the meeting');
  perform t.ok((select count(*) from public.meeting_participants) = 0, '50. ...or its participant list');
  perform t.denied(format($s$select public.join_meeting(%L)$s$, m_inst), '50. an uninvited user cannot join');
  perform t.as_user(t.uid('c'));
  perform t.ok((select count(*) from public.meetings where id = m_inst) = 1 and (select count(*) from public.meeting_participants where meeting_id = m_inst) = 2, '50. invitees see the meeting and who else is invited');

  -- token authorisation (what the Edge Function relies on)
  perform t.as_admin();
  perform t.ok((select count(*) from public.meeting_join_check(t.uid('c'), m_inst)) = 0, '50. an invitee who has NOT joined/accepted gets no room token');
  perform t.as_user(t.uid('c')); perform public.join_meeting(m_inst);
  perform t.as_admin();
  perform t.ok((select count(*) from public.meeting_join_check(t.uid('c'), m_inst)) = 1, '50. joining (answering) an instant call authorises the token');
  perform t.ok((select count(*) from public.meeting_join_check(t.uid('d'), m_inst)) = 1 and (select is_host from public.meeting_join_check(t.uid('d'), m_inst)), '50. the host is always authorised');
  perform t.ok((select count(*) from public.meeting_join_check(t.uid('s'), m_inst)) = 0, '50. a stranger is never authorised');
  perform t.as_user(t.uid('f')); perform public.respond_meeting(m_inst, false);
  perform t.as_admin();
  perform t.ok((select count(*) from public.meeting_join_check(t.uid('f'), m_inst)) = 0, '50. a person who declined gets no token');
  perform t.as_user(t.uid('s'));
  perform t.denied(format($s$select public.meeting_join_check(%L, %L)$s$, t.uid('s'), m_inst), '50. users cannot call the token-check function directly');

  -- host controls
  perform t.as_user(t.uid('c'));
  perform t.denied(format($s$select public.end_meeting(%L)$s$, m_inst), '50. only the host can end a meeting');
  perform t.denied(format($s$select public.add_meeting_invitees(%L, array[%L]::uuid[])$s$, m_inst, t.uid('s')), '50. only the host can invite more people');
  perform t.as_user(t.uid('d'));
  perform public.add_meeting_invitees(m_inst, array[t.uid('s'), t.uid('x'), t.uid('p')]);
  perform t.as_admin();
  perform t.ok((select count(*) from public.meeting_participants where meeting_id = m_inst) = 5, '50. the host can add any number of people mid-call');
  perform t.as_user(t.uid('d')); perform public.end_meeting(m_inst);
  perform t.as_user(t.uid('c'));
  perform t.denied(format($s$select public.join_meeting(%L)$s$, m_inst), '50. nobody can join a meeting that has ended');

  -- scheduled meeting: request → accept → host starts → join
  perform t.as_user(t.uid('s'));
  loc := (now() + interval '2 hours') at time zone 'Asia/Karachi';
  m_sched := public.create_meeting('Pricing review', array[t.uid('c'), t.uid('p'), t.uid('a')], false, loc::date, loc::time, 'Asia/Karachi');
  perform t.denied(format($s$select public.create_meeting('Past', array[%L]::uuid[], false, current_date - 3, '10:00', 'UTC')$s$, t.uid('c')), '51. cannot schedule a meeting in the past');
  perform t.denied(format($s$select public.create_meeting('Alone', array[%L]::uuid[], true)$s$, t.uid('s')), '51. you cannot invite only yourself');
  perform t.as_admin();
  perform t.ok((select count(*) from public.notifications where type = 'meeting_invite' and body like 'Pricing review%') = 3, '51. each invitee gets a meeting request notification');
  perform t.as_user(t.uid('c'));
  perform t.denied(format($s$select public.join_meeting(%L)$s$, m_sched), '51. cannot join before the host starts');
  perform public.respond_meeting(m_sched, true);
  perform t.as_admin();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.uid('s') and type = 'meeting_response'), '51. the host is told when someone accepts');
  perform t.ok((select count(*) from public.meeting_join_check(t.uid('c'), m_sched)) = 0, '51. an accepted invitee has no token until the meeting is live');
  perform t.as_user(t.uid('c'));
  perform t.denied(format($s$select public.start_meeting(%L)$s$, m_sched), '51. only the host can start it');
  perform t.as_user(t.uid('s')); perform public.start_meeting(m_sched);
  perform t.as_admin();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.uid('c') and type = 'meeting_started'), '51. invitees are notified when the host starts');
  perform t.ok((select count(*) from public.meeting_join_check(t.uid('c'), m_sched)) = 1, '51. once live, the accepted invitee is authorised');
end $$;

do $$
declare m uuid; loc timestamp; res record;
begin
  perform t.as_admin();
  -- reminders + delete + cancel
  perform t.as_user(t.uid('a'));
  loc := (now() + interval '8 minutes') at time zone 'UTC';
  m := public.create_meeting('Soon', array[t.uid('c')], false, loc::date, loc::time, 'UTC');
  perform t.as_user(t.uid('c')); perform public.respond_meeting(m, true);
  perform t.as_admin();
  perform app.process_due_reminders(now()); perform app.process_due_reminders(now());
  perform t.ok((select count(*) from public.notifications where type = 'meeting_reminder' and body like 'Soon%') = 2, '52. host and accepted invitee get ONE reminder each (not duplicated by repeated runs)');
  select * into res from app.process_due_reminders(now() + interval '1 minute');
  perform t.ok(res.fired is not null, '52. the follow-up reminder processor still works through the wrapper');
  perform t.as_user(t.uid('a')); perform public.cancel_meeting(m);
  perform t.as_user(t.uid('c'));
  perform t.ok(exists (select 1 from public.notifications where type = 'meeting_cancelled' and user_id = t.uid('c')), '52. invitees are told when a meeting is cancelled');
  perform t.denied(format($s$select public.delete_meeting(%L)$s$, m), '52. an invitee cannot delete the host''s meeting');
  perform t.as_user(t.uid('a')); perform public.delete_meeting(m);
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.meetings where id = m), '52. the host can delete a meeting');
end $$;
