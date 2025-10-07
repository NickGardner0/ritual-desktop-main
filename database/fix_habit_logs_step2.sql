-- Step 2: Enable RLS and create policies

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
