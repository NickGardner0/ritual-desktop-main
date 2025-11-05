# Debug: Voice Mode Still Slow? Here's How to Fix It! 🔧

## Step 1: Create `.env.local` file (if it doesn't exist)

In your project root (`ritual-desktop-main`), create a file called `.env.local`:

```bash
# Run this in terminal from your project root
touch .env.local
```

Then open it and add your Groq API key:

```bash
GROQ_API_KEY=gsk_your_actual_api_key_here
```

⚠️ **Important:** Make sure there are NO spaces around the `=` sign!

---

## Step 2: Verify Your API Key

1. Open `.env.local` 
2. Make sure it looks like this:

```bash
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Common mistakes:**
- ❌ `GROQ_API_KEY = gsk_...` (spaces around =)
- ❌ `GROQ_API_KEY='gsk_...'` (quotes)
- ❌ `GROQ_API_KEY="gsk_..."` (quotes)
- ✅ `GROQ_API_KEY=gsk_...` (correct!)

---

## Step 3: Restart Your Dev Server

**MUST restart for env vars to load!**

```bash
# 1. Stop current server (Ctrl+C)
# 2. Start again
npm run dev
```

---

## Step 4: Test Voice Mode

1. Click the microphone button
2. Say "I walked 2 miles"
3. **Click the mic button again** to stop instantly (don't wait!)
4. Check your terminal logs

**You should see:**
```bash
🔍 Checking API keys...
  GROQ_API_KEY: ✅ Found
  OPENAI_API_KEY: ❌ Not found (or ✅ Found)
🚀 Using Groq Whisper for transcription
✅ Transcription completed in 250ms  ← Should be under 500ms!
```

---

## If It's Still Slow:

### Check #1: Is Groq being used?

Look at terminal logs. If you see:
- ✅ `🚀 Using Groq Whisper` → Good!
- ❌ `🔄 Using OpenAI Whisper` → Groq key not loaded
- ❌ `❌ GROQ_API_KEY: Not found` → File not in right place

### Check #2: How long is transcription taking?

Look for: `✅ Transcription completed in XXXms`

- ✅ Under 500ms → Groq is working!
- ❌ Over 2000ms → Still using OpenAI

### Check #3: Are you clicking to stop?

**Pro tip:** Don't wait for auto-stop!
- Click mic button → Start recording
- Say your habit
- **Click mic button again** → Instantly stop & transcribe!

This is how SuperWhisper works - instant stop on second click.

---

## Expected Speed:

### With Groq (Fast ⚡):
- Record: 1-2 seconds (you control this)
- Transcribe: 200-500ms
- **Total: ~2 seconds**

### With OpenAI (Slow 🐌):
- Record: 3-5 seconds (auto-stop)
- Transcribe: 2-5 seconds
- **Total: ~7 seconds**

---

## Still Having Issues?

Run this command and share the output:

```bash
cat .env.local | grep GROQ
```

This will show if your key is set correctly (without revealing the full key).

---

## Where is `.env.local`?

It should be in your project root:

```
ritual-desktop-main/
├── .env.local          ← HERE!
├── app/
├── components/
├── package.json
└── ...
```

**NOT in:**
- ❌ `app/.env.local`
- ❌ `components/.env.local`
- ❌ Your home directory

✅ Root of project!

