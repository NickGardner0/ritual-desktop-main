-- PERFORMANCE MONITORING SCRIPT FOR RITUAL APP
-- Run this to check if the performance fixes are working

-- =====================================================
-- 1. CHECK RLS POLICIES (Should show optimized policies only)
-- =====================================================

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('profiles', 'habits', 'habit_logs')
ORDER BY tablename, policyname;

-- =====================================================
-- 2. CHECK FOR DUPLICATE POLICIES (Should be empty)
-- =====================================================

SELECT 
  tablename,
  cmd,
  array_agg(policyname) as duplicate_policies,
  count(*) as policy_count
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('profiles', 'habits', 'habit_logs')
GROUP BY tablename, cmd, roles
HAVING count(*) > 1;

-- =====================================================
-- 3. CHECK INDEXES (Should show our new optimized indexes)
-- =====================================================

SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename IN ('profiles', 'habits', 'habit_logs')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- =====================================================
-- 4. CHECK TABLE STATISTICS (Should show recent analysis)
-- =====================================================

SELECT 
  schemaname,
  tablename,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables 
WHERE schemaname = 'public' 
  AND relname IN ('profiles', 'habits', 'habit_logs');

-- =====================================================
-- 5. PERFORMANCE TEST QUERIES
-- =====================================================

-- Test RLS performance with EXPLAIN ANALYZE
-- (Replace 'your-user-id' with actual user ID for testing)

-- EXPLAIN ANALYZE 
-- SELECT * FROM habits WHERE user_id = 'your-user-id';

-- EXPLAIN ANALYZE 
-- SELECT * FROM habit_logs WHERE user_id = 'your-user-id' AND date >= CURRENT_DATE - INTERVAL '7 days';

-- =====================================================
-- 6. SUCCESS CONFIRMATION
-- =====================================================

SELECT 
  'PERFORMANCE MONITORING COMPLETE' as status,
  'Check results above for:' as instructions,
  '1. Only optimized RLS policies should exist' as check1,
  '2. No duplicate policies should be found' as check2,
  '3. New indexes should be present' as check3,
  '4. Tables should show recent analysis' as check4;
