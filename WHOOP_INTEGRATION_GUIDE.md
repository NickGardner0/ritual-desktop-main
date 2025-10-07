# Whoop Integration - Hybrid Approach 🎉

## ✅ What's Been Implemented

Your Whoop integration is now set up with a **minimal, unified database approach**:

### Database Structure
- **1 new table**: `whoop_connections` (stores OAuth tokens)
- **Updated existing table**: `habit_logs` (now handles both manual + automated data)
- **No separate Whoop data tables** - everything goes into `habit_logs`!

### Key Features
1. **Unified Tracking**: Manual habits (Reading, Deep Work) and Whoop data (Recovery, Sleep) all display together
2. **Source Tracking**: `source` column differentiates between `'manual'`, `'whoop'`, `'oura'`, etc.
3. **Metadata Storage**: Extra Whoop details (HRV, sleep stages, etc.) stored in JSON `metadata` column
4. **Future-Proof**: Ready for Oura Ring, Apple Watch, Garmin, etc.

## 📋 Setup Instructions

### Step 1: Run the SQL Migration
1. Open Supabase SQL Editor
2. Copy all contents from: `database/add_whoop_integration.sql`
3. Paste and run it
4. This will:
   - Create `whoop_connections` table
   - Add `source`, `integration_id`, `whoop_metric_type`, `metadata` columns to `habit_logs`
   - Create RLS policies
   - Create indexes for performance
   - Optionally create Whoop habit entries

### Step 2: Test the Sync
1. Go to `/integrations` page
2. Your Whoop should already show "Connected" ✅
3. Click **"Sync Now"**
4. Watch terminal for sync logs
5. Go to `/dashboard` - Whoop data should appear alongside manual habits!

### Step 3: Verify in Supabase
Check your `habit_logs` table in Supabase:
- You should see new rows with `source = 'whoop'`
- Whoop metrics: Recovery %, Sleep Performance %, Daily Strain, Sleep Duration
- Each row has `integration_id` linking to `whoop_connections`
- `metadata` column contains detailed metrics (HRV, sleep stages, etc.)

## 🔄 How It Works

### Data Flow
1. **OAuth**: User authorizes Whoop → Token saved to `whoop_connections`
2. **Sync**: Fetch last 7 days of Whoop data via API
3. **Transform**: Convert Whoop metrics to habit log format
4. **Store**: Insert into `habit_logs` with `source='whoop'`
5. **Display**: Dashboard shows all tracking data together

### Whoop Metrics Tracked
| Whoop Metric | Habit Name | Unit | Metadata Includes |
|---|---|---|---|
| Recovery Score | Whoop Recovery | % | HRV, Resting HR, SpO2, Skin Temp |
| Sleep Performance | Sleep Performance | % | Sleep Efficiency, Respiratory Rate |
| Sleep Duration | Sleep Duration | Hours | REM, Deep, Light, Awake minutes |
| Workout Strain | Daily Strain | Strain | Workout count per day |

### Database Schema

**`habit_logs` (Updated)**
```sql
- source: 'manual' | 'whoop' | 'oura' | 'apple_watch' | 'garmin' | 'fitbit'
- integration_id: UUID (foreign key to whoop_connections)
- whoop_metric_type: 'recovery' | 'sleep_performance' | 'sleep_duration' | 'strain'
- metadata: JSONB (stores extra details like HRV, sleep stages, etc.)
```

**`whoop_connections` (New)**
```sql
- user_id: UUID
- access_token: TEXT
- token_expires_at: TIMESTAMP
- whoop_user_id: TEXT
- last_synced_at: TIMESTAMP
- is_active: BOOLEAN
```

## 🎯 Benefits of This Approach

1. **Minimal Database**: Only 1 new table instead of 4
2. **Unified View**: All tracking data in one place
3. **Simple Queries**: No complex joins needed
4. **Scalable**: Easy to add more integrations (Oura, Apple Watch, etc.)
5. **Clean Architecture**: Separation of concerns (OAuth vs data)

## 🚀 Next Steps

### Display Whoop Data on Dashboard
Your dashboard should already show Whoop data! If not, check:
- Habits exist: `Whoop Recovery`, `Sleep Performance`, `Daily Strain`, `Sleep Duration`
- Logs have `source='whoop'` in Supabase
- Dashboard queries `habit_logs` table

### Automatic Syncing (Optional)
Currently sync is manual ("Sync Now" button). To automate:
1. Create a cron job in Supabase Edge Functions
2. Schedule daily sync (e.g., every morning at 6am)
3. Trigger sync API endpoint with user IDs

### Add More Integrations
To add Oura Ring, Apple Watch, etc.:
1. Create `oura_connections` table (same structure as `whoop_connections`)
2. Update `source` type in TypeScript
3. Create sync endpoint at `/api/integrations/oura/sync`
4. Insert logs with `source='oura'`

## 📊 Example Queries

**Get all Whoop data for a user:**
```sql
SELECT * FROM habit_logs 
WHERE user_id = 'xxx' 
AND source = 'whoop'
ORDER BY date DESC;
```

**Get all tracking data (manual + Whoop):**
```sql
SELECT * FROM habit_logs 
WHERE user_id = 'xxx'
ORDER BY date DESC, source;
```

**Get Whoop recovery with metadata:**
```sql
SELECT 
  date,
  amount as recovery_score,
  metadata->>'hrv_rmssd' as hrv,
  metadata->>'resting_heart_rate' as resting_hr
FROM habit_logs 
WHERE user_id = 'xxx' 
AND whoop_metric_type = 'recovery'
ORDER BY date DESC;
```

## 🔧 Files Modified

1. `database/add_whoop_integration.sql` - Migration script
2. `types/supabase.ts` - Updated TypeScript types
3. `app/api/integrations/whoop/sync/route.ts` - Inserts into `habit_logs`
4. `app/api/chat/habits/route.ts` - Adds `source='manual'` to AI-logged habits

## ✨ Clean Database Achievement Unlocked!

You now have:
- **5 core tables**: `profiles`, `habits`, `habit_logs`, `predefined_habits`, `whoop_connections`
- **Unified tracking system**: All data in `habit_logs`
- **Scalable architecture**: Ready for future integrations

No bloat, no complexity, just clean, minimal database design! 🎉

