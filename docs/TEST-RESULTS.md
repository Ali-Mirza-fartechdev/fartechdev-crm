# Test results

Generated 2026-10-25 20:43 UTC. Database tests: PostgreSQL 16 (plain Postgres + stub of Supabase auth), Node v22.22.2.

**Verified:** SQL schema, RLS, rules, reminder engine, quote→Finance→won workflow, deletes, messaging matrix, targets/rates permissions, upgrade of a populated DB, currency/target math. **Not verified here:** pg_cron, Supabase Auth/Realtime, the Edge Function, and rendering in a real browser.

## Database: 145 checks passed, 0 failed
```
PASS: 1. follow-up persists with exact UTC instant (Asia/Karachi input)
PASS: 10. same local-time input in 3 time zones resolves to ONE identical UTC instant
PASS: 10. display conversion back to Karachi is correct
PASS: 2. reminder policy {60,15,0} persisted as 3 reminders + 1 overdue occurrence
PASS: 2. nothing fires before its time
PASS: 2. the 1-hour reminder fires when due
PASS: 8. notification is addressed to the assigned user
PASS: 7. repeated scheduler runs create no duplicate notifications
PASS: 7. database unique index rejects a duplicate occurrence (concurrency-safe)
PASS: 2. 15-minute and due-now reminders each fired once (3 total)
PASS: 2. due-now text names the follow-up and the related lead
PASS: 4. not overdue before its time
PASS: 6. a no-change update does not reschedule
PASS: 4. overdue notification generated after the grace period
PASS: 5. completing cancels every pending reminder
PASS: 5. cancelled occurrences are preserved as history
PASS: 5. a completed follow-up never notifies
PASS: 5. completion time and actor recorded
PASS: 6. reschedule bumps schedule_version
PASS: 6. old schedule has no pending occurrences
PASS: 6. new schedule created (due-now + overdue)
PASS: 6. stale reminder for the OLD time never fires
PASS: 6. reminder fires at the NEW time
PASS: 12. after 3 days of downtime all 3 eligible reminders (5-min, due, overdue) are still delivered
PASS: 12. catch-up lag is recorded in scheduler_runs
PASS: 2. "15 min before" on a follow-up 10 min away is skipped, not fired late
PASS: 4. pending + past due_at = overdue
PASS: 4. completed follow-up is no longer overdue
PASS: 2. cannot schedule a follow-up in the past [blocked: Follow-up time is in the past]
PASS: 8. delegated follow-up notifies the assignee
PASS: 8. ...and not the person who created it
PASS: 8. assignee is also told about the assignment
PASS: 8. other sales exec cannot see the follow-up
PASS: 8. other users cannot read someone else's notifications
PASS: 8. other sales exec cannot complete it [blocked: Follow-up not found or not permitted]
PASS: 8. cannot schedule a follow-up on a lead you do not own [blocked: Record not found or not permitted]
PASS: 8. cannot mark another user's notification read (0 rows touched)
PASS: 9. read status persists in the database
PASS: 9. mark-all-read clears the unread count
PASS: anon cannot read leads [blocked: permission denied for table leads]
PASS: anon cannot read profiles [blocked: permission denied for table profiles]
PASS: sales exec sees only own leads
PASS: CSO sees all leads
PASS: developer sees no leads
PASS: project manager sees no leads
PASS: finance sees no leads
PASS: cannot promote yourself [blocked: permission denied for table profiles]
PASS: cannot change your own active flag [blocked: permission denied for table profiles]
PASS: cannot edit another user's profile (RLS filters it to 0 rows)
PASS: cannot forge notifications [blocked: permission denied for table notifications]
PASS: cannot write audit events [blocked: permission denied for table audit_events]
PASS: cannot create a lead owned by someone else [blocked: new row violates row-level security policy for table "leads"]
PASS: created_by cannot be supplied by the browser at all [blocked: permission denied for table leads]
PASS: created_by is stamped server-side with the real user
PASS: follow-ups cannot be inserted directly [blocked: permission denied for table follow_ups]
PASS: follow-up time cannot be changed outside the RPC [blocked: permission denied for table follow_ups]
PASS: audit log returns no rows to a sales executive
PASS: lead converts to a client owned by the same user
PASS: converted lead status updated
PASS: other user cannot convert someone else's lead [blocked: Not permitted to convert this lead]
PASS: sales cannot move a deal to Won directly [blocked: A deal becomes Won only when Finance approves its quote]
PASS: deal stage changes are recorded
PASS: closing a deal stamps closed_at
PASS: only developers/team leads can be project members [blocked: Only active Developers or Team Leads can be project members]
PASS: PM cannot assign to someone outside the project [blocked: Assignee must be the project Team Lead or an assigned member]
PASS: team lead delegates to a project developer
PASS: team lead cannot assign to a developer outside the project [blocked: Team Leads can only assign to Developers on this project]
PASS: developer sees their assigned task
PASS: developer can update status of own task
PASS: developer cannot edit task title [blocked: Developers can only change the status of their tasks]
PASS: developer cannot reassign [blocked: Developers can only change the status of their tasks]
PASS: developer cannot create tasks [blocked: Developers cannot create tasks]
PASS: unassigned developer sees no tasks or projects
PASS: assignee receives a task-assigned notification
PASS: cannot take payment against a draft invoice [blocked: Payments can only be recorded against sent invoices]
PASS: issuing an invoice records ZERO received money
PASS: partial payment tracked
PASS: overpayment rejected [blocked: Payment exceeds the outstanding balance (1500.00 due)]
PASS: line items freeze once sent [blocked: Line items can only be changed while the invoice is a draft]
PASS: fully paid invoice settles to paid
PASS: sales cannot read invoices or payments
PASS: developer cannot read invoice balances
PASS: payments are audited
PASS: super admin can read the audit log
PASS: 12. an unknown currency code is rejected [blocked: insert or update on table "deals" violates foreign key constraint "dea]
PASS: 1. quote total is computed from line items (EUR 5000)
PASS: 1. sales cannot approve their own quote [blocked: permission denied for table quotes]
PASS: 1. quote submitted
PASS: 1. deal value/currency follow the quote
PASS: 1. deal moved to Proposal sent
PASS: 1. Finance is notified of the quote
PASS: 2. Finance sees the submitted quote
PASS: 2. ...but not the leads or deals behind it
PASS: 2. developers cannot see quotes
PASS: 2. another sales executive cannot see it
PASS: 2. CSO sees all quotes
PASS: 3. a submitted quote cannot be edited (0 rows touched)
PASS: 3. sales cannot approve [blocked: Not permitted]
PASS: 3. a reason is required to return a quote [blocked: Give the sales owner a reason]
PASS: 3. sales sees the rejection reason
PASS: 3. sales is notified of the return
PASS: 3. revised quote total EUR 5200
PASS: 4. quote approved and linked to its invoice
PASS: 4. invoice EUR 5200 issued, upfront EUR 2600, nothing received yet
PASS: 4. deal is Won, confirmed by Finance
PASS: 4. customer became a client automatically
PASS: 4. lead marked converted
PASS: 4. sales owner is told the deal is won
PASS: 4. Project Manager is told to set up the project
PASS: 4. sales cannot drag a won deal back out of Won [blocked: A won deal can only be reopened by removing its invoice]
PASS: 4. the sales owner can see the invoice to give to the client
PASS: 4. ...and its line items
PASS: 4. other sales executives cannot see it
PASS: 5. owner sees upfront received, invoice partially paid
PASS: 6. deleting an invoice with payments needs explicit confirmation [blocked: This invoice has 1 recorded payment(s). Confirm that they should be de]
PASS: 6. invoice and its payments removed
PASS: 6. the deal is no longer Won: reopened in Negotiation
PASS: 6. the quote is cancelled
PASS: 6. the deletion is audited
PASS: 7. upfront above the total is rejected [blocked: Upfront amount must be more than 0 and not above the total]
PASS: 7. deal can be won again with a fresh quote
PASS: 7. Finance may decide that no upfront is needed
PASS: 8. a deal with an invoice cannot be deleted by sales [blocked: This deal has an invoice. Ask Finance to delete the invoice first]
PASS: 8. another sales exec cannot delete someone else's lead [blocked: Lead not found or not permitted]
PASS: 8. direct deletes are no longer possible [blocked: permission denied for table leads]
PASS: 8. owner can delete their dead lead
PASS: 8. a client with invoices cannot be deleted [blocked: This client has invoices. Ask Finance to delete them first]
PASS: 8. after Finance removes the invoice, CSO can delete the deal and client
PASS: 9. super admin can message a developer
PASS: 9. a developer can reply to someone who messaged them
PASS: 9. a developer cannot start a chat with sales [blocked: You are not allowed to message this person]
PASS: 9. sales cannot message Finance [blocked: You are not allowed to message this person]
PASS: 9. sales cannot message developers [blocked: You are not allowed to message this person]
PASS: 9. sales can message the CSO and Project Manager
PASS: 9. CSO cannot message developers [blocked: You are not allowed to message this person]
PASS: 9. Finance cannot message sales [blocked: You are not allowed to message this person]
PASS: 9. messages are private to their two participants
PASS: 9. a user only reads their own conversations
PASS: 9. message text cannot be edited [blocked: permission denied for table messages]
PASS: 10. targets can only go to Sales Executives [blocked: Targets can only be assigned to active Sales Executives]
PASS: 10. targets are keyed to the first day of a month [blocked: new row for relation "sales_targets" violates check constraint "sales_]
PASS: 10. a sales executive sees their own target
PASS: 10. ...and not a colleague's
PASS: 10. everyone can read exchange rates (to see their own progress)
PASS: 10. only Super Admin/CSO can enter rates [blocked: new row violates row-level security policy for table "exchange_rates"]
```

## Frontend
```
 ✓ src/lib/money.test.ts (10 tests) 18ms
 ✓ src/lib/time.test.ts (5 tests) 16ms
 Test Files  2 passed (2)
      Tests  15 passed (15)
tsc: 0 errors
Isolation check passed: no Supabase URLs, keys, connection strings or legacy-project references found.
```
