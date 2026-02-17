# AI Chat Fixes - Data Access Issue

## Problem

The AI chat was saying "no data" for Sleep Duration even though the data exists in both Turso and Tinybird databases.

## Root Causes Found

### 1. **Incorrect Unit Conversion** ❌
Sleep Duration is stored in **seconds** but measured in **hours**. The system prompt was converting ALL durations to minutes:

**Before:**
```typescript
if (stat.total_duration_seconds > 0) {
  parts.push(`${Math.round(stat.total_duration_seconds / 60)} total minutes`);
}
```

This would show Sleep Duration as "24,513 minutes" instead of "408 hours", which is confusing for the AI.

**After:**
```typescript
if (stat.total_duration_seconds > 0) {
  const unit = stat.unit || '';
  if (unit.toLowerCase().includes('hour')) {
    parts.push(`${Math.round((stat.total_duration_seconds / 3600) * 10) / 10} total hours`);
    parts.push(`avg ${Math.round((stat.total_duration_seconds / stat.completed_count / 3600) * 10) / 10} hours per entry`);
  } else {
    parts.push(`${Math.round(stat.total_duration_seconds / 60)} total minutes`);
  }
}
```

### 2. **Insufficient Daily Breakdown**
The AI was only getting summary stats (30-day totals) but not day-by-day data. When asked "average for November", it couldn't calculate because it didn't have individual daily values.

**Fix:** Added detailed daily trends to the system prompt:
```typescript
DAILY TRENDS (Last 30 Days - for calculating averages and analyzing patterns):
- Sleep Duration:
  2025-11-26: 8.3 hours
  2025-11-25: 7.8 hours
  2025-11-24: 8.1 hours
  ...
```

### 3. **Missing Instructions for Month-Specific Queries**
The system prompt didn't explicitly tell the AI how to handle month-specific questions.

**Fix:** Added instructions:
```
- If asked about a specific month (like November), calculate the average from the daily entries shown in the data
- For time-based metrics, durations are stored in seconds - convert appropriately
```

### 4. **Added Debug Logging**
To help diagnose issues, added extensive logging:
- What data is fetched from Tinybird
- How it's formatted into context
- Full system prompt preview (first 2000 chars)
- Whether each data source is included

## How to Test

1. **Restart your Next.js dev server** (if not auto-reloaded)
2. **Ask the AI about sleep:**
   - "What was my average sleep duration for November?"
   - "How much did I sleep last week?"
   - "Show me my sleep trends"

3. **Check the terminal logs** for:
   ```
   ✅ Fetched Tinybird summary: [data]
   ✅ Fetched Tinybird trends: [data]
   🔍 Building Tinybird context from summary data
   ✅ Tinybird context built, length: [number]
   📋 System prompt preview: [prompt]
   ```

4. **The AI should now:**
   - See all your Sleep Duration data
   - Calculate correct averages
   - Show specific dates and hours
   - Provide accurate insights

## What the AI Now Has Access To

### Summary Data (30-day totals):
```
- Sleep Duration: 25 entries, 408.5 total hours, avg 16.3 hours per entry, last: 2025-11-26
```

### Daily Trends (for month calculations):
```
- Sleep Duration:
  2025-11-26: 8.3 hours
  2025-11-25: 7.8 hours
  2025-11-24: 8.1 hours
  ... (all days in November)
```

With this detailed day-by-day data, the AI can now:
- Calculate monthly averages
- Identify patterns
- Compare weeks
- Provide accurate insights

## Files Modified

1. `apps/dashboard/app/api/chat/stream/route.ts`
   - Fixed unit conversion for hour-based habits
   - Added detailed daily trends to context
   - Improved system prompt instructions
   - Added comprehensive debug logging

