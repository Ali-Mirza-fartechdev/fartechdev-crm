# Setup: new Supabase project, end to end

You must do §1 yourself (I cannot create Supabase projects). Everything else is scripted. **Use a brand-new project. Never point this app at the old CRM's project.**

## 1. Create the new Supabase project (≈3 min, you)
1. https://supabase.com/dashboard → **New project**. Name it e.g. `far-tech-crm-new`. Pick a region close to Karachi/your users. Save the database password in a password manager.
2. **Project Settings → API** → copy: **Project URL** and the **anon public** key. (The **service_role** key stays secret; you will only paste it into your own terminal in §5.)
3. **Authentication → Sign In / Providers**: turn **off** “Allow new users to sign up”. Leave the Email provider enabled (usernames are mapped onto it). No emails are ever sent by this app.
4. **Database → Extensions**: enable **pg_cron**.

**Send me / put in `.env.local`:** Project URL, anon key, and the auth email domain (§2). Do **not** send the service_role key or DB password.

## 2. Choose the username domain
Usernames map to Supabase identities as `username@<AUTH_EMAIL_DOMAIN>`. Use a domain you own (e.g. `crm.fartech.com`). Nothing is emailed to it. Use the **same** value in the frontend (`VITE_AUTH_EMAIL_DOMAIN`), the Edge Function secret and the bootstrap script.

## 3. Apply the migrations
Either (CLI, recommended):
```bash
npm i -g supabase            # or: npx supabase
supabase login
supabase link --project-ref <NEW-project-ref>
supabase db push
```
or paste `supabase/migrations/*.sql` into **SQL Editor** in filename order. Confirm the NOTICE from 0005 does **not** say pg_cron is unavailable; if it does, run `supabase/scripts/schedule_reminders.sql` once.

## 3b. Updates
Later database updates ship as separate files (e.g. `supabase/migrations/…0006…sql`): paste into SQL Editor and run once, in order.

## 4. Deploy the admin Edge Function
> **Dashboard route:** Edge Functions → *admin-users* → Details → turn **OFF** “Verify JWT with legacy secret”. Newer projects sign sessions with asymmetric keys, which the legacy gateway check rejects (401). The function verifies the caller itself and requires an active Super Admin.
```bash
supabase secrets set AUTH_EMAIL_DOMAIN=crm.fartech.com ALLOWED_ORIGINS=https://<your-site>,http://localhost:5173
supabase functions deploy admin-users
```
(`SUPABASE_URL` and the service-role key are injected by Supabase automatically.)

## 5. Create the first Super Admin (one time)
```bash
npm install
SUPABASE_URL=https://<NEW-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
AUTH_EMAIL_DOMAIN=crm.fartech.com \
node scripts/bootstrap-super-admin.mjs
```
You type the password at a hidden prompt. It refuses to run if a Super Admin already exists. Afterwards create every other user from **Team → Add user**; temporary passwords are shown once and must be changed at first sign-in. Forgotten passwords: Super Admin → Team → Reset password.

## 6. Verify the scheduler is really running
```sql
select jobname, schedule, active from cron.job where jobname = 'far-process-follow-up-reminders';   -- 1 row, active
select * from public.scheduler_runs order by id desc limit 5;                                      -- new row every minute
select status, return_message from cron.job_run_details order by start_time desc limit 5;          -- 'succeeded'
```
Do **not** treat reminders as working until a new `scheduler_runs` row appears each minute.

## 7. Run / deploy the app
```bash
cp .env.example .env.local     # fill the 3 values
npm run dev                    # http://localhost:5173
npm run build                  # dist/ → Netlify/Vercel/any static host (SPA fallback to index.html)
```
Hosting env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_EMAIL_DOMAIN` only.

## 8. Acceptance checklist on your project (things I could not run)
| # | Check | How |
|---|---|---|
| 1 | Reminder fires with the browser closed | Schedule a follow-up 3 min ahead with “at the time”, close all tabs, wait, reopen → notification exists with the right timestamp |
| 2 | Scheduler liveness | §6 queries |
| 3 | Edge Function auth | As a non-admin, call `admin-users` → 403 |
| 4 | Sign-up disabled | `POST /auth/v1/signup` with the anon key → rejected |
| 5 | Realtime toast | Keep tab open, schedule a due-now follow-up → toast + bell badge without refresh |
| 6 | Mobile | Test at 320/375/768/1024/1440 px (I could not render a browser) |
| 7 | Username domain accepted by Auth | Bootstrap script succeeds (if Auth rejects the domain, use another domain you own) |
