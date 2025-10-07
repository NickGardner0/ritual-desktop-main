-- CRITICAL PERFORMANCE FIX FOR RITUAL APP
-- This fixes the RLS performance issues and removes duplicate policies
-- Run this in your Supabase SQL Editor immediately

-- =====================================================
-- 1. FIX RLS PERFORMANCE ISSUES
-- =====================================================

-- Drop ALL existing policies to start clean
DROP POLICY IF EXISTS "Users can read their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON profiles;

-- Drop ALL habit_logs policies (this is where the major issues are)
DROP POLICY IF EXISTS "Users can manage their habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can insert their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can view their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can update their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can delete their own habit logs" ON habit_logs;

-- Drop ALL habits policies
DROP POLICY IF EXISTS "Users can manage their own habits" ON habits;
DROP POLICY IF EXISTS "Users can view their own habits" ON habits;
DROP POLICY IF EXISTS "Users can insert their own habits" ON habits;
DROP POLICY IF EXISTS "Users can update their own habits" ON habits;
DROP POLICY IF EXISTS "Users can delete their own habits" ON habits;
DROP POLICY IF EXISTS "habits_select_policy" ON habits;
DROP POLICY IF EXISTS "habits_insert_policy" ON habits;
DROP POLICY IF EXISTS "habits_update_policy" ON habits;
DROP POLICY IF EXISTS "habits_delete_policy" ON habits;

-- =====================================================
-- 2. CREATE OPTIMIZED RLS POLICIES (SINGLE POLICIES ONLY)
-- =====================================================

-- PROFILES TABLE - Optimized policies using (select auth.uid())
CREATE POLICY "profiles_optimized_select" ON profiles
  FOR SELECT USING ((select auth.uid()) = id);

CREATE POLICY "profiles_optimized_insert" ON profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "profiles_optimized_update" ON profiles
  FOR UPDATE USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- HABITS TABLE - Optimized policies using (select auth.uid())
CREATE POLICY "habits_optimized_select" ON habits
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "habits_optimized_insert" ON habits
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habits_optimized_update" ON habits
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habits_optimized_delete" ON habits
  FOR DELETE USING ((select auth.uid()) = user_id);

-- HABIT_LOGS TABLE - Optimized policies using (select auth.uid())
-- This is the most critical fix - was causing 24 requests for 1 log!
CREATE POLICY "habit_logs_optimized_select" ON habit_logs
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "habit_logs_optimized_insert" ON habit_logs
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habit_logs_optimized_update" ON habit_logs
  FOR UPDATE USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "habit_logs_optimized_delete" ON habit_logs
  FOR DELETE USING ((select auth.uid()) = user_id);

-- =====================================================
-- 3. ADD CRITICAL PERFORMANCE INDEXES
-- =====================================================

-- Indexes for auth.uid() lookups (critical for RLS performance)
CREATE INDEX IF NOT EXISTS idx_profiles_id_auth ON profiles(id) WHERE id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_habits_user_id_auth ON habits(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_id_auth ON habit_logs(user_id) WHERE user_id IS NOT NULL;

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_habits_user_created ON habits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date ON habit_logs(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date ON habit_logs(habit_id, date DESC);

-- =====================================================
-- 4. ANALYZE TABLES FOR QUERY PLANNER
-- =====================================================

ANALYZE profiles;
ANALYZE habits;
ANALYZE habit_logs;

-- =====================================================
-- 5. SUCCESS CONFIRMATION
-- =====================================================

SELECT 
  'PERFORMANCE ISSUES FIXED!' as status,
  'RLS policies optimized with (select auth.uid())' as rls_fix,
  'Duplicate policies removed' as duplicates_fix,
  'Critical indexes added' as indexes_fix,
  'Tables analyzed for query planner' as analyze_fix;
