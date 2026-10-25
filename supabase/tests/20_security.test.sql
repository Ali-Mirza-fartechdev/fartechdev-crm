-- Access-control, workflow-rule and finance tests
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

do $$
declare
  L1 constant uuid := '11111111-0000-0000-0000-000000000001';
  L2 constant uuid := '11111111-0000-0000-0000-000000000002';
  n int; proj uuid; task uuid; inv uuid; stage_won uuid; deal uuid; cl uuid;
begin
  -- anonymous / unauthenticated
  execute 'set local role anon';
  perform t.denied('select * from public.leads', 'anon cannot read leads');
  perform t.denied('select * from public.profiles', 'anon cannot read profiles');
  execute 'reset role';

  -- lead visibility by role
  perform t.as_user(t.uid('x'));  perform t.ok((select count(*) from public.leads) = 1, 'sales exec sees only own leads');
  perform t.as_user(t.uid('c'));  perform t.ok((select count(*) from public.leads) = 2, 'CSO sees all leads');
  perform t.as_user(t.uid('d'));  perform t.ok((select count(*) from public.leads) = 0, 'developer sees no leads');
  perform t.as_user(t.uid('p'));  perform t.ok((select count(*) from public.leads) = 0, 'project manager sees no leads');
  perform t.as_user(t.uid('f'));  perform t.ok((select count(*) from public.leads) = 0, 'finance sees no leads');

  -- privilege escalation / spoofing
  perform t.as_user(t.uid('s'));
  perform t.denied($s$update public.profiles set role = 'super_admin' where id = auth.uid()$s$, 'cannot promote yourself');
  perform t.denied($s$update public.profiles set is_active = true where id = auth.uid()$s$, 'cannot change your own active flag');
  update public.profiles set full_name = 'Hacked' where id = t.uid('a');
  get diagnostics n = row_count;
  perform t.ok(n = 0, 'cannot edit another user''s profile (RLS filters it to 0 rows)');
  perform t.denied($s$insert into public.notifications(user_id,type,title) values (auth.uid(),'x','forged')$s$, 'cannot forge notifications');
  perform t.denied($s$insert into public.audit_events(action) values ('forged')$s$, 'cannot write audit events');
  perform t.denied(format($s$insert into public.leads(full_name, owner_id) values ('Stolen', %L)$s$, t.uid('x')), 'cannot create a lead owned by someone else');
  perform t.denied(format($s$insert into public.leads(full_name, owner_id, created_by) values ('Spoof test', %L, %L)$s$, t.uid('s'), t.uid('a')),
                   'created_by cannot be supplied by the browser at all');
  insert into public.leads(full_name, owner_id) values ('Spoof test', t.uid('s'));
  perform t.as_admin();
  perform t.ok((select created_by = t.uid('s') from public.leads where full_name = 'Spoof test'), 'created_by is stamped server-side with the real user');

  perform t.as_user(t.uid('s'));
  perform t.denied('insert into public.follow_ups(lead_id,title,due_at,timezone,assigned_to) values (' || quote_literal(L1) || ',''x'',now(),''UTC'',auth.uid())', 'follow-ups cannot be inserted directly');
  perform t.denied($s$update public.follow_ups set due_at = now() + interval '1 day'$s$, 'follow-up time cannot be changed outside the RPC');
  perform t.ok((select count(*) from public.audit_events) = 0, 'audit log returns no rows to a sales executive');
  perform t.as_admin();

  -- lead conversion
  perform t.as_user(t.uid('s'));
  cl := public.convert_lead_to_client(L1);
  perform t.ok((select count(*) from public.clients where id = cl and owner_id = t.uid('s')) = 1, 'lead converts to a client owned by the same user');
  perform t.ok((select status = 'converted' from public.leads where id = L1), 'converted lead status updated');
  perform t.as_user(t.uid('x'));
  perform t.denied(format($s$select public.convert_lead_to_client(%L)$s$, L1), 'other user cannot convert someone else''s lead');
  perform t.as_admin();

  -- deals + stage history; Won is reserved for Finance approval
  select id into stage_won from public.pipeline_stages where is_won;
  perform t.as_user(t.uid('x'));
  insert into public.deals(title, lead_id, stage_id, value, owner_id)
    values ('Bluewave site', L2, (select id from public.pipeline_stages where position = 1), 5000, t.uid('x')) returning id into deal;
  update public.deals set stage_id = (select id from public.pipeline_stages where position = 2) where id = deal;
  perform t.denied(format($s$update public.deals set stage_id = %L where id = %L$s$, stage_won, deal), 'sales cannot move a deal to Won directly');
  update public.deals set stage_id = (select id from public.pipeline_stages where is_lost) where id = deal;
  perform t.as_admin();
  perform t.ok((select count(*) from public.deal_stage_history where deal_id = deal) = 3, 'deal stage changes are recorded');
  perform t.ok((select closed_at is not null from public.deals where id = deal), 'closing a deal stamps closed_at');

  -- projects & tasks workflow
  perform t.as_user(t.uid('p'));
  insert into public.projects(name, client_id, project_manager_id, team_lead_id, status)
    values ('Harbor portal', '22222222-0000-0000-0000-000000000001', t.uid('p'), t.uid('l'), 'active') returning id into proj;
  insert into public.project_members(project_id, user_id) values (proj, t.uid('d'));
  perform t.denied(format($s$insert into public.project_members(project_id,user_id) values (%L, %L)$s$, proj, t.uid('s')), 'only developers/team leads can be project members');
  insert into public.tasks(project_id, title, assigned_to) values (proj, 'Build login', t.uid('l')) returning id into task;
  perform t.denied(format($s$insert into public.tasks(project_id,title,assigned_to) values (%L,'x',%L)$s$, proj, t.uid('e')),
                   'PM cannot assign to someone outside the project');

  perform t.as_user(t.uid('l'));
  update public.tasks set assigned_to = t.uid('d') where id = task;
  perform t.ok((select assigned_to = t.uid('d') from public.tasks where id = task), 'team lead delegates to a project developer');
  perform t.denied(format($s$update public.tasks set assigned_to = %L where id = %L$s$, t.uid('e'), task), 'team lead cannot assign to a developer outside the project');

  perform t.as_user(t.uid('d'));
  perform t.ok((select count(*) from public.tasks) = 1, 'developer sees their assigned task');
  update public.tasks set status = 'in_progress' where id = task;
  perform t.ok((select status = 'in_progress' from public.tasks where id = task), 'developer can update status of own task');
  perform t.denied(format($s$update public.tasks set title = 'renamed' where id = %L$s$, task), 'developer cannot edit task title');
  perform t.denied(format($s$update public.tasks set assigned_to = %L where id = %L$s$, t.uid('e'), task), 'developer cannot reassign');
  perform t.denied(format($s$insert into public.tasks(project_id,title) values (%L,'self-made')$s$, proj), 'developer cannot create tasks');
  perform t.as_user(t.uid('e'));
  perform t.ok((select count(*) from public.tasks) = 0 and (select count(*) from public.projects) = 0, 'unassigned developer sees no tasks or projects');
  perform t.as_admin();
  perform t.ok(exists (select 1 from public.notifications where user_id = t.uid('d') and type = 'task_assigned'), 'assignee receives a task-assigned notification');

  -- finance: invoiced is not received
  perform t.as_user(t.uid('f'));
  insert into public.invoices(client_id, due_date) values ('22222222-0000-0000-0000-000000000001', current_date + 14) returning id into inv;
  insert into public.invoice_items(invoice_id, description, quantity, unit_price) values (inv, 'Design', 1, 1000), (inv, 'Build', 2, 750);
  perform t.denied(format($s$insert into public.payments(invoice_id,amount) values (%L, 100)$s$, inv), 'cannot take payment against a draft invoice');
  update public.invoices set status = 'sent' where id = inv;
  perform t.ok((select total = 2500 and amount_paid = 0 and balance_due = 2500 and payment_state = 'unpaid' from public.invoice_balances where invoice_id = inv),
               'issuing an invoice records ZERO received money');
  insert into public.payments(invoice_id, amount, method) values (inv, 1000, 'bank_transfer');
  perform t.ok((select amount_paid = 1000 and balance_due = 1500 and payment_state = 'partially_paid' from public.invoice_balances where invoice_id = inv), 'partial payment tracked');
  perform t.denied(format($s$insert into public.payments(invoice_id,amount) values (%L, 1600)$s$, inv), 'overpayment rejected');
  perform t.denied(format($s$insert into public.invoice_items(invoice_id,description,quantity,unit_price) values (%L,'late',1,1)$s$, inv), 'line items freeze once sent');
  insert into public.payments(invoice_id, amount) values (inv, 1500);
  perform t.ok((select payment_state = 'paid' and balance_due = 0 from public.invoice_balances where invoice_id = inv), 'fully paid invoice settles to paid');
  perform t.as_user(t.uid('s'));
  perform t.ok((select count(*) from public.invoices) = 0 and (select count(*) from public.payments) = 0, 'sales cannot read invoices or payments');
  perform t.as_user(t.uid('d'));
  perform t.ok((select count(*) from public.invoice_balances) = 0, 'developer cannot read invoice balances');
  perform t.as_admin();
  perform t.ok((select count(*) from public.audit_events where action like 'payment.%') = 2, 'payments are audited');

  -- permission matrix reflected in data
  perform t.as_user(t.uid('a'));
  perform t.ok((select count(*) from public.audit_events) > 0, 'super admin can read the audit log');
  perform t.as_admin();
end $$;
