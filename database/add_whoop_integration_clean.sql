-- Hybrid Whoop Integration - Only New Changes
-- Run this SQL in your Supabase SQL Editor
-- (Skips whoop_connections table and policies since they already exist)

-- 1. Add new columns to existing habit_logs table
ALTER TABLE habit_logs 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES whoop_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whoop_metric_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Add constraint for source column (drop first if exists)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'habit_logs_source_check'
  ) THEN
    ALTER TABLE habit_logs DROP CONSTRAINT habit_logs_source_check;
  END IF;
END $$;

ALTER TABLE habit_logs 
  ADD CONSTRAINT habit_logs_source_check 
  CHECK (source IN ('manual', 'whoop', 'oura', 'apple_watch', 'garmin', 'fitbit'));

-- 3. Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_habit_logs_source ON habit_logs(source);
CREATE INDEX IF NOT EXISTS idx_habit_logs_integration ON habit_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_source ON habit_logs(user_id, source, date DESC);

-- 4. Add comments for documentation
COMMENT ON COLUMN habit_logs.source IS 'Source of the log entry: manual, whoop, oura, apple_watch, etc.';
COMMENT ON COLUMN habit_logs.integration_id IS 'Foreign key to the integration connection (e.g., whoop_connections)';
COMMENT ON COLUMN habit_logs.whoop_metric_type IS 'Type of Whoop metric: recovery, sleep, strain, workout';
COMMENT ON COLUMN habit_logs.metadata IS 'Additional data stored as JSON (e.g., HRV, sleep stages, heart rate details)';

-- 5. Update existing manual logs to have source='manual' (if not already set)
UPDATE habit_logs 
SET source = 'manual' 
WHERE source IS NULL OR source = 'manual';

-- Done! Now you can click "Sync Now" on the Whoop card to fetch your data.

