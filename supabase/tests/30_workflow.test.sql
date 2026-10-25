-- Quote → Finance approval → won deal → invoice; deletes; messaging; targets; currencies
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

do $$
declare
  L1 constant uuid := '11111111-0000-0000-0000-000000000001';
  deal uuid; q uuid; q2 uuid; inv uuid; n int; lead2 uuid; cl uuid; stage_won uuid; pm_before int;
begin
  -- fixtures were converted in the security test; make a fresh lead for the sales exec 'sales2' (x)
  insert into public.leads(id, full_name, company, owner_id, status) values
    ('11111111-0000-0000-0000-0000000000a2','Dina Ruiz','Sol Agency', t.uid('x'),'qualified') returning id into lead2;

  -- 1 ─ sales builds a deal in EUR and a quote
  perform t.as_user(t.uid('x'));
  insert into public.deals(title, lead_id, stage_id, value, currency, owner_id)
    values ('Sol rebrand site', lead2, (select id from public.pipeline_stages where position = 3), 0, 'EUR', t.uid('x')) returning id into deal;
  perform t.denied(format($s$insert into public.deals(title,lead_id,stage_id,value,currency,owner_id) values ('bad',%L,(select id from public.pipeline_stages where position=1),1,'ZZZ',%L)$s$, lead2, t.uid('x')),
                   '12. an unknown currency code is rejected');
  insert into public.quotes(deal_id, currency, customer_name, customer_company, project_title, project_description, tax_rate)
    values (deal, 'EUR', 'Dina Ruiz', 'Sol Agency', 'Website rebuild', 'Design + build of a 6-page marketing site', 0) returning id into q;
  insert into public.quote_items(quote_id, description, quantity, unit_price) values (q,'Design',1,2000),(q,'Development',2,1500);
  perform t.ok((select total = 5000 from public.quote_totals where quote_id = q), '1. quote total is computed from line items (EUR 5000)');
  perform t.denied(format($s$update public.quotes set status = 'approved' where id = %L$s$, q), '1. sales cannot approve their own quote');
  perform public.submit_quote(q);
  perform t.as_admin();
  perform t.ok((select status = 'submitted' from public.quotes where id = q), '1. quote submitted');
  perform t.ok((select value = 5000 and currency = 'EUR' from public.deals where id = deal), '1. deal value/currency follow the quote');
  perform t.ok((select s.name = 'Proposal sent' from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = deal), '1. deal moved to Proposal sent');
  perform t.ok((select count(*) from public.notifications where user_id = t.uid('f') and type = 'quote_submitted') = 1, '1. Finance is notified of the quote');

  -- 2 ─ who can see what
  perform t.as_user(t.uid('f'));
  perform t.ok((select count(*) from public.quotes where id = q) = 1, '2. Finance sees the submitted quote');
  perform t.ok((select count(*) from public.leads) = 0 and (select count(*) from public.deals) = 0, '2. ...but not the leads or deals behind it');
  perform t.as_user(t.uid('d'));
  perform t.ok((select count(*) from public.quotes) = 0, '2. developers cannot see quotes');
  perform t.as_user(t.uid('s'));
  perform t.ok((select count(*) from public.quotes where id = q) = 0, '2. another sales executive cannot see it');
  perform t.as_user(t.uid('c'));
  perform t.ok((select count(*) from public.quotes where id = q) = 1, '2. CSO sees all quotes');
  perform t.as_user(t.uid('x'));
  update public.quote_items set unit_price = 1 where quote_id = q;
  get diagnostics n = row_count;
  perform t.ok(n = 0, '3. a submitted quote cannot be edited (0 rows touched)');
  perform t.denied(format($s$select public.approve_quote(%L)$s$, q), '3. sales cannot approve');
  perform t.as_admin();

  -- 3 ─ Finance returns it, sales fixes and resubmits
  perform t.as_user(t.uid('f'));
  perform t.denied(format($s$select public.reject_quote(%L, '')$s$, q), '3. a reason is required to return a quote');
  perform public.reject_quote(q, 'Scope missing hosting costs');
  perform t.as_user(t.uid('x'));
  perform t.ok((select status = 'rejected' and rejection_reason like 'Scope%' from public.quotes where id = q), '3. sales sees the rejection reason');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.uid('x') and type = 'quote_rejected'), '3. sales is notified of the return');
  insert into public.quote_items(quote_id, description, quantity, unit_price) values (q,'Hosting (1 yr)',1,200);
  perform public.submit_quote(q);
  perform t.as_admin();
  perform t.ok((select total = 5200 from public.quote_totals where quote_id = q), '3. revised quote total EUR 5200');

  -- 4 ─ Finance approves with 50% upfront → invoice, client, won deal
  perform t.as_user(t.uid('f'));
  inv := public.approve_quote(q, 'percent', 50, current_date + 10, 'Start after upfront');
  perform t.as_admin();
  perform t.ok((select status = 'approved' and invoice_id = inv from public.quotes where id = q), '4. quote approved and linked to its invoice');
  perform t.ok((select total = 5200 and upfront_amount = 2600 and currency = 'EUR' and payment_state = 'unpaid' and amount_paid = 0
                from public.invoice_balances where invoice_id = inv), '4. invoice EUR 5200 issued, upfront EUR 2600, nothing received yet');
  perform t.ok((select s.is_won and d.won_confirmed_at is not null and d.won_confirmed_by = t.uid('f')
                from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = deal), '4. deal is Won, confirmed by Finance');
  perform t.ok((select client_id is not null from public.deals where id = deal), '4. customer became a client automatically');
  perform t.ok((select status = 'converted' from public.leads where id = lead2), '4. lead marked converted');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.uid('x') and type = 'quote_approved'), '4. sales owner is told the deal is won');
  perform t.ok(exists (select 1 from public.notifications where user_id = t.uid('p') and type = 'deal_won'), '4. Project Manager is told to set up the project');
  perform t.as_user(t.uid('x'));
  perform t.denied(format($s$update public.deals set stage_id = (select id from public.pipeline_stages where position = 1) where id = %L$s$, deal), '4. sales cannot drag a won deal back out of Won');
  perform t.ok((select count(*) from public.invoice_balances where invoice_id = inv) = 1, '4. the sales owner can see the invoice to give to the client');
  perform t.ok((select count(*) from public.invoice_items where invoice_id = inv) = 3, '4. ...and its line items');
  perform t.as_user(t.uid('s'));
  perform t.ok((select count(*) from public.invoice_balances) = 0, '4. other sales executives cannot see it');
  perform t.as_admin();

  -- 5 ─ payment is visible to the owner and counts correctly
  perform t.as_user(t.uid('f'));
  insert into public.payments(invoice_id, amount, method) values (inv, 2600, 'bank_transfer');
  perform t.as_user(t.uid('x'));
  perform t.ok((select upfront_received and amount_paid = 2600 and payment_state = 'partially_paid' from public.invoice_balances where invoice_id = inv), '5. owner sees upfront received, invoice partially paid');
  perform t.as_admin();

  -- 6 ─ the client backs out: Finance removes the invoice
  perform t.as_user(t.uid('f'));
  perform t.denied(format($s$select public.delete_invoice(%L)$s$, inv), '6. deleting an invoice with payments needs explicit confirmation');
  perform public.delete_invoice(inv, true);
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.invoices where id = inv) and not exists (select 1 from public.payments where invoice_id = inv), '6. invoice and its payments removed');
  perform t.ok((select not s.is_won and d.won_confirmed_at is null and s.name = 'Negotiation'
                from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = deal), '6. the deal is no longer Won: reopened in Negotiation');
  perform t.ok((select status = 'cancelled' from public.quotes where id = q), '6. the quote is cancelled');
  perform t.ok((select count(*) from public.audit_events where action = 'invoice.deleted') = 1, '6. the deletion is audited');

  -- 7 ─ the same client comes back: a new quote can be sent and won again
  perform t.as_user(t.uid('x'));
  insert into public.quotes(deal_id, currency, customer_name, project_title, project_description)
    values (deal, 'EUR', 'Dina Ruiz', 'Website rebuild v2', 'Second attempt') returning id into q2;
  insert into public.quote_items(quote_id, description, quantity, unit_price) values (q2,'Everything',1,4800);
  perform public.submit_quote(q2);
  perform t.as_user(t.uid('f'));
  perform t.denied(format($s$select public.approve_quote(%L,'fixed',9999)$s$, q2), '7. upfront above the total is rejected');
  inv := public.approve_quote(q2, 'none');
  perform t.as_admin();
  perform t.ok((select s.is_won from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.id = deal), '7. deal can be won again with a fresh quote');
  perform t.ok((select upfront_amount = 0 from public.invoices where id = inv), '7. Finance may decide that no upfront is needed');

  -- 8 ─ deletes
  perform t.as_user(t.uid('x'));
  perform t.denied(format($s$select public.delete_deal(%L)$s$, deal), '8. a deal with an invoice cannot be deleted by sales');
  perform t.as_user(t.uid('s'));
  perform t.denied(format($s$select public.delete_lead(%L)$s$, lead2), '8. another sales exec cannot delete someone else''s lead');
  perform t.denied($s$delete from public.leads$s$, '8. direct deletes are no longer possible');
  perform t.as_admin();
  insert into public.leads(id, full_name, owner_id) values ('11111111-0000-0000-0000-0000000000a3','Dead Lead', t.uid('s'));
  perform t.as_user(t.uid('s'));
  perform public.delete_lead('11111111-0000-0000-0000-0000000000a3');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.leads where id = '11111111-0000-0000-0000-0000000000a3'), '8. owner can delete their dead lead');
  perform t.as_user(t.uid('c'));
  select client_id into cl from public.deals where id = deal;
  perform t.denied(format($s$select public.delete_client(%L)$s$, cl), '8. a client with invoices cannot be deleted');
  perform t.as_user(t.uid('f'));
  perform public.delete_invoice(inv);
  perform t.as_user(t.uid('c'));
  perform public.delete_deal(deal);
  perform public.delete_client(cl);
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.clients where id = cl) and not exists (select 1 from public.deals where id = deal), '8. after Finance removes the invoice, CSO can delete the deal and client');

  -- 9 ─ messaging matrix
  perform t.as_user(t.uid('a')); perform public.send_message(t.uid('d'), 'Hello team');
  perform t.as_user(t.uid('d')); perform t.ok((select count(*) from public.messages) = 1, '9. super admin can message a developer');
  perform public.send_message(t.uid('a'), 'Thanks');
  perform t.ok(true, '9. a developer can reply to someone who messaged them');
  perform t.denied(format($s$select public.send_message(%L,'hi')$s$, t.uid('s')), '9. a developer cannot start a chat with sales');
  perform t.as_user(t.uid('s'));
  perform t.denied(format($s$select public.send_message(%L,'hi')$s$, t.uid('f')), '9. sales cannot message Finance');
  perform t.denied(format($s$select public.send_message(%L,'hi')$s$, t.uid('d')), '9. sales cannot message developers');
  perform public.send_message(t.uid('c'), 'Question on pricing');
  perform public.send_message(t.uid('p'), 'Handover ready');
  perform t.ok(true, '9. sales can message the CSO and Project Manager');
  perform t.as_user(t.uid('c'));
  perform public.send_message(t.uid('f'), 'Please review');
  perform t.denied(format($s$select public.send_message(%L,'hi')$s$, t.uid('d')), '9. CSO cannot message developers');
  perform t.as_user(t.uid('f'));
  perform t.denied(format($s$select public.send_message(%L,'hi')$s$, t.uid('s')), '9. Finance cannot message sales');
  perform public.send_message(t.uid('a'), 'Monthly close done');
  perform t.as_user(t.uid('p')); perform public.send_message(t.uid('d'), 'New task incoming');
  perform t.as_user(t.uid('e'));
  perform t.ok((select count(*) from public.messages) = 0, '9. messages are private to their two participants');
  perform t.as_user(t.uid('s'));
  perform t.ok((select count(*) from public.messages) = 2, '9. a user only reads their own conversations');
  update public.messages set read_at = now() where recipient_id = t.uid('s');
  perform t.denied(format($s$update public.messages set body = 'edited' where sender_id = %L$s$, t.uid('s')), '9. message text cannot be edited');
  perform t.as_admin();

  -- 10 ─ targets and rates
  perform t.as_user(t.uid('c'));
  insert into public.sales_targets(user_id, month, target_usd, target_pkr) values (t.uid('s'), date_trunc('month', current_date)::date, 20000, 5600000);
  perform t.denied(format($s$insert into public.sales_targets(user_id, month, target_usd) values (%L, date_trunc('month', current_date)::date, 1)$s$, t.uid('d')), '10. targets can only go to Sales Executives');
  perform t.denied($s$insert into public.sales_targets(user_id, month, target_usd) values (t.uid('s'), '2026-10-15', 1)$s$, '10. targets are keyed to the first day of a month');
  insert into public.exchange_rates(month, currency, usd_per_unit, pkr_per_unit) values (date_trunc('month', current_date)::date, 'EUR', 1.08, 301.5);
  perform t.as_user(t.uid('s'));
  perform t.ok((select count(*) from public.sales_targets) = 1, '10. a sales executive sees their own target');
  perform t.as_user(t.uid('x'));
  perform t.ok((select count(*) from public.sales_targets) = 0, '10. ...and not a colleague''s');
  perform t.ok((select count(*) from public.exchange_rates) = 1, '10. everyone can read exchange rates (to see their own progress)');
  perform t.denied($s$insert into public.exchange_rates(month, currency, usd_per_unit, pkr_per_unit) values ('2026-10-01','GBP',1.3,360)$s$, '10. only Super Admin/CSO can enter rates');
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise;
end $$;
