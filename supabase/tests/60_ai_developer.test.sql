-- AI Developer must behave exactly like Developer
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
insert into auth.users(id, email) values (t.uid('g'), 'aidev@x.test');
insert into public.profiles(id, username, full_name, role, must_change_password) values (t.uid('g'), 'aidev', 'Aidev', 'ai_developer', false);
do $$
declare proj uuid; task uuid; n int;
begin
  -- PM creates a project with the team lead; the AI developer is a member
  perform t.as_user(t.uid('p'));
  insert into public.projects(name, project_manager_id, team_lead_id, status) values ('AI chatbot', t.uid('p'), t.uid('l'), 'active') returning id into proj;
  insert into public.project_members(project_id, user_id) values (proj, t.uid('g'));
  perform t.ok(true, '60. an AI Developer can be added to a project (like a Developer)');
  insert into public.tasks(project_id, title, assigned_to) values (proj, 'Train model', t.uid('g')) returning id into task;
  perform t.ok(true, '60. the Project Manager can assign a task to an AI Developer on the project');
  perform t.as_user(t.uid('l'));
  insert into public.tasks(project_id, title, assigned_to) values (proj, 'Evaluate model', t.uid('g'));
  perform t.ok(true, '60. the Team Lead can delegate to an AI Developer on their project');

  -- what the AI Developer can and cannot do
  perform t.as_user(t.uid('g'));
  perform t.ok((select count(*) from public.tasks) = 2, '60. an AI Developer sees their assigned tasks');
  perform t.ok((select count(*) from public.projects) = 1, '60. ...and only the projects they belong to');
  update public.tasks set status = 'in_progress' where id = task;
  perform t.ok((select status = 'in_progress' from public.tasks where id = task), '60. can update the status of their own task');
  perform t.denied(format($s$update public.tasks set title = 'x' where id = %L$s$, task), '60. cannot edit anything but the status');
  perform t.denied(format($s$insert into public.tasks(project_id,title) values (%L,'mine')$s$, proj), '60. cannot create tasks');
  perform t.denied(format($s$update public.tasks set status = 'cancelled' where id = %L$s$, task), '60. cannot cancel tasks');
  perform t.ok((select count(*) from public.leads) = 0 and (select count(*) from public.deals) = 0 and (select count(*) from public.quotes) = 0, '60. sees no sales data');
  perform t.ok((select count(*) from public.invoice_balances) = 0, '60. sees no finance data');
  perform t.ok((select count(*) from public.audit_events) = 0, '60. cannot read the audit log');
  perform t.denied(format($s$insert into public.sales_targets(user_id, month, target_usd) values (%L, '2026-05-01', 1)$s$, t.uid('s')), '60. cannot set targets');

  -- an AI developer outside the project sees nothing
  perform t.as_admin();
  insert into auth.users(id, email) values (t.uid('h'), 'aidev2@x.test');
  insert into public.profiles(id, username, full_name, role, must_change_password) values (t.uid('h'), 'aidev2', 'Aidev Two', 'ai_developer', false);
  perform t.as_user(t.uid('h'));
  perform t.ok((select count(*) from public.tasks) = 0 and (select count(*) from public.projects) = 0, '60. an AI Developer not on the project sees nothing');

  -- project manager may NOT assign to a non-member
  perform t.as_user(t.uid('p'));
  perform t.denied(format($s$insert into public.tasks(project_id,title,assigned_to) values (%L,'x',%L)$s$, proj, t.uid('h')), '60. a task cannot go to an AI Developer outside the project');
  perform t.denied(format($s$insert into public.project_members(project_id,user_id) values (%L, %L)$s$, proj, t.uid('s')), '60. a Sales Executive still cannot be a project member');

  -- chat: PM may start, the AI Developer may only reply
  perform public.send_message(t.uid('g'), 'Status?');
  perform t.as_user(t.uid('g'));
  perform public.send_message(t.uid('p'), 'On it');
  perform t.ok(true, '60. an AI Developer can reply to the Project Manager');
  perform t.denied(format($s$select public.send_message(%L,'hi')$s$, t.uid('s')), '60. an AI Developer cannot start a chat with Sales');
  perform t.as_user(t.uid('l'));
  perform public.send_message(t.uid('h'), 'Welcome');
  perform t.ok(true, '60. the Team Lead can start a chat with an AI Developer');

  -- meetings: anyone can invite anyone, including AI Developers
  perform t.as_user(t.uid('g'));
  perform public.create_meeting('Model review', array[t.uid('p'), t.uid('l')], true);
  perform t.ok(true, '60. an AI Developer can start a meeting with the team');
  perform t.as_admin();
end $$;
