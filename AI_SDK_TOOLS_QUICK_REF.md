# AI SDK Tools - Quick Reference

## 🚀 Try It Now

```bash
# 1. Start backend
cd backend && python start.py

# 2. Start Next.js (in another terminal)
npm run dev

# 3. Visit test page
open http://localhost:3000/test-enhanced-chat
```

## 📝 Example Prompts

```
"I walked 2 miles today"           → Logs habit
"Show me my walking progress"      → Displays chart artifact
"How are all my habits doing?"     → Displays stats artifact
```

## 📦 What's Included

| Component | Path | Purpose |
|-----------|------|---------|
| Enhanced API | `app/api/chat/enhanced/route.ts` | Streaming + artifacts + memory |
| Enhanced Chat | `components/ai-habit-chat-enhanced.tsx` | Rich UI with charts |
| AI Provider | `components/ai-store-provider.tsx` | Global state wrapper |
| Test Page | `app/test-enhanced-chat/page.tsx` | Testing environment |

## 🎯 Key Features

- ✨ **Artifacts** - Stream charts, insights, analytics
- 🧠 **Memory** - Persistent conversation context  
- 🐛 **Devtools** - Visual debugging (dev mode)
- 📊 **Charts** - Recharts integration
- 🔄 **Streaming** - Real-time responses
- 🎨 **Type-safe** - Zod schemas

## 🛠️ Tools Available

| Tool | Description | Example Prompt |
|------|-------------|----------------|
| `logHabit` | Log habit activities | "I walked 2 miles" |
| `generateHabitInsight` | Habit insights + chart | "Show my walking progress" |
| `generateHabitStats` | Overall stats + charts | "Show me my stats" |

## 🔗 Integration

### Option 1: Test Page (Now)
```
Visit: /test-enhanced-chat
```

### Option 2: Dashboard (Later)
```tsx
// 1. Wrap with provider
<AIStoreProvider>
  <YourApp />
</AIStoreProvider>

// 2. Use enhanced chat
import { AIHabitChatEnhanced } from '@/components/ai-habit-chat-enhanced';
<AIHabitChatEnhanced onHabitUpdate={handleUpdate} />
```

## 📚 Documentation

- `AI_CHAT_ENHANCED_GUIDE.md` - Full feature guide
- `INTEGRATION_EXAMPLE.md` - Integration steps
- `AI_SDK_TOOLS_IMPLEMENTATION_SUMMARY.md` - Complete summary

## 🆘 Quick Troubleshooting

| Issue | Fix |
|-------|-----|
| Artifacts not showing | Use prompts like "Show me..." |
| Charts not rendering | `npm install recharts` |
| Devtools missing | Only works in dev mode |
| Memory not persisting | Expected with in-memory storage |

## 🔮 Next Steps

1. ✅ Test on `/test-enhanced-chat`
2. ✅ Try all example prompts
3. ⬜ Add more artifact types
4. ⬜ Upgrade to persistent memory
5. ⬜ Replace old chat in dashboard

## 📖 Links

- [ai-sdk-tools.dev](https://ai-sdk-tools.dev)
- [GitHub](https://github.com/midday-ai/ai-sdk-tools)
- [Midday](https://midday.ai)

---

**Everything is ready!** Visit `/test-enhanced-chat` to see it in action 🎉

