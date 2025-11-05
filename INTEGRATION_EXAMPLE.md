# Integration Example: Enhanced AI Chat

## Step 1: Update Your Layout (Recommended)

Wrap your app with the AI Store Provider in your root layout or dashboard layout:

**File: `app/(dashboard)/layout.tsx`**

```tsx
import { AIStoreProvider } from '@/components/ai-store-provider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AIStoreProvider>
      {/* Your existing layout structure */}
      {children}
    </AIStoreProvider>
  );
}
```

## Step 2: Replace AI Chat in Dashboard

**File: `app/(dashboard)/dashboard/page.tsx`**

### Before:
```tsx
const AIHabitChat = lazy(() => import("@/components/ai-habit-chat").then(m => ({ default: m.AIHabitChat })));
```

### After:
```tsx
const AIHabitChatEnhanced = lazy(() => import("@/components/ai-habit-chat-enhanced").then(m => ({ default: m.AIHabitChatEnhanced })));
```

Then use it the same way:
```tsx
<AIHabitChatEnhanced 
  onHabitUpdate={handleHabitUpdate}
/>
```

## Step 3: Test Enhanced Features

### Test 1: Basic Habit Logging
```
Input: "I walked 2 miles today"
Expected: Habit logged successfully with local timezone date
```

### Test 2: Get Insights (Artifacts)
```
Input: "Show me my walking progress"
Expected: Beautiful card with chart and insights
```

### Test 3: Get Stats (Artifacts)  
```
Input: "Show me my overall stats"
Expected: Stats card with completion rates and bar chart
```

### Test 4: Devtools (Development Mode)
```
- Open app in development mode
- Look for floating devtools panel in bottom-right
- Send a message
- See real-time tool calls and execution
```

## Step 4: Verify Everything Works

Create a simple test page to verify integration:

**File: `app/test-enhanced-chat/page.tsx`**

```tsx
"use client"

import { AIHabitChatEnhanced } from '@/components/ai-habit-chat-enhanced';
import { AIStoreProvider } from '@/components/ai-store-provider';

export default function TestEnhancedChat() {
  return (
    <AIStoreProvider>
      <div className="h-screen p-4">
        <div className="max-w-4xl mx-auto h-full">
          <h1 className="text-2xl font-bold mb-4">Enhanced AI Chat Test</h1>
          <div className="border rounded-lg h-[calc(100%-60px)]">
            <AIHabitChatEnhanced 
              onHabitUpdate={(data) => {
                console.log('Habit update:', data);
              }}
            />
          </div>
        </div>
      </div>
    </AIStoreProvider>
  );
}
```

Visit: `http://localhost:3000/test-enhanced-chat`

## Quick Comparison

### Old Chat Features:
- ✅ Log habits via natural language
- ✅ Voice input
- ✅ Basic text responses
- ❌ No visual insights
- ❌ No conversation memory
- ❌ No debugging tools
- ❌ Props drilling for state

### Enhanced Chat Features:
- ✅ Log habits via natural language  
- ✅ Voice input (can be added)
- ✅ Rich text responses
- ✅ **Visual insights with charts**
- ✅ **Persistent conversation memory**
- ✅ **Visual debugging with devtools**
- ✅ **Global state via AI Store**
- ✅ **Streaming artifacts**
- ✅ **Type-safe with Zod schemas**

## Example User Flows

### Flow 1: Morning Routine
```
User: "I meditated for 10 minutes"
AI: ✅ Logged! (habit_log tool called)

User: "I walked 2 miles"  
AI: ✅ Logged! (habit_log tool called)

User: "How's my morning routine going?"
AI: [Shows habit_stats artifact with progress]
```

### Flow 2: Weekly Review
```
User: "Show me how my walking habit is doing"
AI: [Shows habit_insight artifact with:]
    - Line chart of past 7 days
    - Current streak: 5 days
    - Weekly progress: 85%
    - Personalized insights
    - Recommendations
```

### Flow 3: Quick Stats
```
User: "Give me an overview of all my habits"
AI: [Shows habit_stats artifact with:]
    - Total habits count
    - Completed today
    - Weekly averages
    - Bar chart of top performing habits
```

## Troubleshooting

### Issue: "useChat is not a function"
**Solution:** Make sure you've installed ai-sdk-tools:
```bash
npm install ai-sdk-tools
```

### Issue: Charts not showing
**Solution:** Install recharts:
```bash
npm install recharts
```

### Issue: Artifacts not rendering
**Solution:** 
1. Check the artifact type matches your schema
2. Verify the render function returns the correct shape
3. Check browser console for errors

### Issue: Memory not working
**Solution:**
1. Verify Memory is initialized at module level (outside functions)
2. Check userId is consistent across requests
3. For production, upgrade to upstash or drizzle storage

## Performance Tips

1. **Lazy load the enhanced chat** - Already using React.lazy
2. **Use caching for expensive operations** - Add cache wrapper to tools
3. **Optimize artifact rendering** - Memoize chart components
4. **Batch memory operations** - Store multiple items at once

## Next Steps

1. ✅ Install ai-sdk-tools and dependencies
2. ✅ Create enhanced chat route and component
3. 🔄 **Test on /test-enhanced-chat page**
4. 🔄 **Replace old chat in dashboard**
5. 🔄 **Add more artifact types** (habit trends, comparisons, etc.)
6. 🔄 **Implement persistent memory** (upgrade storage)
7. 🔄 **Add caching layer** for better performance

## Getting Help

- Check the [AI Chat Enhanced Guide](./AI_CHAT_ENHANCED_GUIDE.md)
- Visit [ai-sdk-tools.dev](https://ai-sdk-tools.dev)
- See [Midday's implementation](https://github.com/midday-ai/midday) for reference

---

Ready to upgrade your AI chat experience! 🚀

