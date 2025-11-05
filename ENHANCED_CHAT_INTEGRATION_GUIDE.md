# 🔗 Integration Guide: Enhanced Chat → Ritual App

## When You're Ready to Integrate

Once your enhanced chat works perfectly in the separate project, here's how to bring it into your Ritual app.

---

## 📋 Pre-Integration Checklist

Before integrating, make sure:

- [ ] Chat works with streaming responses
- [ ] Artifacts render correctly
- [ ] Memory/persistence works
- [ ] UI is polished
- [ ] No console errors
- [ ] You've tested it thoroughly

---

## 🎯 Integration Steps

### Step 1: Copy Component Files

```bash
# From your ritual-enhanced-chat project
cd ~/Desktop/ritual-enhanced-chat

# Copy chat components to Ritual
cp -r components/chat ~/Desktop/ritual-desktop-main/components/

# If you have any custom UI components
cp -r components/ui/* ~/Desktop/ritual-desktop-main/components/ui/
```

### Step 2: Copy API Route

```bash
# Copy the enhanced chat API route
cp -r app/api/chat ~/Desktop/ritual-desktop-main/app/api/chat-enhanced
```

### Step 3: Install Any New Dependencies

```bash
cd ~/Desktop/ritual-desktop-main

# Check what's in your enhanced chat package.json that's not in Ritual
# Install any new packages, for example:
npm install @ai-sdk-tools/store @ai-sdk-tools/artifacts @ai-sdk-tools/memory
```

### Step 4: Create the Integration Adapter

Create `lib/enhanced-chat-adapter.ts`:

```typescript
// This connects your enhanced chat to Ritual's backend

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export async function fetchRitualHabits(token: string) {
  const response = await fetch(`${PYTHON_API_BASE}/api/habits`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch habits');
  }
  
  return response.json();
}

export async function logRitualHabit(
  habitId: string,
  data: {
    date: string;
    amount?: number | null;
    duration?: number | null;
    notes?: string;
  },
  token: string
) {
  const response = await fetch(`${PYTHON_API_BASE}/api/habits/${habitId}/logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...data,
      status: 'completed',
      completed_at: new Date().toISOString(),
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to log habit');
  }
  
  return response.json();
}

// Helper to get local date (handles timezones correctly)
export function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

### Step 5: Update Enhanced Chat API to Use Ritual Backend

In your copied `app/api/chat-enhanced/route.ts`:

```typescript
import { fetchRitualHabits, logRitualHabit, getLocalDate } from '@/lib/enhanced-chat-adapter';
import { auth } from '@clerk/nextjs/server';

export async function POST(req: Request) {
  // Get Clerk auth
  const authResult = await auth();
  const token = await authResult.getToken();
  
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages } = await req.json();
  
  // Fetch real habits from Ritual backend
  const userHabits = await fetchRitualHabits(token);
  
  // ... rest of your enhanced chat logic
  // When logging a habit, use:
  // await logRitualHabit(habitId, logData, token);
}
```

### Step 6: Create New Route in Ritual

Create `app/(dashboard)/enhanced-chat/page.tsx`:

```typescript
'use client';

import { ChatInterface } from '@/components/chat/ChatInterface';
import { useUser, useAuth } from '@clerk/nextjs';

export default function EnhancedChatPage() {
  const { user } = useUser();
  const { getToken } = useAuth();

  if (!user) {
    return <div>Loading...</div>;
  }

  return (
    <div className="h-screen">
      <ChatInterface 
        userId={user.id}
        getToken={getToken}
        apiEndpoint="/api/chat-enhanced"
      />
    </div>
  );
}
```

### Step 7: Add Link in Sidebar

Update `components/sidebar.tsx` (or wherever your nav is):

```typescript
<Link 
  href="/enhanced-chat"
  className="flex items-center gap-2 px-4 py-2 hover:bg-gray-100 rounded-lg"
>
  <Sparkles className="w-5 h-5" />
  Enhanced Chat (Beta)
</Link>
```

### Step 8: Test Integration

1. **Start your Python backend**:
   ```bash
   cd ~/Desktop/ritual-desktop-main/backend
   python start.py
   ```

2. **Start Next.js**:
   ```bash
   cd ~/Desktop/ritual-desktop-main
   npm run dev
   ```

3. **Test**:
   - Go to http://localhost:3000/enhanced-chat
   - Try logging a habit: "I walked 2 miles today"
   - Check your SQLite database - the log should appear!

---

## 🐛 Debugging Integration Issues

### Issue: "Failed to fetch habits"
**Check**:
- Is Python backend running?
- Is the API URL correct in `.env.local`?
- Is Clerk auth working? (check token in console)

### Issue: "Logs not saving to database"
**Check**:
- Is the habit ID correct?
- Is the date format correct? (YYYY-MM-DD)
- Check Python backend logs for errors
- Verify the log data structure matches your backend

### Issue: "Artifacts not rendering"
**Check**:
- Did you copy all artifact components?
- Are all dependencies installed?
- Check browser console for errors

### Issue: "Memory/Chat history not working"
**Check**:
- If using Upstash, is `UPSTASH_REDIS_REST_URL` in `.env.local`?
- If using in-memory, it will reset on server restart (expected)

---

## 🔄 Rollback Plan

If something goes wrong:

1. **Don't panic** - Your classic chat still works!
2. **Check the errors** in browser console and terminal
3. **Disable the enhanced chat route** temporarily:
   ```bash
   # Rename the route to disable it
   mv app/\(dashboard\)/enhanced-chat app/\(dashboard\)/_enhanced-chat-disabled
   ```
4. **Fix issues** in your separate project first
5. **Re-integrate** when ready

---

## ✅ Success Checklist

Integration is successful when:

- [ ] Enhanced chat loads at `/enhanced-chat` route
- [ ] Messages stream properly (not all at once)
- [ ] Artifacts render correctly
- [ ] Habit logs save to SQLite database
- [ ] Logs appear in dashboard metrics immediately
- [ ] Timezone handling is correct
- [ ] No errors in console
- [ ] Memory/context works across messages
- [ ] UI looks polished

---

## 🎉 Post-Integration

Once it works:

1. **Add toggle** to switch between classic and enhanced chat
2. **Gather feedback** from testing
3. **Iterate** on any issues
4. **Gradually migrate** users to enhanced chat
5. **Eventually deprecate** classic chat (optional)

---

## 💡 Pro Tips

- **Keep both chats** running side-by-side initially
- **Test thoroughly** before removing classic chat
- **Monitor errors** closely in the first few days
- **Have a rollback plan** ready
- **Document any issues** you encounter for future reference

---

Good luck with integration! 🚀

If you get stuck, refer back to your working separate project to see what's different.

