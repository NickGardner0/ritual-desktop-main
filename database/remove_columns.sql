-- Remove birth_year and experience_level columns from profiles table
-- Run this in your Supabase SQL editor

ALTER TABLE profiles 
DROP COLUMN IF EXISTS birth_year,
DROP COLUMN IF EXISTS experience_level;
