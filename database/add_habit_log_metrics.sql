-- Add quantitative tracking columns to habit_logs table
-- Run this in your Supabase SQL editor

-- Add duration column for time-based tracking (in seconds)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habit_logs' AND column_name = 'duration') THEN
        ALTER TABLE habit_logs ADD COLUMN duration INTEGER;
    END IF;
END $$;

-- Add amount column for quantity-based tracking (pages, miles, etc.)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habit_logs' AND column_name = 'amount') THEN
        ALTER TABLE habit_logs ADD COLUMN amount DECIMAL(10,2);
    END IF;
END $$;

-- Add unit column for specifying the unit of measurement
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habit_logs' AND column_name = 'unit') THEN
        ALTER TABLE habit_logs ADD COLUMN unit TEXT;
    END IF;
END $$;

-- Add notes column for additional context
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habit_logs' AND column_name = 'notes') THEN
        ALTER TABLE habit_logs ADD COLUMN notes TEXT;
    END IF;
END $$;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_habit_logs_amount ON habit_logs(amount);
CREATE INDEX IF NOT EXISTS idx_habit_logs_duration ON habit_logs(duration);
