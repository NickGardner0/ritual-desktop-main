-- Step 0: Add Missing Columns to Match TypeScript Types
-- Run this FIRST to ensure your database schema matches your app expectations

-- Add missing columns to habits table if they don't exist
DO $$ 
BEGIN
    -- Add type column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habits' AND column_name = 'type') THEN
        ALTER TABLE habits ADD COLUMN type TEXT CHECK (type IN ('good', 'bad'));
        -- Set default value for existing records
        UPDATE habits SET type = 'good' WHERE type IS NULL;
        -- Make it NOT NULL after setting defaults
        ALTER TABLE habits ALTER COLUMN type SET NOT NULL;
        RAISE NOTICE 'Added type column to habits table';
    END IF;

    -- Add is_custom column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habits' AND column_name = 'is_custom') THEN
        ALTER TABLE habits ADD COLUMN is_custom BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added is_custom column to habits table';
    END IF;

    -- Add updated_at column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'habits' AND column_name = 'updated_at') THEN
        ALTER TABLE habits ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added updated_at column to habits table';
    END IF;
END $$;

-- Add missing columns to profiles table if they don't exist
DO $$ 
BEGIN
    -- Add onboarding_completed column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'profiles' AND column_name = 'onboarding_completed') THEN
        ALTER TABLE profiles ADD COLUMN onboarding_completed BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added onboarding_completed column to profiles table';
    END IF;

    -- Add updated_at column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'profiles' AND column_name = 'updated_at') THEN
        ALTER TABLE profiles ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        RAISE NOTICE 'Added updated_at column to profiles table';
    END IF;
END $$;

-- Create or update the habit_type enum
DO $$
BEGIN
    -- Check if the enum exists
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'habit_type') THEN
        CREATE TYPE habit_type AS ENUM ('good', 'bad');
        RAISE NOTICE 'Created habit_type enum';
    END IF;
    
    -- Check if the status enum exists
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'habit_status') THEN
        CREATE TYPE habit_status AS ENUM ('completed', 'skipped', 'failed');
        RAISE NOTICE 'Created habit_status enum';
    END IF;
END $$;

-- Show the current schema to verify
SELECT 'Current habits table schema:' as info;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'habits' AND table_schema = 'public'
ORDER BY ordinal_position;

SELECT 'Current profiles table schema:' as info;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Success message
SELECT 'Step 0 Complete: Missing columns added successfully!' as status,
       'Your database schema now matches your TypeScript types!' as message;
