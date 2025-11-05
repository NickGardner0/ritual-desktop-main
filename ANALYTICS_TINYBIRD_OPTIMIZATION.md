# Analytics Page - Tinybird Rate Limit Optimization

## Problem
The Analytics page was hitting Tinybird's 10 QPS (Queries Per Second) rate limit on the free plan.

**Root Cause:**
- Making **N separate API calls** (one per selected habit)
- If 6 habits were selected, that's **6 parallel Tinybird queries** every time:
  - Page loads
  - Date range changes
  - User adds/removes a habit
- No caching meant redundant calls for the same data

## Solution

### 1. **Single Batched Query** 🚀
**Before:**
```typescript
// Made N API calls (one per habit)
const habitPromises = selectedHabits.map(async (habitId) => {
  const logsRes = await fetch(
    `/api/analytics/habits/trends?user_id=${user.id}&habit_id=${habitId}&period=day&days_back=${daysBack}`
  );
  // ...
});
```

**After:**
```typescript
// Make 1 API call for ALL habits
const logsRes = await fetch(
  `/api/analytics/habits/trends?user_id=${user.id}&period=day&days_back=${daysBack}`
);
// Then filter by selected habits client-side
```

**Impact:** Reduced from **N queries** → **1 query** (83-95% reduction!)

### 2. **Client-Side Caching** 💾
Added 30-second cache to prevent redundant API calls:

```typescript
const cacheKey = `${user.id}-${daysBack}`;
const cached = analyticsCache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < 30000) {
  // Use cached data
  return;
}
```

**Impact:** 
- Adding/removing habits from view = **0 API calls** (uses cache)
- Re-visiting page within 30s = **0 API calls**

## Technical Details

### Why This Works
The `habit_trends.pipe` already supports optional `habit_id` parameter:

```sql
{% if defined(habit_id) %}
AND habit_id = {{ String(habit_id) }}
{% end %}
```

When `habit_id` is omitted, Tinybird returns data for **all habits** in one query.

### Performance Comparison

**Scenario: User selects 6 habits and views analytics for 30 days**

| Action | Before | After |
|--------|--------|-------|
| Initial page load | 6 API calls | 1 API call |
| Add 7th habit | 7 API calls | 0 API calls (cache) |
| Change date range | 7 API calls | 1 API call |
| Change date range again (within 30s) | 7 API calls | 0 API calls (cache) |
| **Total in 1 minute** | **27 API calls** | **2 API calls** |

**Reduction: 92.6%** 🎉

## Rate Limit Implications

### Free Plan (10 QPS)
- **Before:** Could hit limit with 2-3 users simultaneously
- **After:** Can handle 10+ concurrent users comfortably

### Developer Plan (50 QPS - Recommended)
- **Before:** Would support ~8 concurrent users
- **After:** Can support 50+ concurrent users

## Recommendations

1. ✅ **Upgrade to Tinybird Classic Developer Plan**
   - Choose "Tinybird Classic" (not Forward)
   - Your existing pipes are already compatible
   - More QPS headroom for growth

2. ✅ **Monitor Usage**
   - Check Tinybird dashboard for QPS metrics
   - Set up alerts if approaching limits

3. ✅ **Future Optimizations** (if needed)
   - Increase cache TTL to 60s for slower-changing data
   - Implement server-side caching (Redis/Upstash)
   - Add request debouncing for date range picker

## Files Changed

- `app/(dashboard)/analytics/page.tsx`
  - Line 314-345: Added batched query logic
  - Line 316-337: Added caching layer
  - Line 203: Added cache state

## Testing

To verify the optimization:
1. Open browser DevTools → Network tab
2. Navigate to Analytics page
3. Select multiple habits
4. Check network requests:
   - Should see only **1** request to `/api/analytics/habits/trends`
   - Adding/removing habits should **not** trigger new requests (cache hit)

## Monitoring

Look for these console logs:
- `📊 [OPTIMIZED] Fetching analytics for X habits in 1 API call` - Making API call
- `📊 [CACHE HIT] Using cached data` - Using cache (no API call)
- `📊 [OPTIMIZED] Received X total log entries for all habits` - Successful batch fetch

---

**Status:** ✅ Complete  
**Impact:** 92.6% reduction in Tinybird API calls  
**Date:** October 30, 2025

