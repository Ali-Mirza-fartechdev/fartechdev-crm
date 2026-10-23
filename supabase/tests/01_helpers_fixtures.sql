-- Test helpers + fixtures (test database only)
create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $$;

create function t.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- the statement must be rejected (privilege error, RLS violation, or rule violation)
create function t.denied(stmt text, name text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    raise notice 'PASS: % [blocked: %]', name, left(sqlerrm, 70); return;
  end;
  raise exception 'FAIL: % (statement was allowed)', name;
end $$;
grant execute on all functions in schema t to authenticated, anon;

-- users: ids are fixed so tests read clearly
create function t.uid(n text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(to_hex(ascii(n)), 12, '0'))::uuid $$;
grant execute on function t.uid(text) to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('a','admin','super_admin'),('c','cso','cso'),('s','sales1','sales_executive'),('x','sales2','sales_executive'),
    ('p','pmgr','project_manager'),('l','teamlead','team_lead'),('d','dev1','developer'),('e','dev2','developer'),
    ('f','finance','finance')) as v(k,u,role)
  loop
    insert into auth.users(id, email) values (t.uid(r.k), r.u || '@x.test');
    insert into public.profiles(id, username, full_name, role, must_change_password)
      values (t.uid(r.k), r.u, initcap(r.u), r.role::public.app_role, false);
  end loop;

  insert into public.leads(id, full_name, company, owner_id, status) values
    ('11111111-0000-0000-0000-000000000001','Sarah Khan','Northstar Digital', t.uid('s'),'contacting'),
    ('11111111-0000-0000-0000-000000000002','Omar Ali','Bluewave Ltd', t.uid('x'),'new');
  insert into public.clients(id, name, owner_id) values
    ('22222222-0000-0000-0000-000000000001','Harbor Foods', t.uid('s'));
end $$;
