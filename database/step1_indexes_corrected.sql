-- Step 1: Add Critical Database Indexes (Corrected Version)
-- Run this first in your Supabase SQL Editor

-- First, let's check what columns actually exist in your habits table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'habits' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Primary performance indexes for habits table (using only existing columns)
CREATE INDEX IF NOT EXISTS idx_habits_user_id_created_at 
  ON habits(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_habits_user_id_name 
  ON habits(user_id, name);

-- Only create type index if the column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'habits' AND column_name = 'type') THEN
        CREATE INDEX IF NOT EXISTS idx_habits_user_id_type 
          ON habits(user_id, type);
    END IF;
END $$;

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

-- Check if onboarding_completed column exists before creating index
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'profiles' AND column_name = 'onboarding_completed') THEN
        CREATE INDEX IF NOT EXISTS idx_profiles_onboarding 
          ON profiles(id, onboarding_completed);
    END IF;
END $$;

-- Partial indexes for active/completed habits only (saves space and improves performance)
CREATE INDEX IF NOT EXISTS idx_habit_logs_completed_recent 
  ON habit_logs(habit_id, date DESC) 
  WHERE status = 'completed' AND date >= CURRENT_DATE - INTERVAL '90 days';

-- Index for AI chat queries (recent logs)
CREATE INDEX IF NOT EXISTS idx_habit_logs_ai_queries 
  ON habit_logs(user_id, habit_id, date DESC, status) 
  WHERE date >= CURRENT_DATE - INTERVAL '7 days';

-- Success message
SELECT 'Step 1 Complete: Critical indexes added successfully!' as status,
       'Most performance issues should be resolved now!' as message;
