-- Step-by-Step Column Addition
-- Copy and paste each section individually into Supabase SQL Editor

-- SECTION 1: Add type column
-- Copy and run this first:
ALTER TABLE habits ADD COLUMN type TEXT;

-- SECTION 2: Set default values  
-- Copy and run this second:
UPDATE habits SET type = 'good';

-- SECTION 3: Add constraint
-- Copy and run this third:
ALTER TABLE habits ADD CONSTRAINT habits_type_check CHECK (type IN ('good', 'bad'));

-- SECTION 4: Add is_custom column
-- Copy and run this fourth:
ALTER TABLE habits ADD COLUMN is_custom BOOLEAN DEFAULT false;

-- SECTION 5: Add updated_at to habits
-- Copy and run this fifth:
ALTER TABLE habits ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- SECTION 6: Add onboarding_completed to profiles
-- Copy and run this sixth:
ALTER TABLE profiles ADD COLUMN onboarding_completed BOOLEAN DEFAULT false;

-- SECTION 7: Add updated_at to profiles  
-- Copy and run this seventh:
ALTER TABLE profiles ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
