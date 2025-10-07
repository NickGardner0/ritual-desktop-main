-- ============================================
-- Whoop Auto-Sync Cron Job Setup
-- ============================================
-- 
-- This sets up automatic daily syncing of Whoop data
-- for all connected users at 6:00 AM UTC
--
-- BEFORE RUNNING THIS:
-- 1. Go to Supabase Dashboard → Project Settings → Edge Functions
-- 2. Add these secrets:
--    - WHOOP_CLIENT_ID: b124c08c-ebb4-4d1b-9be7-0dc788a8f38e
--    - WHOOP_CLIENT_SECRET: 3e97e3d62d9fccd3195f9b1838520ff81f6cf3745673084f6bb6d4d6d8d83ba1
--
-- 3. Get your ANON KEY from Project Settings → API
-- 4. Replace YOUR_ANON_KEY below with your actual anon key
-- ============================================

-- Step 1: Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 2: Enable pg_net extension (for HTTP requests)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 3: Schedule the daily Whoop sync at 6:00 AM UTC
-- Replace YOUR_ANON_KEY with your actual anon key from Supabase dashboard
SELECT cron.schedule(
  'whoop-daily-sync',
  '0 6 * * *',  -- Run every day at 6:00 AM UTC
  $$
  SELECT net.http_post(
    url:='https://bvwgycgdmrozxfmyxpuy.supabase.co/functions/v1/whoop-auto-sync',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2d2d5Y2dkbXJvenhmbXl4cHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzczNDEwMDIsImV4cCI6MjA1MjkxNzAwMn0.ENcTaG68l8hZS8jW8nne8gqQuSqtdknJ5gck-Pg5PCg"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);

-- Step 4: Verify the cron job was created
SELECT 
  jobid,
  schedule,
  command,
  active
FROM cron.job
WHERE jobname = 'whoop-daily-sync';

-- ============================================
-- OPTIONAL: View cron job history
-- ============================================
-- Run this query anytime to see when the sync ran:
-- 
-- SELECT 
--   jobid,
--   runid,
--   job_pid,
--   database,
--   username,
--   command,
--   status,
--   return_message,
--   start_time,
--   end_time
-- FROM cron.job_run_details
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'whoop-daily-sync')
-- ORDER BY start_time DESC
-- LIMIT 10;

-- ============================================
-- OPTIONAL: Unschedule the job (if needed)
-- ============================================
-- SELECT cron.unschedule('whoop-daily-sync');

-- ============================================
-- OPTIONAL: Change the schedule
-- ============================================
-- Every 6 hours:
-- SELECT cron.schedule('whoop-daily-sync', '0 */6 * * *', $$...$$);
--
-- Twice daily (6 AM and 6 PM):
-- SELECT cron.schedule('whoop-daily-sync', '0 6,18 * * *', $$...$$);
--
-- Every morning at 9 AM:
-- SELECT cron.schedule('whoop-daily-sync', '0 9 * * *', $$...$$);

