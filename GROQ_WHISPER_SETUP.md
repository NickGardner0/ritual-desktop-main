# Groq Whisper Setup - 10-20x Faster Transcription! 🚀

Your voice mode now supports **Groq Whisper**, which is **10-20x faster** than OpenAI's Whisper API!

## Quick Setup (2 minutes)

### 1. Get Your Groq API Key

1. Go to https://console.groq.com/
2. Sign up for a free account (if you don't have one)
3. Navigate to **API Keys** in the dashboard
4. Click **Create API Key**
5. Copy the key (starts with `gsk_...`)

### 2. Add to Your Environment

Add this line to your `.env.local` file:

```bash
GROQ_API_KEY=gsk_your_api_key_here
```

### 3. Restart Your Dev Server

```bash
# Stop your current server (Ctrl+C)
npm run dev
```

That's it! 🎉

---

## Speed Comparison

### OpenAI Whisper:
- Average transcription: **2-5 seconds**
- Good accuracy

### Groq Whisper:
- Average transcription: **200-500ms** ⚡
- Same accuracy (uses Whisper Large v3)
- **10-20x faster!**

---

## How It Works

The app automatically detects which API key you have:

1. **If `GROQ_API_KEY` exists** → Uses Groq (super fast!)
2. **If only `OPENAI_API_KEY` exists** → Falls back to OpenAI
3. **If neither exists** → Shows error

You can keep both keys in your `.env.local` and Groq will be preferred.

---

## Free Tier Limits

**Groq Free Tier:**
- 14,400 requests per day
- 7,000 requests per minute
- More than enough for personal use!

**Cost:** FREE for most users

---

## Testing

Try voice logging now:
1. Click the microphone button
2. Say "I walked 2 miles today"
3. Watch it transcribe **instantly** ⚡

You should see in terminal logs:
```
🚀 Using Groq Whisper for transcription
✅ Transcription completed in 250ms
```

Enjoy the speed! 🎉

