-- FAR Tech CRM · 0009 · new role: AI Developer
-- An AI Developer has EXACTLY the same access, workflow and pipeline as a Developer:
--   no organisation-wide permissions; sees only projects they are a member of and tasks assigned to them;
--   can update only the STATUS of their own tasks; can be assigned by a Project Manager or by their project's Team Lead;
--   in chat they can reply to anyone who messages them, and the Project Manager / Team Lead can start chats with them.
-- Run once, after 0008. If the SQL Editor complains about the first line, run ONLY that line first, then run the rest.

alter type public.app_role add value if not exists 'ai_developer';

create or replace function app.validate_project_member() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id = new.user_id and is_active;
  if v_role is null or v_role not in ('developer','ai_developer','team_lead') then
    raise exception 'Only active Developers, AI Developers or Team Leads can be project members' using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function app.enforce_task_rules() returns trigger language plpgsql security definer
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

  if v_role in ('developer','ai_developer') then
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

  if v_role not in ('developer','ai_developer') and new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    select role into v_assignee_role from public.profiles where id = new.assigned_to and is_active;
    if v_assignee_role is null then
      raise exception 'Assignee must be an active user' using errcode = '22023';
    end if;
    if v_role = 'team_lead' then
      if new.assigned_to <> v_uid
         and not (v_assignee_role in ('developer','ai_developer') and app.is_project_member(new.project_id, new.assigned_to)) then
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

create or replace function app.can_message(p_sender uuid, p_recipient uuid) returns boolean
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
    when 'project_manager' then r in ('super_admin','cso','developer','ai_developer','team_lead')
    when 'finance' then r in ('super_admin','cso')
    when 'team_lead' then r in ('project_manager','developer','ai_developer')
    else false end;
end $$;
