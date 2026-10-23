-- FAR Tech CRM · 0005 · deny-by-default grants, default preferences, reminder scheduler
-- RLS (0003/0004) decides WHICH rows; these grants decide WHICH operations and columns exist at all.

-- New profile → default preferences row
create function app.create_default_prefs() returns trigger language plpgsql security definer
set search_path = public, app as $$
begin
  insert into public.user_preferences(user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger trg_profiles_prefs after insert on public.profiles
  for each row execute function app.create_default_prefs();

-- ───────────── start from nothing ─────────────
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Only functions defined by these migrations: extension functions (citext operators, etc.) must stay callable.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
revoke execute on all functions in schema app from public, anon, authenticated;

-- ───────────── reads (rows still filtered by RLS) ─────────────
grant select on
  public.profiles, public.role_permissions, public.organization_settings, public.user_preferences,
  public.audit_events, public.pipeline_stages, public.clients, public.leads, public.deals,
  public.deal_stage_history, public.projects, public.project_members, public.tasks, public.activities,
  public.notifications, public.invoices, public.invoice_items, public.payments, public.invoice_balances,
  public.follow_ups, public.follow_up_reminders, public.follow_up_details, public.scheduler_runs
to authenticated;

-- ───────────── writes: explicit columns only ─────────────
grant update (full_name, phone, avatar_url, timezone) on public.profiles to authenticated;   -- NOT role / is_active / username
grant insert, update (theme, sidebar_collapsed, default_reminder_offsets) on public.user_preferences to authenticated;
grant update (company_name, default_timezone, default_currency, overdue_notice_minutes) on public.organization_settings to authenticated;
grant insert, update, delete on public.pipeline_stages to authenticated;

grant insert (full_name, company, job_title, email, phone, linkedin_url, website, country, industry,
              source, status, temperature, owner_id, notes),
      update (full_name, company, job_title, email, phone, linkedin_url, website, country, industry,
              source, status, temperature, owner_id, notes),
      delete on public.leads to authenticated;
grant insert (name, contact_name, email, phone, website, industry, address, country, notes, is_active, owner_id),
      update (name, contact_name, email, phone, website, industry, address, country, notes, is_active, owner_id),
      delete on public.clients to authenticated;
grant insert (title, lead_id, client_id, stage_id, value, currency, owner_id, expected_close_date, lost_reason, notes),
      update (title, lead_id, client_id, stage_id, value, currency, owner_id, expected_close_date, lost_reason, notes),
      delete on public.deals to authenticated;
grant insert (name, description, client_id, status, project_manager_id, team_lead_id, start_date, due_date),
      update (name, description, client_id, status, project_manager_id, team_lead_id, start_date, due_date),
      delete on public.projects to authenticated;
grant insert, delete on public.project_members to authenticated;
grant insert (project_id, title, description, status, priority, assigned_to, due_date),
      update (title, description, status, priority, assigned_to, due_date),
      delete on public.tasks to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (title, notes, priority, follow_up_type, assigned_to) on public.follow_ups to authenticated;

grant insert (client_id, project_id, status, currency, issue_date, due_date, tax_rate, notes),
      update (status, due_date, tax_rate, notes, project_id), delete on public.invoices to authenticated;
grant insert, update, delete on public.invoice_items to authenticated;
grant insert (invoice_id, amount, paid_at, method, reference, notes), delete on public.payments to authenticated;

-- ───────────── functions callable by signed-in users ─────────────
-- predicates referenced by RLS policies, column defaults and check constraints
grant execute on function
  app.is_active_user(), app.user_role(), app.has_perm(text), app.is_valid_tz(text),
  app.is_project_member(uuid, uuid), app.can_see_project(uuid), app.can_see_lead(uuid),
  app.can_see_client(uuid), app.can_see_deal(uuid), app.can_see_task(uuid),
  app.can_see_entity(text, uuid), app.can_manage_follow_up(uuid), app.next_invoice_number(),
  app.client_visible_via_project(uuid), app.is_project_lead_or_pm(uuid)
to authenticated;
-- the API surface
grant execute on function
  public.add_note(text, uuid, text), public.convert_lead_to_client(uuid), public.clear_must_change_password(),
  public.create_follow_up(uuid, uuid, text, public.follow_up_type, date, time, text, uuid, text, public.priority_level, int[]),
  public.reschedule_follow_up(uuid, date, time, text, int[], text),
  public.complete_follow_up(uuid, text), public.cancel_follow_up(uuid, text), public.add_follow_up_note(uuid, text)
to authenticated;

-- ───────────── server role (Edge Functions only; never shipped to a browser) ─────────────
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;

-- ───────────── scheduler: runs inside the database, independent of any browser ─────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'far-process-follow-up-reminders';
    perform cron.schedule('far-process-follow-up-reminders', '* * * * *', 'select app.process_due_reminders()');
  else
    raise notice 'pg_cron is not available in this database. Enable it (Dashboard → Database → Extensions) and run supabase/scripts/schedule_reminders.sql';
  end if;
exception when others then
  raise notice 'Could not schedule the reminder job automatically (%). Run supabase/scripts/schedule_reminders.sql after enabling pg_cron.', sqlerrm;
end $$;
