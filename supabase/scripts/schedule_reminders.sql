-- Run once in the Supabase SQL editor AFTER enabling pg_cron (Dashboard → Database → Extensions).
-- Idempotent. The job runs inside Postgres every minute, whether or not any browser is open.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'far-process-follow-up-reminders';
select cron.schedule('far-process-follow-up-reminders', '* * * * *', 'select app.process_due_reminders()');

-- Verify (expect one row, active = true):
--   select jobid, jobname, schedule, active from cron.job where jobname = 'far-process-follow-up-reminders';
-- Watch it work (a new scheduler_runs row appears every minute):
--   select * from public.scheduler_runs order by id desc limit 5;
-- Check for failures:
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
