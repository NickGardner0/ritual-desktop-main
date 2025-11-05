# 🚀 Performance Optimization Plan
## Making Ritual Desktop Feel Lightning Fast ⚡

Based on Jordi's approach from Zenblog, adapted for your stack.

---

## 🎯 Goal
Make every click, navigation, and interaction feel **instant**.

---

## 📊 Current Stack Analysis

**Your Stack:**
- ✅ Next.js (React framework)
- ✅ Python backend (Flask/FastAPI)
- ✅ SQLite database
- ✅ Tauri (desktop wrapper)
- ✅ Clerk auth

**Current Issues:**
- ❌ No client-side caching
- ❌ No prefetching
- ❌ Heavy re-fetching on navigation
- ❌ Synchronous loading

---

## ⚡ Phase 1: Client-Side Caching (BIGGEST IMPACT)

### Install TanStack Query

```bash
npm install @tanstack/react-query
```

### Setup Query Client

Create `lib/query-client.ts`:

```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});
```

### Wrap Your App

Update `app/layout.tsx`:

```typescript
'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <QueryClientProvider client={queryClient}>
          {/* Your existing providers */}
          {children}
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

### Convert Habits to React Query

Update `contexts/HabitsContext.tsx`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function HabitsProvider({ children }) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // Fetch habits with React Query
  const { data: habits = [], isLoading } = useQuery({
    queryKey: ['habits', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/api/habits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.json();
    },
    enabled: !!user?.id,
  });

  // Fetch logs with React Query
  const { data: habitLogs = [] } = useQuery({
    queryKey: ['habit-logs', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/api/habit-logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.json();
    },
    enabled: !!user?.id,
  });

  // Log habit mutation with optimistic update
  const logHabit = useMutation({
    mutationFn: async (logData) => {
      const token = await getToken();
      return fetch(`${API_BASE}/api/habits/${logData.habitId}/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(logData),
      });
    },
    onMutate: async (newLog) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['habit-logs'] });

      // Snapshot previous value
      const previousLogs = queryClient.getQueryData(['habit-logs']);

      // Optimistically update
      queryClient.setQueryData(['habit-logs'], (old: any) => [...old, newLog]);

      return { previousLogs };
    },
    onError: (err, newLog, context) => {
      // Rollback on error
      queryClient.setQueryData(['habit-logs'], context?.previousLogs);
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: ['habit-logs'] });
    },
  });

  return (
    <HabitsContext.Provider value={{ habits, habitLogs, logHabit, isLoading }}>
      {children}
    </HabitsContext.Provider>
  );
}
```

**Result:** Data cached, instant navigation between pages! ⚡

---

## ⚡ Phase 2: Prefetching (30 min)

### Prefetch on Hover

```typescript
// components/sidebar.tsx
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';

export function Sidebar() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  const prefetchHabits = async () => {
    await queryClient.prefetchQuery({
      queryKey: ['habits'],
      queryFn: async () => {
        const token = await getToken();
        const response = await fetch(`${API_BASE}/api/habits`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return response.json();
      },
    });
  };

  return (
    <nav>
      <Link 
        href="/dashboard" 
        onMouseEnter={prefetchHabits} // Prefetch on hover!
      >
        Dashboard
      </Link>
    </nav>
  );
}
```

**Result:** Pages load instantly when clicked! ⚡

---

## ⚡ Phase 3: Parallel Queries (15 min)

Instead of fetching habits, then logs, fetch **both at once**:

```typescript
// hooks/use-dashboard-data.ts
import { useQueries } from '@tanstack/react-query';

export function useDashboardData() {
  const results = useQueries({
    queries: [
      {
        queryKey: ['habits'],
        queryFn: fetchHabits,
      },
      {
        queryKey: ['habit-logs'],
        queryFn: fetchHabitLogs,
      },
      {
        queryKey: ['user-stats'],
        queryFn: fetchUserStats,
      },
    ],
  });

  return {
    habits: results[0].data,
    logs: results[1].data,
    stats: results[2].data,
    isLoading: results.some(r => r.isLoading),
  };
}
```

**Result:** Dashboard loads 3x faster! ⚡

---

## ⚡ Phase 4: Database Indexes (10 min)

### Check Your Indexes

```sql
-- Check existing indexes
SELECT * FROM sqlite_master WHERE type='index';

-- Add missing indexes (if needed)
CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_id ON habit_logs(habit_id);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_id ON habit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);
```

Run this in your Python backend or via `sqlite3 ritual.db`.

**Result:** Database queries 10-100x faster! ⚡

---

## ⚡ Phase 5: Remove Fading Animations (5 min)

As the comment in the Twitter post said: "remove fading animation and it's gonna be even faster"

```typescript
// Remove or reduce animation durations in your CSS/Tailwind
// Change this:
className="transition-opacity duration-300"

// To this:
className="transition-opacity duration-75" // Much faster!

// Or remove entirely:
className="" // Instant!
```

**Result:** UI feels more responsive! ⚡

---

## ⚡ Phase 6: Lazy Loading (15 min)

You're already doing this! But let's optimize:

```typescript
// app/(dashboard)/dashboard/page.tsx

// Keep lazy loading heavy components
const AIHabitChat = lazy(() => import("@/components/ai-habit-chat"));

// But preload on mount
useEffect(() => {
  // Preload AI chat component
  import("@/components/ai-habit-chat");
}, []);
```

**Result:** Components ready when user clicks! ⚡

---

## 📊 Expected Performance Improvements

| Action | Impact | Time | Risk |
|--------|--------|------|------|
| React Query | 🚀🚀🚀 | 30min | Low |
| Prefetching | 🚀🚀 | 30min | Low |
| Parallel Queries | 🚀🚀 | 15min | Low |
| DB Indexes | 🚀🚀🚀 | 10min | Very Low |
| Remove Animations | 🚀 | 5min | None |
| Lazy Loading | 🚀 | 15min | Low |

**Total Time:** ~2 hours  
**Total Impact:** App feels 5-10x faster  
**Risk:** Minimal (all backward compatible)

---

## 🧪 Testing Each Phase

After each phase:

1. **Clear browser cache** (Cmd+Shift+R)
2. **Test navigation** - Click between pages
3. **Test habit logging** - Log a habit, see instant update
4. **Check console** - No errors
5. **Feel the difference!** ⚡

---

## 🎯 Priority Order

**Start with these (highest impact, lowest risk):**

1. ✅ **Database Indexes** (10 min, huge impact)
2. ✅ **React Query** (30 min, biggest UX improvement)
3. ✅ **Prefetching** (30 min, makes navigation instant)
4. ✅ **Remove/Reduce Animations** (5 min, immediate feel)

**Then do these:**

5. Parallel Queries
6. Optimize Lazy Loading

---

## 🚨 What NOT to Do (From Jordi's Approach)

❌ **Don't migrate to Supabase** - Your Python backend is fine!  
❌ **Don't rewrite everything** - Incremental improvements work great  
❌ **Don't move to Vercel Edge** - Desktop app doesn't need it  
❌ **Don't change database** - SQLite is fast enough with indexes  

---

## 💡 Why This Works for Your Stack

**Jordi's Setup:**
- Next.js → Supabase (same data center)
- Deployed on Vercel Edge

**Your Setup:**
- Next.js → Python → SQLite (local desktop app)
- Everything is localhost!

**Your Advantage:**
- 🎯 **No network latency** (everything is local!)
- 🎯 **Just need client-side caching**
- 🎯 **Desktop = Even faster than web!**

---

## 🎉 Expected Results

**Before:**
- Click dashboard → Wait 500-1000ms → See data
- Log habit → Wait 500ms → See update
- Navigate pages → Re-fetch everything

**After:**
- Click dashboard → **INSTANT** (cached)
- Log habit → **INSTANT** (optimistic)
- Navigate pages → **INSTANT** (prefetched)

---

## 🛠️ Implementation Checklist

- [ ] Install @tanstack/react-query
- [ ] Set up QueryClient
- [ ] Wrap app with QueryClientProvider
- [ ] Convert HabitsContext to use React Query
- [ ] Add prefetching on hover
- [ ] Add database indexes
- [ ] Reduce animation durations
- [ ] Test everything
- [ ] Celebrate! 🎉

---

## 📚 Resources

- TanStack Query Docs: https://tanstack.com/query/latest
- SQLite Index Guide: https://www.sqlite.org/optoverview.html
- Performance Best Practices: https://nextjs.org/docs/pages/building-your-application/optimizing

---

**Ready to make it blazing fast?** Start with Phase 1! 🚀

