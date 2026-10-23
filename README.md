# FAR Tech & Developers CRM (new, independent)

React + Vite + TypeScript on a **new** Supabase project. No code, data, credentials or backend from the previous CRM.

```bash
npm install && cp .env.example .env.local   # then follow docs/SETUP.md
npm run dev | build | typecheck | test | test:db | verify:isolation
```

## Status (honest)
| Area | State |
|---|---|
| Database: schema, RLS, grants, rules, audit, finance guards | ✅ built, **83 SQL checks pass** (docs/TEST-RESULTS.md) |
| Follow-up reminder engine (queue, dedupe, reschedule, completion, downtime catch-up, tz) | ✅ built and verified in SQL with a controlled clock. ⚠️ **pg_cron scheduling and "browser closed" delivery are unverified until you run docs/SETUP.md §6/§8** |
| Auth: username login, no signup, admin-created users, resets, bootstrap script | ✅ written; ⚠️ Edge Function + Auth not run (no Supabase project here) |
| UI: shell, light/dark/system, glass design system, responsive tables→cards, login, dashboard, follow-ups, notification centre + bell, leads, clients, lead/client detail, team, settings | ✅ typechecks & builds; ⚠️ **not yet viewed in a browser** and **not yet aligned to your Figma/Stitch screens** |
| Deals/pipeline, Projects, Tasks, Finance, Reports screens | ⏳ Not built (shown as "Soon"). Their tables, RLS and rules exist and are tested |
| Email/push/SMS/WhatsApp | ❌ Not built; no provider configured |

Docs: `docs/AUDIT.md` · `docs/ARCHITECTURE.md` · `docs/SETUP.md` · `docs/TEST-RESULTS.md`
