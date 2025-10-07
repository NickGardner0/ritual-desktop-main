-- Step 1: Add Critical Database Indexes
-- Run this first in your Supabase SQL Editor

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

-- Partial indexes for active/completed habits only (saves space and improves performance)
CREATE INDEX IF NOT EXISTS idx_habit_logs_completed_recent 
  ON habit_logs(habit_id, date DESC) 
  WHERE status = 'completed' AND date >= CURRENT_DATE - INTERVAL '90 days';

-- Index for AI chat queries (recent logs)
CREATE INDEX IF NOT EXISTS idx_habit_logs_ai_queries 
  ON habit_logs(user_id, habit_id, date DESC, status) 
  WHERE date >= CURRENT_DATE - INTERVAL '7 days';

-- Success message
SELECT 'Step 1 Complete: Critical indexes added successfully!' as status;
