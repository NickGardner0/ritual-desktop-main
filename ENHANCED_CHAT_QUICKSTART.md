# 🚀 Enhanced Chat Quick Start

## Get Started in 5 Minutes

### 1. Create Your Separate Project

```bash
# Open a NEW terminal (not in ritual-desktop-main)
cd ~/Desktop

# Create new Next.js project
npx create-next-app@latest ritual-enhanced-chat \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*"

cd ritual-enhanced-chat
```

### 2. Install AI Dependencies

```bash
# Core AI SDK
npm install ai @ai-sdk/openai zod

# Midday Tools
npm install @ai-sdk-tools/store @ai-sdk-tools/artifacts @ai-sdk-tools/memory

# UI Components
npm install lucide-react
```

### 3. Add Your OpenAI Key

```bash
# Create .env.local file
echo "OPENAI_API_KEY=your_key_here" > .env.local

# Replace with your actual key
```

### 4. Create First Chat Route

Create `app/api/chat/route.ts`:

```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: openai('gpt-4o-mini'),
    messages,
  });

  return result.toDataStreamResponse();
}
```

### 5. Create Chat UI

Replace `app/page.tsx`:

```typescript
'use client';

import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map(m => (
          <div key={m.id} className={`p-4 rounded-lg ${
            m.role === 'user' ? 'bg-blue-100 ml-auto' : 'bg-gray-100'
          } max-w-[80%]`}>
            <p className="text-sm font-semibold mb-1">
              {m.role === 'user' ? 'You' : 'AI'}
            </p>
            <p>{m.content}</p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Say something..."
          className="flex-1 p-2 border rounded-lg"
        />
        <button 
          type="submit"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

### 6. Run It!

```bash
npm run dev
```

Open `http://localhost:3000` and chat! 🎉

---

## ✅ You Should See:
- A chat interface
- Messages appearing as you type and submit
- AI responses streaming in (not all at once)

---

## 🎯 Next Steps

Once basic chat works:

1. **Add Artifacts** - Follow Midday's artifacts docs
2. **Add Memory** - Use `@ai-sdk-tools/memory`
3. **Style It** - Make it look like Pontus's demo
4. **Add Habit Logic** - Parse habit logs from messages

See `ENHANCED_CHAT_ROADMAP.md` for the full plan!

---

## 🆘 Troubleshooting

**Issue**: "Module not found: Can't resolve 'ai'"
- **Fix**: Run `npm install ai`

**Issue**: "Invalid API key"
- **Fix**: Check your `.env.local` file has `OPENAI_API_KEY=...`

**Issue**: Messages not streaming
- **Fix**: Make sure you're using `streamText` and `toDataStreamResponse()`

**Issue**: Can't see Midday features
- **Fix**: You need to follow their docs to implement artifacts/memory/etc.
  - Start here: https://github.com/midday-ai/ai-sdk-tools

---

## 📖 Learn More

- Vercel AI SDK: https://sdk.vercel.ai/docs
- Midday Tools: https://github.com/midday-ai/ai-sdk-tools
- Demo Site: https://demo.ai-sdk-tools.dev

---

**Remember**: Build it separately, test thoroughly, then integrate! 🚀

