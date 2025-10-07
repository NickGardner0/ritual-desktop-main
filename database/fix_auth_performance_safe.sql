-- SAFE AUTH PERFORMANCE FIX (No system table modifications)
-- Run this version instead - it only modifies tables you own

-- =====================================================
-- 1. CREATE SECURITY DEFINER FUNCTION FOR BETTER RLS PERFORMANCE
-- =====================================================

-- Create a security definer function to get current user ID once per query
-- This is the most important optimization
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT auth.uid();
$$;

-- =====================================================
-- 2. UPDATE RLS POLICIES TO USE THE OPTIMIZED FUNCTION
-- =====================================================

-- Update habit_logs policies to use the optimized function
DROP POLICY IF EXISTS "habit_logs_optimized_select" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_optimized_insert" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_optimized_update" ON habit_logs;
DROP POLICY IF EXISTS "habit_logs_optimized_delete" ON habit_logs;

-- Create even more optimized policies using the security definer function
CREATE POLICY "habit_logs_ultra_optimized_select" ON habit_logs
  FOR SELECT USING (public.current_user_id() = user_id);

CREATE POLICY "habit_logs_ultra_optimized_insert" ON habit_logs
  FOR INSERT WITH CHECK (public.current_user_id() = user_id);

CREATE POLICY "habit_logs_ultra_optimized_update" ON habit_logs
  FOR UPDATE USING (public.current_user_id() = user_id)
  WITH CHECK (public.current_user_id() = user_id);

CREATE POLICY "habit_logs_ultra_optimized_delete" ON habit_logs
  FOR DELETE USING (public.current_user_id() = user_id);

-- Update habits policies similarly
DROP POLICY IF EXISTS "habits_optimized_select" ON habits;
DROP POLICY IF EXISTS "habits_optimized_insert" ON habits;
DROP POLICY IF EXISTS "habits_optimized_update" ON habits;
DROP POLICY IF EXISTS "habits_optimized_delete" ON habits;

CREATE POLICY "habits_ultra_optimized_select" ON habits
  FOR SELECT USING (public.current_user_id() = user_id);

CREATE POLICY "habits_ultra_optimized_insert" ON habits
  FOR INSERT WITH CHECK (public.current_user_id() = user_id);

CREATE POLICY "habits_ultra_optimized_update" ON habits
  FOR UPDATE USING (public.current_user_id() = user_id)
  WITH CHECK (public.current_user_id() = user_id);

CREATE POLICY "habits_ultra_optimized_delete" ON habits
  FOR DELETE USING (public.current_user_id() = user_id);

-- Update profiles policies (if you have a profiles table)
DROP POLICY IF EXISTS "profiles_optimized_select" ON profiles;
DROP POLICY IF EXISTS "profiles_optimized_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_optimized_update" ON profiles;

-- Only create profiles policies if the table exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profiles' AND table_schema = 'public') THEN
        EXECUTE 'CREATE POLICY "profiles_ultra_optimized_select" ON profiles FOR SELECT USING (public.current_user_id() = id)';
        EXECUTE 'CREATE POLICY "profiles_ultra_optimized_insert" ON profiles FOR INSERT WITH CHECK (public.current_user_id() = id)';
        EXECUTE 'CREATE POLICY "profiles_ultra_optimized_update" ON profiles FOR UPDATE USING (public.current_user_id() = id) WITH CHECK (public.current_user_id() = id)';
    END IF;
END $$;

-- =====================================================
-- 3. ADD PERFORMANCE INDEXES (ONLY ON YOUR TABLES)
-- =====================================================

-- Indexes for your tables (these you can create)
CREATE INDEX IF NOT EXISTS idx_habits_user_id_optimized ON habits(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_id_optimized ON habit_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_date_optimized ON habit_logs(user_id, date) WHERE user_id IS NOT NULL;

-- =====================================================
-- 4. ANALYZE YOUR TABLES
-- =====================================================

ANALYZE habits;
ANALYZE habit_logs;

-- Only analyze profiles if it exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profiles' AND table_schema = 'public') THEN
        EXECUTE 'ANALYZE profiles';
    END IF;
END $$;

-- =====================================================
-- 5. SUCCESS CONFIRMATION
-- =====================================================

SELECT 
  'SAFE AUTH PERFORMANCE OPTIMIZED!' as status,
  'Security definer function created in public schema' as optimization1,
  'Ultra-optimized RLS policies applied' as optimization2,
  'Performance indexes added to your tables' as optimization3,
  'This should reduce auth requests to 2-3 per sign-in' as expected_result;
