-- FAR Tech CRM · 0007 · target assignment rules
--   Super Admin  → can set targets for Sales Executives AND for the CSO
--   CSO          → can set targets for Sales Executives ONLY (never for themselves or another CSO)
-- Run once, after 0006.

insert into public.role_permissions(role, permission) values ('super_admin','targets.assign_cso') on conflict do nothing;

create function app.role_of(p_user uuid) returns public.app_role
language sql stable security definer set search_path = public, app as $$
  select role from public.profiles where id = p_user
$$;
grant execute on function app.role_of(uuid) to authenticated;

create or replace function app.validate_target() returns trigger language plpgsql security definer
set search_path = public, app as $$
declare v_role public.app_role;
begin
  if auth.uid() is not null then new.set_by := auth.uid(); end if;
  select role into v_role from public.profiles where id = new.user_id and is_active;
  if v_role is null or v_role not in ('sales_executive','cso') then
    raise exception 'Targets can only be assigned to active Sales Executives or the CSO' using errcode = '22023';
  end if;
  if v_role = 'cso' and auth.uid() is not null and not app.has_perm('targets.assign_cso') then
    raise exception 'Only the Super Admin can set the CSO''s target' using errcode = '42501';
  end if;
  return new;
end $$;

drop policy targets_select on public.sales_targets;
drop policy targets_write on public.sales_targets;
-- read: your own target; Super Admin everything; CSO the Sales Executives' targets
create policy targets_select on public.sales_targets for select to authenticated
  using (app.is_active_user() and (
    user_id = auth.uid()
    or app.has_perm('targets.assign_cso')
    or (app.has_perm('targets.manage') and app.role_of(user_id) = 'sales_executive')));
-- write: Super Admin for Sales Executives + CSO; CSO for Sales Executives only
create policy targets_write on public.sales_targets for all to authenticated
  using (app.has_perm('targets.assign_cso') or (app.has_perm('targets.manage') and app.role_of(user_id) = 'sales_executive'))
  with check (app.has_perm('targets.assign_cso') or (app.has_perm('targets.manage') and app.role_of(user_id) = 'sales_executive'));
