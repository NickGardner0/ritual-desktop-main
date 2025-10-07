-- DEBUG HABIT LOGGING ISSUES
-- Run this to diagnose why habit logs aren't appearing

-- =====================================================
-- 1. CHECK IF RLS POLICIES ARE WORKING
-- =====================================================

-- Check current RLS policies on habit_logs
SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'habit_logs'
ORDER BY policyname;

-- =====================================================
-- 2. CHECK RECENT HABIT LOGS (LAST 24 HOURS)
-- =====================================================

-- Check all recent logs (this uses service role, bypasses RLS)
SELECT 
  id,
  habit_id,
  user_id,
  date,
  time,
  duration,
  amount,
  unit,
  notes,
  created_at
FROM habit_logs 
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;

-- =====================================================
-- 3. CHECK HABITS TABLE
-- =====================================================

-- Check if "Deep Work Sessions" habit exists
SELECT 
  id,
  name,
  user_id,
  category,
  unit_type,
  created_at
FROM habits 
WHERE name ILIKE '%deep%work%' 
   OR name ILIKE '%deep work sessions%'
ORDER BY created_at DESC;

-- =====================================================
-- 4. TEST RLS POLICY MANUALLY
-- =====================================================

-- Test if RLS is blocking inserts (replace with your actual user_id)
-- SELECT auth.uid(); -- This will show current user ID

-- Test insert with a sample log (replace user_id with your actual ID)
-- INSERT INTO habit_logs (
--   habit_id, 
--   user_id, 
--   date, 
--   time, 
--   duration, 
--   unit, 
--   status, 
--   notes
-- ) VALUES (
--   'd5148e6b-7f6e-4522-a70b-ac86b...', -- Replace with actual habit ID
--   '05cbe689-f7ec-487b-adb6-ad50...', -- Replace with your user ID
--   CURRENT_DATE,
--   NOW(),
--   7200, -- 2 hours in seconds
--   'Minutes',
--   'completed',
--   'Test log from SQL'
-- );

-- =====================================================
-- 5. CHECK FOR ERRORS IN LOGS
-- =====================================================

-- Check if there are any constraint violations or errors
SELECT 
  constraint_name,
  table_name,
  constraint_type
FROM information_schema.table_constraints 
WHERE table_name = 'habit_logs' 
  AND table_schema = 'public';

-- =====================================================
-- 6. SUMMARY
-- =====================================================

SELECT 
  'DEBUGGING COMPLETE' as status,
  'Check results above for:' as instructions,
  '1. RLS policies should exist and be active' as check1,
  '2. Recent logs should show your entries' as check2,
  '3. Deep Work Sessions habit should exist' as check3,
  '4. No constraint violations should be present' as check4;
