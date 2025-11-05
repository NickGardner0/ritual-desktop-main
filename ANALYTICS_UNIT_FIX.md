# Analytics Unit Display Fix

## Issue
The Analytics page was displaying "count" as the metric for all habits, instead of showing the correct units like "Minutes", "Hours", "Steps", "Pages", "Miles", etc.

## Root Cause
The Tinybird pipes (`user_habits_summary` and `habit_trends`) were not including the `unit` field in their responses. They were aggregating habit data but not selecting the unit from the habit_logs table.

## Solution

### 1. Updated Tinybird Pipes

#### `user_habits_summary.pipe`
- **Changed**: Added `any(unit) as unit` to the SELECT statement
- **Was**: `min(unit) as unit` (which wasn't being used correctly in GROUP BY context)
- **Now**: Properly returns the unit for each habit in the summary

#### `habit_trends.pipe`
- **Changed**: Updated both `daily_trends` and `weekly_aggregation` nodes to use `any(unit) as unit`
- **Was**: `min(unit) as unit`
- **Now**: Properly returns the unit for each habit in the trends data

Both pipes have been deployed to Tinybird Cloud (Deployments #2 and #3).

### 2. Fixed Value Calculation Logic

#### `app/(dashboard)/analytics/page.tsx`
Updated the value calculation in both `getHabitCardData` and `getExpandedData` functions to properly handle different unit types:

**Before:**
```typescript
const value = log.total_amount || (log.total_duration ? log.total_duration / 3600 : 0) || log.completed_count || 0;
```

**After:**
```typescript
let value = 0;
if (log.total_amount > 0) {
  // For amount-based tracking (Pages, Miles, Steps, etc.)
  value = log.total_amount;
} else if (log.total_duration > 0) {
  // For duration-based tracking
  if (habit.unit === 'Minutes') {
    value = log.total_duration / 60; // Convert seconds to minutes
  } else if (habit.unit === 'Hours') {
    value = log.total_duration / 3600; // Convert seconds to hours
  } else {
    value = log.total_duration / 3600; // Default to hours
  }
} else {
  // Fallback to completed count
  value = log.completed_count || 0;
}
```

This ensures that:
- Minutes-based habits show values in minutes (not hours)
- Hours-based habits show values in hours
- Amount-based habits (Pages, Miles, Steps) show the correct amount
- The calculation matches the displayed unit

### 3. Unit Display
The UI components were already set up correctly to use `habit.unit`:
- `HabitMetricCard` component displays the unit next to the value
- Tooltip in charts shows the unit
- Expanded view displays the unit in the summary stats

All that was needed was for the backend to provide the `unit` field, which is now fixed.

## Testing

Verified that Tinybird now returns the unit field:

**user_habits_summary response:**
```json
{
  "habit_id": "091efe68-30eb-4f68-9e15-8af53e6f3ed2",
  "habit_name": "Deep Work Sessions",
  "unit": "Minutes",
  ...
}
```

**habit_trends response:**
```json
{
  "date": "2025-10-27",
  "habit_id": "091efe68-30eb-4f68-9e15-8af53e6f3ed2",
  "habit_name": "Deep Work Sessions",
  "unit": "Minutes",
  ...
}
```

## Result

After refreshing the Analytics page:
- ✅ Habit cards now display the correct unit (Minutes, Hours, Pages, Miles, Steps)
- ✅ Chart values are calculated correctly based on the unit type
- ✅ Tooltips show the correct unit
- ✅ Expanded view displays the correct unit in summary stats

## Files Modified
1. `tinybird/pipes/user_habits_summary.pipe` - Added `any(unit) as unit`
2. `tinybird/pipes/habit_trends.pipe` - Added `any(unit) as unit` to both nodes
3. `app/(dashboard)/analytics/page.tsx` - Fixed value calculation logic to handle Minutes vs Hours

## Date
October 30, 2025

