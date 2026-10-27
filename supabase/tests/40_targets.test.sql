-- Who may assign targets to whom
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
do $$
declare n int; m date := '2026-01-01';
begin
  perform t.as_user(t.uid('a'));
  insert into public.sales_targets(user_id, month, target_usd) values (t.uid('c'), m, 90000);
  perform t.ok(true, '40. Super Admin can set the CSO''s target');
  insert into public.sales_targets(user_id, month, target_usd) values (t.uid('s'), m, 20000);
  perform t.ok(true, '40. Super Admin can set a Sales Executive''s target');
  perform t.denied(format($s$insert into public.sales_targets(user_id, month, target_usd) values (%L, %L, 1)$s$, t.uid('d'), m), '40. nobody can set a developer''s target');

  perform t.as_user(t.uid('c'));
  insert into public.sales_targets(user_id, month, target_usd) values (t.uid('x'), m, 15000);
  perform t.ok(true, '40. CSO can set a Sales Executive''s target');
  perform t.denied(format($s$insert into public.sales_targets(user_id, month, target_usd) values (%L, '2026-02-01', 1)$s$, t.uid('c')), '40. CSO cannot set their own target');
  perform t.ok((select count(*) from public.sales_targets where user_id = t.uid('c')) = 1, '40. CSO can read their own target');
  update public.sales_targets set target_usd = 1 where user_id = t.uid('c'); get diagnostics n = row_count;
  perform t.ok(n = 0, '40. CSO cannot edit the target the Super Admin set for them');
  delete from public.sales_targets where user_id = t.uid('c'); get diagnostics n = row_count;
  perform t.ok(n = 0, '40. CSO cannot delete it either');
  update public.sales_targets set target_usd = 16000 where user_id = t.uid('x'); get diagnostics n = row_count;
  perform t.ok(n = 1, '40. CSO can edit a Sales Executive''s target');

  perform t.as_user(t.uid('s'));
  perform t.ok((select count(*) from public.sales_targets where user_id <> auth.uid()) = 0 and (select count(*) from public.sales_targets) >= 1, '40. a Sales Executive sees only their own targets');
  perform t.denied(format($s$insert into public.sales_targets(user_id, month, target_usd) values (%L, '2026-03-01', 1)$s$, t.uid('s')), '40. a Sales Executive cannot set targets');
  perform t.as_admin();
end $$;
