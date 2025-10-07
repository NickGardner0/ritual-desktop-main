-- Step 2: Optimize Row Level Security Policies
-- Run this second in your Supabase SQL Editor

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

-- Success message
SELECT 'Step 2 Complete: RLS policies optimized successfully!' as status;
