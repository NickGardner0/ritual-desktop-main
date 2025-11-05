# Analytics Empty State & Missing Habits Fix

## Issues Fixed

### 1. Sleep Duration Missing from Dropdown ✅
**Problem**: Sleep Duration wasn't appearing in the Analytics habits dropdown even though it exists in the database.

**Root Cause**: The Analytics page was only fetching habits that had logs in Tinybird. Since Sleep Duration hasn't been synced to Tinybird yet, it wasn't showing.

**Solution**: Changed the habit fetching logic to:
1. Fetch ALL habits from Supabase (regardless of logs)
2. Fetch metrics from Tinybird separately  
3. Merge them together, showing 0 metrics for habits without logs

Now Sleep Duration and ALL your habits will appear in the dropdown, even if they have no data yet.

### 2. Empty Charts for Selected Date Range ✅
**Problem**: When selecting Oct 29 as the date filter, no charts appeared even though habits were selected. This is because none of those habits had logs on that specific day.

**Root Cause**: The code was returning `null` for habits with no logs, which caused them to be skipped entirely.

**Solution**: Modified the chart rendering logic to:
- Show the habit card even when there are no logs
- Display `0` as the current value
- Show "No data for selected period" in the chart area instead of hiding the card

## Changes Made

### File: `app/(dashboard)/analytics/page.tsx`

1. **Added Supabase Client Import**:
```typescript
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
```

2. **Changed Habit Fetching Logic**:
   - Now fetches ALL habits from Supabase first
   - Then fetches metrics from Tinybird
   - Merges them with default values of 0 for habits without logs
   
3. **Updated `getHabitCardData` Function**:
   - Returns empty state object instead of `null` when no logs exist
   - Shows 0 values and empty chart data

4. **Updated `getExpandedData` Function**:
   - Returns empty state instead of `null` for habits with no logs

5. **Updated `HabitMetricCard` Component**:
   - Shows "No data for selected period" message when `chartData` is empty
   - Still displays the habit name and 0 value

## User Experience

### Before:
- Sleep Duration: ❌ Not in dropdown at all
- Oct 29 filter: ❌ No charts appear, blank screen

### After:
- Sleep Duration: ✅ Shows in dropdown with other habits
- Oct 29 filter: ✅ Charts appear showing "0 Minutes" or "0 Pages" with "No data for selected period" message

## Testing

1. **Refresh** your Analytics page
2. You should now see Sleep Duration in the "Select habits" dropdown
3. Select Sleep Duration and other habits
4. Change date range to "Oct 29"
5. Charts will appear showing:
   - For Sleep Duration: `0 Hours` with "No data for selected period"
   - For other habits: Their actual values or 0 if no logs exist for that day

## Next Steps

To see actual Sleep Duration data in Analytics, you still need to:
1. Go to Integrations page
2. Disconnect and reconnect Whoop
3. This will sync all Whoop data (including Sleep Duration) to Tinybird

Once synced, Sleep Duration charts will show real data instead of the empty state.

## Date: October 30, 2025

