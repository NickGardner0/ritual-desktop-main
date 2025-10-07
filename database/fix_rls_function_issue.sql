-- FIX RLS FUNCTION ISSUE
-- The ultra-optimized policies might be referencing a function that doesn't exist

-- =====================================================
-- 1. CHECK IF THE FUNCTION EXISTS
-- =====================================================

SELECT 
  proname,
  pronamespace::regnamespace as schema,
  prosrc
FROM pg_proc 
WHERE proname = 'current_user_id';

-- =====================================================
-- 2. CREATE THE FUNCTION IF IT DOESN'T EXIST
-- =====================================================

-- Create the security definer function
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT auth.uid();
$$;

-- =====================================================
-- 3. FALLBACK: REVERT TO SIMPLE RLS POLICIES IF NEEDED
-- =====================================================

-- If the function approach isn't working, revert to simple policies
-- Drop the ultra-optimized policies
DROP POLICY IF EXISTS "habit_logs_ultra_optimized_select" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_ultra_optimized_insert" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_ultra_optimized_update" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_ultra_optimized_delete" ON habit_logs;

-- Create simple, working policies
CREATE POLICY "habit_logs_simple_select" ON habit_logs
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "habit_logs_simple_insert" ON habit_logs
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habit_logs_simple_update" ON habit_logs
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habit_logs_simple_delete" ON habit_logs
  FOR DELETE USING ((select auth.uid()) = user_id);

-- Do the same for habits table
DROP POLICY IF EXISTS "habits_ultra_optimized_select" ON habits;
DROP POLICY IF EXISTS "habits_ultra_optimized_insert" ON habits;
DROP POLICY IF EXISTS "habits_ultra_optimized_update" ON habits;
DROP POLICY IF EXISTS "habits_ultra_optimized_delete" ON habits;

CREATE POLICY "habits_simple_select" ON habits
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "habits_simple_insert" ON habits
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habits_simple_update" ON habits
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habits_simple_delete" ON habits
  FOR DELETE USING ((select auth.uid()) = user_id);

-- =====================================================
-- 4. VERIFY POLICIES ARE ACTIVE
-- =====================================================

SELECT 
  tablename,
  policyname,
  permissive,
  cmd,
  qual
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('habits', 'habit_logs')
ORDER BY tablename, policyname;

-- =====================================================
-- 5. SUCCESS CONFIRMATION
-- =====================================================

SELECT 
  'RLS POLICIES FIXED!' as status,
  'Simple policies created that should work' as fix1,
  'Function created for future optimization' as fix2,
  'Try logging a habit now' as next_step;
