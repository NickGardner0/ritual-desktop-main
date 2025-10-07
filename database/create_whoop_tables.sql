-- Whoop Integration Tables
-- Run this SQL in your Supabase SQL Editor

-- Table to store Whoop OAuth tokens for each user
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

-- Table to store Whoop recovery data
CREATE TABLE IF NOT EXISTS whoop_recovery_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  whoop_connection_id UUID NOT NULL REFERENCES whoop_connections(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL,
  date DATE NOT NULL,
  recovery_score DECIMAL(5,2),
  hrv_rmssd DECIMAL(10,2),
  resting_heart_rate INTEGER,
  spo2_percentage DECIMAL(5,2),
  skin_temp_celsius DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, cycle_id)
);

-- Table to store Whoop sleep data
CREATE TABLE IF NOT EXISTS whoop_sleep_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  whoop_connection_id UUID NOT NULL REFERENCES whoop_connections(id) ON DELETE CASCADE,
  sleep_id TEXT NOT NULL,
  date DATE NOT NULL,
  sleep_performance_percentage DECIMAL(5,2),
  total_sleep_duration_minutes INTEGER,
  sleep_efficiency_percentage DECIMAL(5,2),
  rem_sleep_minutes INTEGER,
  slow_wave_sleep_minutes INTEGER,
  light_sleep_minutes INTEGER,
  awake_minutes INTEGER,
  sleep_onset TIMESTAMP WITH TIME ZONE,
  sleep_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, sleep_id)
);

-- Table to store Whoop strain/workout data
CREATE TABLE IF NOT EXISTS whoop_workout_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  whoop_connection_id UUID NOT NULL REFERENCES whoop_connections(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  date DATE NOT NULL,
  strain_score DECIMAL(5,2),
  activity_name TEXT,
  duration_minutes INTEGER,
  average_heart_rate INTEGER,
  max_heart_rate INTEGER,
  kilojoules DECIMAL(10,2),
  distance_meters DECIMAL(10,2),
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, workout_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_whoop_connections_user_id ON whoop_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_whoop_connections_active ON whoop_connections(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_whoop_recovery_user_date ON whoop_recovery_data(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_whoop_recovery_connection ON whoop_recovery_data(whoop_connection_id);

CREATE INDEX IF NOT EXISTS idx_whoop_sleep_user_date ON whoop_sleep_data(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_whoop_sleep_connection ON whoop_sleep_data(whoop_connection_id);

CREATE INDEX IF NOT EXISTS idx_whoop_workout_user_date ON whoop_workout_data(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_whoop_workout_connection ON whoop_workout_data(whoop_connection_id);

-- Row Level Security (RLS) Policies
ALTER TABLE whoop_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_recovery_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_sleep_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_workout_data ENABLE ROW LEVEL SECURITY;

-- Whoop Connections Policies
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

-- Whoop Recovery Data Policies
CREATE POLICY "Users can view their own Whoop recovery data"
  ON whoop_recovery_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Whoop recovery data"
  ON whoop_recovery_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Whoop recovery data"
  ON whoop_recovery_data FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Whoop Sleep Data Policies
CREATE POLICY "Users can view their own Whoop sleep data"
  ON whoop_sleep_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Whoop sleep data"
  ON whoop_sleep_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Whoop sleep data"
  ON whoop_sleep_data FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Whoop Workout Data Policies
CREATE POLICY "Users can view their own Whoop workout data"
  ON whoop_workout_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own Whoop workout data"
  ON whoop_workout_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own Whoop workout data"
  ON whoop_workout_data FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_whoop_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_whoop_connections_updated_at
  BEFORE UPDATE ON whoop_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_whoop_updated_at();

CREATE TRIGGER update_whoop_recovery_updated_at
  BEFORE UPDATE ON whoop_recovery_data
  FOR EACH ROW
  EXECUTE FUNCTION update_whoop_updated_at();

CREATE TRIGGER update_whoop_sleep_updated_at
  BEFORE UPDATE ON whoop_sleep_data
  FOR EACH ROW
  EXECUTE FUNCTION update_whoop_updated_at();

CREATE TRIGGER update_whoop_workout_updated_at
  BEFORE UPDATE ON whoop_workout_data
  FOR EACH ROW
  EXECUTE FUNCTION update_whoop_updated_at();

