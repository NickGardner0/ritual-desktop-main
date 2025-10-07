-- Simple Column Addition Script
-- Run this to add missing columns to your habits table

-- Add type column to habits table
ALTER TABLE habits ADD COLUMN IF NOT EXISTS type TEXT;

-- Add is_custom column to habits table  
ALTER TABLE habits ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false;

-- Add updated_at column to habits table
ALTER TABLE habits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Set default values for existing records
UPDATE habits SET type = 'good' WHERE type IS NULL;
UPDATE habits SET is_custom = false WHERE is_custom IS NULL;

-- Add constraint to type column
ALTER TABLE habits ADD CONSTRAINT habits_type_check CHECK (type IN ('good', 'bad'));

-- Add onboarding_completed column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Add updated_at column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Show what we've added
SELECT 'Columns added successfully!' as status;
