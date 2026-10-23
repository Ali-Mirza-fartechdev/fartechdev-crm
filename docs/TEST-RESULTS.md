# Test results

Generated 2026-10-23 00:19 UTC. Database tests ran on PostgreSQL 16 (plain Postgres + a stub of Supabase's `auth` schema), Node v22.22.2.

**What this does and does not prove:** the SQL (schema, RLS, rules, reminder engine) is verified. pg_cron, Supabase Auth, Realtime, the Edge Function and a real browser were NOT available here and are NOT verified; see docs/SETUP.md §8 for the checks to run on your project.

## Database: 83 checks passed, 0 failed

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
```

## Frontend unit tests
```
 ✓ src/lib/time.test.ts (5 tests) 42ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Static checks
```
tsc: 0 errors
✓ built in 7.88s
Isolation check passed: no Supabase URLs, keys, connection strings or legacy-project references found.
```
