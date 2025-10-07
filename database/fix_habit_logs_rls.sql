-- Fix RLS policy for habit_logs table to allow timer widget inserts

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can insert their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can view their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can update their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can delete their own habit logs" ON habit_logs;

-- Add user_id column if it doesn't exist, then ensure proper type
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habit_logs' AND column_name = 'user_id') THEN
        ALTER TABLE habit_logs ADD COLUMN user_id uuid;
    END IF;
END $$;

-- Ensure user_id column has proper type
ALTER TABLE habit_logs 
ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- Enable RLS on habit_logs table
ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for habit_logs table
CREATE POLICY "Users can insert their own habit logs"
ON habit_logs FOR INSERT
WITH CHECK (auth.uid() = user_id::uuid);

CREATE POLICY "Users can view their own habit logs"
ON habit_logs FOR SELECT
USING (auth.uid() = user_id::uuid);

CREATE POLICY "Users can update their own habit logs"
ON habit_logs FOR UPDATE
USING (auth.uid() = user_id::uuid)
WITH CHECK (auth.uid() = user_id::uuid);

CREATE POLICY "Users can delete their own habit logs"
ON habit_logs FOR DELETE
USING (auth.uid() = user_id::uuid);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_id ON habit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);
