# FAR Tech & Developers CRM (new, independent)

React + Vite + TypeScript on a **new** Supabase project. No code, data, credentials or backend from the previous CRM.

```bash
npm install && cp .env.example .env.local   # then follow docs/SETUP.md
npm run dev | build | typecheck | test | test:db | verify:isolation
```

## Status (honest)
| Area | State |
|---|---|
| Database (schema, RLS, grants, rules, audit, finance, quotes, multi-currency, targets, messaging, deletes) | ✅ **145 SQL checks pass** (docs/TEST-RESULTS.md), including upgrade of a populated database |
| Follow-up reminder engine | ✅ verified in SQL with a controlled clock. ⚠️ pg_cron + "browser closed" delivery verified only on your project (docs/SETUP.md §6/§8) |
| UI: dashboard, leads, clients, **Kanban + list pipeline with lead analytics**, quotes, **Finance approval**, invoices/payments, projects, tasks, **analytics & reports**, **targets & rates**, **messages**, follow-ups, notifications, team, settings | ✅ typechecks, builds, logic unit-tested. ⚠️ **not yet viewed in a browser by me**; please review layouts on desktop and phone |
| Auth/admin Edge Function | ✅ written. ⚠️ must be deployed with "Verify JWT" off (docs/SETUP.md §4) |
| **Video meetings** (LiveKit): scheduled + instant, 1-to-1 + group | ✅ database rules + token authorisation tested in SQL; ⚠️ live video untested (needs your LiveKit keys and real browsers), see docs/MEETINGS.md |
| Email / push / SMS / WhatsApp | ❌ not built; in-app only |

Docs: `docs/MEETINGS.md` · `docs/WORKFLOW.md` · `docs/AUDIT.md` · `docs/ARCHITECTURE.md` · `docs/SETUP.md` · `docs/TEST-RESULTS.md`
