-- Update time column to store full timestamp instead of just time
-- Run this in your Supabase SQL Editor

-- First, let's rename the current time column to preserve any existing data
ALTER TABLE habit_logs RENAME COLUMN time TO time_old;

-- Add a new timestamp column that includes both date and time
ALTER TABLE habit_logs ADD COLUMN time TIMESTAMP WITH TIME ZONE;

-- Update existing records to combine date and time_old into full timestamp
UPDATE habit_logs 
SET time = CASE 
  WHEN time_old IS NOT NULL THEN 
    (date || ' ' || time_old)::timestamp with time zone
  ELSE 
    created_at
END
WHERE time IS NULL;

-- Drop the old time_old column
ALTER TABLE habit_logs DROP COLUMN IF EXISTS time_old;

-- Update the existing indexes
DROP INDEX IF EXISTS idx_habit_logs_date_time;
DROP INDEX IF EXISTS idx_habit_logs_time;

-- Create new indexes for the timestamp column
CREATE INDEX IF NOT EXISTS idx_habit_logs_date_time 
  ON habit_logs(date, time);

CREATE INDEX IF NOT EXISTS idx_habit_logs_timestamp 
  ON habit_logs(time);

-- Note: Advanced time-based analytics indexes can be added later if needed

-- Success message
SELECT 'Time column updated to full timestamp successfully!' as status,
       'Now includes full date and time for better analytics' as message;
