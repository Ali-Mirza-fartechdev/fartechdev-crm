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
