-- Add time column to habit_logs table for better analytics
-- Run this in your Supabase SQL Editor

-- Add time column to store the specific time when the habit was logged
ALTER TABLE habit_logs ADD COLUMN IF NOT EXISTS time TIME;

-- Add index for better query performance on time-based analytics
CREATE INDEX IF NOT EXISTS idx_habit_logs_date_time 
  ON habit_logs(date, time);

-- Add index for time-based queries
CREATE INDEX IF NOT EXISTS idx_habit_logs_time 
  ON habit_logs(time);

-- Update existing records to set a default time based on created_at
UPDATE habit_logs 
SET time = created_at::time
WHERE time IS NULL;

-- Success message
SELECT 'Time column added successfully to habit_logs table!' as status,
       'Existing records updated with time from created_at timestamp' as message;
