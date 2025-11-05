# Analytics Date Filter & Missing Sleep Duration Fix

## Issues Found

### 1. Date Filter Not Working
The date range picker was displayed but not actually filtering the data:
- **Root Cause**: The API routes only accept `days_back` parameter, not `start_date`/`end_date`
- **Problem**: The code was trying to pass `start_date` and `end_date` but the backend ignored them
- **Result**: Always showed data from the last 30 days regardless of date selection

### 2. Sleep Duration Missing from Analytics
Sleep Duration shows on the Dashboard (6.48 hours for Oct 29) but doesn't appear in Analytics:
- **Root Cause**: Data sync issue between SQLite and Tinybird
- **Dashboard**: Pulls from local SQLite database (has Sleep Duration)
- **Analytics**: Pulls from Tinybird (missing Sleep Duration)
- **Problem**: Whoop sync creates logs in SQLite but they need to be synced to Tinybird for analytics

## Fixes Applied

### Date Range Filter - Fixed ✅

Updated `app/(dashboard)/analytics/page.tsx`:

**Before:**
```typescript
// Tried to pass start_date/end_date (not supported by API)
if (dateRange?.from && dateRange?.to) {
  dateParams = `start_date=${format(dateRange.from, 'yyyy-MM-dd')}&end_date=${format(dateRange.to, 'yyyy-MM-dd')}`;
}
```

**After:**
```typescript
// Calculate days_back from the date range
let daysBack = 30; // Default
if (dateRange?.from) {
  const now = new Date();
  const fromDate = dateRange.from;
  daysBack = Math.ceil((now.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
  daysBack = Math.max(1, daysBack); // At least 1 day
}
```

Changes:
1. **Habit List Fetch**: Now respects the date range and refetches when dateRange changes
2. **Analytics Data Fetch**: Correctly calculates `days_back` from the selected date range
3. **Dependency Arrays**: Added `dateRange` to both useEffect hooks so they re-fetch when dates change

### Sleep Duration Missing - Root Cause Identified ⚠️

The Whoop sync code (app/api/integrations/whoop/sync/route.ts) DOES sync Sleep Duration to Tinybird:
```typescript
// Line 380-420
const { data: sleepHabit } = await supabase
  .from('habits')
  .select('id, name')
  .eq('user_id', userId)
  .eq('name', 'Sleep Duration')  // Must match exactly
  .maybeSingle();

if (sleepHabit) {
  await tinybirdService.ingestHabitLog(habitLogData);
}
```

But the data is not in Tinybird. This means:
1. The Whoop sync hasn't run since the Sleep Duration log was created
2. The sync failed silently
3. The habit name doesn't match exactly "Sleep Duration"

## How to Fix Sleep Duration

### Option 1: Trigger Manual Whoop Re-sync
1. Go to the Integrations page in your app
2. Disconnect Whoop
3. Reconnect Whoop
4. The sync will run and send all recent data to Tinybird

### Option 2: Wait for Automatic Sync
The Whoop integration should sync automatically. Wait for the next scheduled sync.

### Option 3: Check Habit Name
Verify the habit is named exactly "Sleep Duration" (case-sensitive) in your habits list.

## Testing

After the fix, when you select "Oct 29" in the date picker:
- ✅ The habit dropdown should ONLY show habits with logs on or after Oct 29
- ✅ The charts should ONLY show data from Oct 29 onwards
- ⚠️ Sleep Duration will appear once the Whoop sync completes

## Files Modified
- `app/(dashboard)/analytics/page.tsx` - Fixed date range filtering

## Date: October 30, 2025

