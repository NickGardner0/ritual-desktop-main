-- Comprehensive Database Performance Optimization for Ritual App
-- Run this in your Supabase SQL editor to optimize performance and reduce costs

-- =====================================================
-- 1. OPTIMIZE ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Drop and recreate more efficient RLS policies for profiles table
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- More efficient profile policies with better indexing support
CREATE POLICY "profiles_select_policy" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_insert_policy" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_policy" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Optimize habits table RLS policies
DROP POLICY IF EXISTS "Users can manage their own habits" ON habits;
DROP POLICY IF EXISTS "Users can view their own habits" ON habits;
DROP POLICY IF EXISTS "Users can insert their own habits" ON habits;
DROP POLICY IF EXISTS "Users can update their own habits" ON habits;
DROP POLICY IF EXISTS "Users can delete their own habits" ON habits;

-- More efficient habits policies
CREATE POLICY "habits_select_policy" ON habits
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "habits_insert_policy" ON habits
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "habits_update_policy" ON habits
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "habits_delete_policy" ON habits
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================
-- 2. ADD CRITICAL MISSING INDEXES
-- =====================================================

-- Primary performance indexes for habits table
CREATE INDEX IF NOT EXISTS idx_habits_user_id_created_at 
  ON habits(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_habits_user_id_name 
  ON habits(user_id, name);

CREATE INDEX IF NOT EXISTS idx_habits_user_id_type 
  ON habits(user_id, type);

-- Critical indexes for habit_logs table (main performance bottleneck)
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_id_date 
  ON habit_logs(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_id_date 
  ON habit_logs(habit_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_habit_logs_user_id_status 
  ON habit_logs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_habit_logs_date_status 
  ON habit_logs(date DESC, status) WHERE status = 'completed';

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_habit_date 
  ON habit_logs(user_id, habit_id, date DESC);

-- Index for aggregation queries (metrics calculations)
CREATE INDEX IF NOT EXISTS idx_habit_logs_metrics 
  ON habit_logs(habit_id, status, date DESC) 
  WHERE status = 'completed';

-- Profiles table optimization
CREATE INDEX IF NOT EXISTS idx_profiles_email 
  ON profiles(email);

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding 
  ON profiles(id, onboarding_completed);

-- =====================================================
-- 3. OPTIMIZE EXISTING QUERIES WITH MATERIALIZED VIEWS
-- =====================================================

-- Create a materialized view for habit metrics (refreshed periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS habit_metrics_summary AS
SELECT 
    h.id as habit_id,
    h.user_id,
    h.name,
    h.type,
    COUNT(hl.id) FILTER (WHERE hl.status = 'completed') as total_completed,
    COUNT(hl.id) FILTER (WHERE hl.status = 'completed' AND hl.date >= CURRENT_DATE - INTERVAL '7 days') as completed_last_7_days,
    COUNT(hl.id) FILTER (WHERE hl.status = 'completed' AND hl.date >= CURRENT_DATE - INTERVAL '30 days') as completed_last_30_days,
    SUM(hl.duration) FILTER (WHERE hl.status = 'completed') as total_duration,
    SUM(hl.amount) FILTER (WHERE hl.status = 'completed') as total_amount,
    MAX(hl.date) FILTER (WHERE hl.status = 'completed') as last_completed_date
FROM habits h
LEFT JOIN habit_logs hl ON h.id = hl.habit_id
GROUP BY h.id, h.user_id, h.name, h.type;

-- Create index on the materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_metrics_summary_habit_id 
  ON habit_metrics_summary(habit_id);

CREATE INDEX IF NOT EXISTS idx_habit_metrics_summary_user_id 
  ON habit_metrics_summary(user_id);

-- =====================================================
-- 4. ADD FOREIGN KEY CONSTRAINTS FOR DATA INTEGRITY
-- =====================================================

-- Add foreign key constraints if they don't exist
DO $$ 
BEGIN
    -- Check if foreign key constraint exists for habits.user_id -> auth.users.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'habits_user_id_fkey' 
        AND table_name = 'habits'
    ) THEN
        ALTER TABLE habits 
        ADD CONSTRAINT habits_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- Check if foreign key constraint exists for habit_logs.user_id -> auth.users.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'habit_logs_user_id_fkey' 
        AND table_name = 'habit_logs'
    ) THEN
        ALTER TABLE habit_logs 
        ADD CONSTRAINT habit_logs_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- Check if foreign key constraint exists for habit_logs.habit_id -> habits.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'habit_logs_habit_id_fkey' 
        AND table_name = 'habit_logs'
    ) THEN
        ALTER TABLE habit_logs 
        ADD CONSTRAINT habit_logs_habit_id_fkey 
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE;
    END IF;

    -- Check if foreign key constraint exists for profiles.id -> auth.users.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'profiles_id_fkey' 
        AND table_name = 'profiles'
    ) THEN
        ALTER TABLE profiles 
        ADD CONSTRAINT profiles_id_fkey 
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =====================================================
-- 5. OPTIMIZE TABLE SETTINGS
-- =====================================================

-- Enable auto-vacuum for better maintenance
ALTER TABLE habits SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE habit_logs SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE profiles SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_analyze_scale_factor = 0.1
);

-- =====================================================
-- 6. CREATE OPTIMIZED FUNCTIONS FOR COMMON QUERIES
-- =====================================================

-- Function to get habit metrics efficiently
CREATE OR REPLACE FUNCTION get_user_habit_metrics(user_uuid uuid, date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE (
    habit_id uuid,
    habit_name text,
    total_completed bigint,
    total_duration bigint,
    total_amount numeric,
    last_completed_date date
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        h.id,
        h.name,
        COUNT(hl.id) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))::bigint,
        SUM(hl.duration) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))::bigint,
        SUM(hl.amount) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))::numeric,
        MAX(hl.date) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))
    FROM habits h
    LEFT JOIN habit_logs hl ON h.id = hl.habit_id
    WHERE h.user_id = user_uuid
    GROUP BY h.id, h.name
    ORDER BY h.created_at DESC;
END;
$$;

-- Function to refresh materialized view (call this periodically)
CREATE OR REPLACE FUNCTION refresh_habit_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY habit_metrics_summary;
END;
$$;

-- =====================================================
-- 7. ANALYZE TABLES FOR QUERY PLANNER OPTIMIZATION
-- =====================================================

-- Update table statistics for better query planning
ANALYZE habits;
ANALYZE habit_logs;
ANALYZE profiles;
ANALYZE predefined_habits;

-- =====================================================
-- 8. CREATE PARTIAL INDEXES FOR COMMON FILTERS
-- =====================================================

-- Partial indexes for active/completed habits only (saves space and improves performance)
CREATE INDEX IF NOT EXISTS idx_habit_logs_completed_recent 
  ON habit_logs(habit_id, date DESC) 
  WHERE status = 'completed' AND date >= CURRENT_DATE - INTERVAL '90 days';

-- Index for AI chat queries (recent logs)
CREATE INDEX IF NOT EXISTS idx_habit_logs_ai_queries 
  ON habit_logs(user_id, habit_id, date DESC, status) 
  WHERE date >= CURRENT_DATE - INTERVAL '7 days';

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Database optimization completed successfully!';
    RAISE NOTICE '📊 Added % indexes for better query performance', 15;
    RAISE NOTICE '🔒 Optimized RLS policies for better security and performance';
    RAISE NOTICE '⚡ Created materialized views for faster aggregations';
    RAISE NOTICE '🔧 Added foreign key constraints for data integrity';
    RAISE NOTICE '📈 Run REFRESH MATERIALIZED VIEW habit_metrics_summary; periodically';
    RAISE NOTICE '💰 These optimizations should significantly reduce query costs and improve speed';
END $$;
