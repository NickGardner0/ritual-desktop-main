-- Step 1: Drop existing policies and add user_id column

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can insert their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can view their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can update their own habit logs" ON habit_logs;
DROP POLICY IF EXISTS "Users can delete their own habit logs" ON habit_logs;

-- Add user_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habit_logs' AND column_name = 'user_id') THEN
        ALTER TABLE habit_logs ADD COLUMN user_id uuid;
    END IF;
END $$;
