# Reference audit of the previous CRM (`far-tech-crm-main.zip`)

Inspected as static files only. Its backend was never contacted and nothing was copied from it.

## What it is
A single-file React app (`src/App.jsx`, 1,465 lines) on Supabase with three tables: `leads`, `activities`, `employees`. Deployed on Netlify.

## Workflows worth carrying over
- **Lead pipeline** with stages: Conversation Started → Qualified → Pain Identified → Call Booked → Discovery Call Done → Proposal Sent → Negotiation, plus Closed Won/Lost and No Response. → new `pipeline_stages` (configurable) + `lead_status`.
- **Outreach cadence for "No Response" leads:** follow-up 1/2/3/4 at day 3, 7, 13, 17. → *Not implemented yet.* Natural Phase E feature: auto-create these as real follow-ups when a lead enters `no_response`.
- **Lead attributes:** industry buckets (Agency, Real Estate, School, E-commerce, SaaS, Others), source, owner, notes, activity log. → kept as `industry`, `source`, `owner_id`, `notes`, `activities`.
- **Roles:** "Sales Representative" and "Admin" only. → expanded to the 7 requested roles.
- Realtime refresh of the lead list; dashboard of lead counts by stage and rep.

## Problems NOT to repeat
| Finding in old app | New design |
|---|---|
| Passwords stored in plain text in `employees.password`; login is a client-side query comparing them | Supabase Auth (hashed), username→identity mapping, no passwords in app tables |
| Anon key and project URL hard-coded in source | `.env` only; isolation script fails the repo if any URL/key appears |
| Authorisation done in the browser (role checks in React) | RLS + column grants + triggers in Postgres; UI only hides controls |
| Follow-up "due" computed in the browser from day counts; no stored due time, no scheduler, no notification | `follow_ups.due_at` (UTC), persistent reminder queue, server-side processor |
| 1,465-line monolith | feature modules, shared UI kit, design tokens |
| No tests | 83 SQL checks + unit tests |
| Admin can read every user's password | Admin can only *reset*; temporary password shown once, forced change at first sign-in |

## Missing in the old app (now in scope)
Clients, deals/pipeline value, projects, tasks, finance, notifications, reports, audit log, appearance modes, mobile layouts.
