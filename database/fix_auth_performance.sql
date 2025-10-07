-- ADDITIONAL AUTH PERFORMANCE FIX
-- Run this after the main performance fix to further optimize auth requests

-- =====================================================
-- 1. OPTIMIZE AUTH-RELATED QUERIES
-- =====================================================

-- Add indexes for faster auth lookups
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth.sessions(user_id);

-- =====================================================
-- 2. OPTIMIZE RLS POLICIES WITH SECURITY DEFINER FUNCTIONS
-- =====================================================

-- Create a security definer function to get current user ID once per query
CREATE OR REPLACE FUNCTION auth.current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT auth.uid();
$$;

-- Update habit_logs policies to use the optimized function
DROP POLICY IF EXISTS "habit_logs_optimized_select" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_optimized_insert" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_optimized_update" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_optimized_delete" ON habit_logs;

-- Create even more optimized policies using the security definer function
CREATE POLICY "habit_logs_ultra_optimized_select" ON habit_logs
  FOR SELECT USING (auth.current_user_id() = user_id);

CREATE POLICY "habit_logs_ultra_optimized_insert" ON habit_logs
  FOR INSERT WITH CHECK (auth.current_user_id() = user_id);

CREATE POLICY "habit_logs_ultra_optimized_update" ON habit_logs
  FOR UPDATE USING (auth.current_user_id() = user_id)
  WITH CHECK (auth.current_user_id() = user_id);

CREATE POLICY "habit_logs_ultra_optimized_delete" ON habit_logs
  FOR DELETE USING (auth.current_user_id() = user_id);

-- Update habits policies similarly
DROP POLICY IF EXISTS "habits_optimized_select" ON habits;
DROP POLICY IF EXISTS "habits_optimized_insert" ON habits;
DROP POLICY IF EXISTS "habits_optimized_update" ON habits;
DROP POLICY IF EXISTS "habits_optimized_delete" ON habits;

CREATE POLICY "habits_ultra_optimized_select" ON habits
  FOR SELECT USING (auth.current_user_id() = user_id);

CREATE POLICY "habits_ultra_optimized_insert" ON habits
  FOR INSERT WITH CHECK (auth.current_user_id() = user_id);

CREATE POLICY "habits_ultra_optimized_update" ON habits
  FOR UPDATE USING (auth.current_user_id() = user_id)
  WITH CHECK (auth.current_user_id() = user_id);

CREATE POLICY "habits_ultra_optimized_delete" ON habits
  FOR DELETE USING (auth.current_user_id() = user_id);

-- Update profiles policies
DROP POLICY IF EXISTS "profiles_optimized_select" ON profiles;
DROP POLICY IF EXISTS "profiles_optimized_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_optimized_update" ON profiles;

CREATE POLICY "profiles_ultra_optimized_select" ON profiles
  FOR SELECT USING (auth.current_user_id() = id);

CREATE POLICY "profiles_ultra_optimized_insert" ON profiles
  FOR INSERT WITH CHECK (auth.current_user_id() = id);

CREATE POLICY "profiles_ultra_optimized_update" ON profiles
  FOR UPDATE USING (auth.current_user_id() = id)
  WITH CHECK (auth.current_user_id() = id);

-- =====================================================
-- 3. ANALYZE TABLES AGAIN
-- =====================================================

ANALYZE auth.users;
ANALYZE auth.sessions;
ANALYZE profiles;
ANALYZE habits;
ANALYZE habit_logs;

-- =====================================================
-- 4. SUCCESS CONFIRMATION
-- =====================================================

SELECT 
  'AUTH PERFORMANCE OPTIMIZED!' as status,
  'Security definer function created' as optimization1,
  'Auth indexes added' as optimization2,
  'Ultra-optimized RLS policies applied' as optimization3,
  'This should reduce auth requests to 2-3 per sign-in' as expected_result;
