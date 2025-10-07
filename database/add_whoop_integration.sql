-- Hybrid Whoop Integration - Minimal Database Approach
-- Run this SQL in your Supabase SQL Editor

-- 1. Create whoop_connections table (only table needed for OAuth)
CREATE TABLE IF NOT EXISTS whoop_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  whoop_user_id TEXT,
  connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_synced_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 2. Add new columns to existing habit_logs table
ALTER TABLE habit_logs 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES whoop_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whoop_metric_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 3. Add constraint for source column
ALTER TABLE habit_logs 
  ADD CONSTRAINT habit_logs_source_check 
  CHECK (source IN ('manual', 'whoop', 'oura', 'apple_watch', 'garmin', 'fitbit'));

-- 4. Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_whoop_connections_user_id ON whoop_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_whoop_connections_active ON whoop_connections(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_habit_logs_source ON habit_logs(source);
CREATE INDEX IF NOT EXISTS idx_habit_logs_integration ON habit_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_source ON habit_logs(user_id, source, date DESC);

-- 5. Row Level Security (RLS) Policies for whoop_connections
ALTER TABLE whoop_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own Whoop connections"
  ON whoop_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Whoop connections"
  ON whoop_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Whoop connections"
  ON whoop_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own Whoop connections"
  ON whoop_connections FOR DELETE
  USING (auth.uid() = user_id);

-- 6. Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_whoop_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for updated_at
DROP TRIGGER IF EXISTS update_whoop_connections_updated_at ON whoop_connections;
CREATE TRIGGER update_whoop_connections_updated_at
  BEFORE UPDATE ON whoop_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_whoop_connections_updated_at();

-- 8. Create or update habits for Whoop metrics (optional - can be done in app)
INSERT INTO habits (user_id, name, type, is_custom, unit_type, category, icon)
SELECT 
  auth.uid(),
  'Whoop Recovery',
  'good',
  false,
  'Percentage',
  'Health',
  'heart'
WHERE NOT EXISTS (
  SELECT 1 FROM habits WHERE user_id = auth.uid() AND name = 'Whoop Recovery'
);

INSERT INTO habits (user_id, name, type, is_custom, unit_type, category, icon)
SELECT 
  auth.uid(),
  'Sleep Performance',
  'good',
  false,
  'Percentage',
  'Health',
  'moon'
WHERE NOT EXISTS (
  SELECT 1 FROM habits WHERE user_id = auth.uid() AND name = 'Sleep Performance'
);

INSERT INTO habits (user_id, name, type, is_custom, unit_type, category, icon)
SELECT 
  auth.uid(),
  'Daily Strain',
  'good',
  false,
  'Score',
  'Fitness',
  'activity'
WHERE NOT EXISTS (
  SELECT 1 FROM habits WHERE user_id = auth.uid() AND name = 'Daily Strain'
);

INSERT INTO habits (user_id, name, type, is_custom, unit_type, category, icon)
SELECT 
  auth.uid(),
  'Sleep Duration',
  'good',
  false,
  'Hours',
  'Health',
  'bed'
WHERE NOT EXISTS (
  SELECT 1 FROM habits WHERE user_id = auth.uid() AND name = 'Sleep Duration'
);

-- 9. Comment explanations
COMMENT ON COLUMN habit_logs.source IS 'Source of the log entry: manual, whoop, oura, apple_watch, etc.';
COMMENT ON COLUMN habit_logs.integration_id IS 'Foreign key to the integration connection (e.g., whoop_connections)';
COMMENT ON COLUMN habit_logs.whoop_metric_type IS 'Type of Whoop metric: recovery, sleep, strain, workout';
COMMENT ON COLUMN habit_logs.metadata IS 'Additional data stored as JSON (e.g., HRV, sleep stages, heart rate details)';

