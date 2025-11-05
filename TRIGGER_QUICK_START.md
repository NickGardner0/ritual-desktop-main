# ⚡ Trigger.dev Quick Start - Whoop Auto Sync

## 🎯 What You Need To Do Now

### 1. Add Environment Variables (5 minutes)

**In your `.env.local` file**, add these 3 lines:

```bash
TRIGGER_SECRET_KEY=tr_dev_YOUR_KEY_HERE
PYTHON_API_URL=http://127.0.0.1:8000
INTERNAL_API_KEY=2e0150d76d30c907c17a1df72b6e070857aa2e74ea34d6ff11570be2e947a553
```

**In your `backend/.env` file**, add this line:

```bash
INTERNAL_API_KEY=2e0150d76d30c907c17a1df72b6e070857aa2e74ea34d6ff11570be2e947a553
```

### 2. Get Your Trigger.dev Secret Key

1. Go to: https://cloud.trigger.dev/orgs/ritual-1585/projects/ritual-WztW/env/dev
2. Copy the `TRIGGER_SECRET_KEY` value
3. Paste it into your `.env.local` (replace `tr_dev_YOUR_KEY_HERE`)

### 3. Start Trigger.dev Development Server

Open a **new terminal window** and run:

```bash
npm run trigger:dev
```

Keep this running! It will show you real-time logs when tasks run.

### 4. Test It Works

In your Trigger.dev dashboard, you should now see:
- ✅ Task: `sync-whoop-data`
- ✅ Schedule: `daily-whoop-sync` (9 AM daily)

Click **"Test"** on the `sync-whoop-data` task to run it manually.

---

## 🚀 For Production Launch (Before you ship in 2 weeks)

### 1. Deploy Your Tasks

```bash
npm run trigger:deploy:prod
```

### 2. Set Production Environment Variables

In Trigger.dev dashboard → **Settings** → **Environment Variables** → **prod**:
- Set `TRIGGER_SECRET_KEY` (prod version)
- Set `PYTHON_API_URL` (your production backend URL)
- Set `INTERNAL_API_KEY` (same secure key)

### 3. Enable the Schedule

Go to **Schedules** → Find `daily-whoop-sync` → Click **"Enable"** → Set timezone

---

## 📁 What Was Set Up

- ✅ `trigger.config.ts` - Configuration with your project ID
- ✅ `src/trigger/whoop-sync.ts` - Daily Whoop sync task (9 AM)
- ✅ `package.json` - Added npm scripts for Trigger.dev
- ✅ `.gitignore` - Added `.trigger/` folder
- ✅ Backend endpoint ready at `/api/integrations/whoop/sync-all`

---

## 🔧 Commands

```bash
# Start development server (keep running while developing)
npm run trigger:dev

# Deploy to staging
npm run trigger:deploy

# Deploy to production
npm run trigger:deploy:prod
```

---

## 📖 Full Documentation

See `TRIGGER_DEV_SETUP.md` for detailed information, troubleshooting, and configuration options.

---

## ✅ Done!

Your Whoop data will automatically sync every morning at 9 AM once you enable the schedule in production! 🎉

