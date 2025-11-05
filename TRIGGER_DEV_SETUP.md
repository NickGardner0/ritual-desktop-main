# 🚀 Trigger.dev Production Setup for Ritual

✅ **Trigger.dev is now configured and ready!**

Your project ID: `proj_hctghowrtnzbnyrgoecx`

## 📁 Files Created

- ✅ `trigger.config.ts` - Main configuration
- ✅ `src/trigger/whoop-sync.ts` - Whoop daily sync task
- ✅ `.trigger/` added to `.gitignore`

## 🔑 Step 1: Add Environment Variables

### For Next.js (`.env.local`):

Add these variables to your `.env.local` file:

```bash
# Trigger.dev (Get from: https://cloud.trigger.dev/orgs/ritual-1585/projects/ritual-WztW/env/dev)
TRIGGER_SECRET_KEY=tr_dev_YOUR_SECRET_KEY_HERE

# Python Backend URL (update in production)
PYTHON_API_URL=http://127.0.0.1:8000

# Internal API Key (use the same key in both Next.js and Python backend)
# Here's a secure generated key for you:
INTERNAL_API_KEY=2e0150d76d30c907c17a1df72b6e070857aa2e74ea34d6ff11570be2e947a553
```

### For Python Backend (`backend/.env`):

Add this to your Python backend `.env` file:

```bash
# Internal API Key (must match the one in .env.local)
INTERNAL_API_KEY=2e0150d76d30c907c17a1df72b6e070857aa2e74ea34d6ff11570be2e947a553
```

## 🎯 Step 2: Get Your Trigger.dev Secret Key

1. Go to your Trigger.dev dashboard: https://cloud.trigger.dev/orgs/ritual-1585/projects/ritual-WztW
2. Navigate to **Settings → Environment Variables**
3. Click on the **"dev"** environment
4. Copy the `TRIGGER_SECRET_KEY` value
5. Paste it into your `.env.local` file

## 🧪 Step 3: Test in Development

Start the Trigger.dev development server:

```bash
npx trigger.dev@latest dev
```

This will:
- ✅ Connect to your Trigger.dev project
- ✅ Watch for changes in `src/trigger/`
- ✅ Make your tasks available for testing
- ✅ Show logs in real-time

**Keep this running in a separate terminal** while you develop.

## 📋 Step 4: Test the Whoop Sync Task

### Option A: Trigger from Dashboard

1. Go to https://cloud.trigger.dev/orgs/ritual-1585/projects/ritual-WztW/tasks
2. Find the `sync-whoop-data` task
3. Click **"Test"**
4. Click **"Run test"**

You'll see real-time logs of the sync happening!

### Option B: Trigger via API

```bash
curl -X POST "https://api.trigger.dev/api/v3/projects/proj_hctghowrtnzbnyrgoecx/tasks/sync-whoop-data/trigger" \
  -H "Authorization: Bearer tr_dev_YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"daysBack": 2}'
```

## 📅 Step 5: Enable the Scheduled Task

The daily sync is configured to run at **9:00 AM every day**.

### In Development:
The schedule will show up in your dashboard but won't actually run. You need to deploy to production first.

### In Production (after deployment):
1. Deploy your tasks: `npx trigger.dev@latest deploy`
2. Go to **Schedules** in your dashboard
3. Find `daily-whoop-sync`
4. Click **"Enable"**
5. Set your timezone (e.g., "America/New_York", "America/Los_Angeles", etc.)

## 🚀 Step 6: Deploy to Production

When you're ready to launch:

```bash
# Deploy your tasks to Trigger.dev
npx trigger.dev@latest deploy --env prod

# Or for staging
npx trigger.dev@latest deploy --env staging
```

After deployment:
1. Update your **production** environment variables in Trigger.dev dashboard
2. Use the **production** `TRIGGER_SECRET_KEY` in your deployed app
3. Enable the scheduled tasks in the dashboard

## 📊 What the Whoop Sync Task Does

- **Runs**: Every day at 9:00 AM (configurable)
- **Syncs**: Sleep, recovery, and workout data from Whoop API
- **For**: All users with active Whoop integrations
- **Retries**: Automatically retries up to 3 times if it fails
- **Logs**: Everything to Trigger.dev dashboard for monitoring

## 🔄 Task Configuration

### Change the Schedule

Edit `src/trigger/whoop-sync.ts`:

```typescript
export const dailyWhoopSync = schedules.task({
  id: "daily-whoop-sync",
  cron: "0 9 * * *", // Change this cron expression
  // Examples:
  // "0 10 * * *" = 10:00 AM daily
  // "0 9,14 * * *" = 9:00 AM and 2:00 PM daily
  // "0 */6 * * *" = Every 6 hours
  task: syncWhoopData,
  payload: {
    daysBack: 2, // How many days of data to sync
  },
});
```

### Add Multiple Daily Syncs

Uncomment lines 75-82 in `src/trigger/whoop-sync.ts` to add a mid-day sync at 2 PM.

## 📚 Next Steps

1. ✅ Add environment variables (Step 1)
2. ✅ Get your Trigger.dev secret key (Step 2)
3. ✅ Test in development (Step 3 & 4)
4. ✅ Deploy to production before your launch (Step 6)
5. ✅ Enable scheduled tasks in dashboard (Step 5)

## 🆘 Troubleshooting

### "No tasks found"
- Make sure `npx trigger.dev@latest dev` is running
- Check that `trigger.config.ts` has `dirs: ["./src/trigger"]`
- Verify `src/trigger/whoop-sync.ts` exists

### "INTERNAL_API_KEY not set"
- Add the key to both `.env.local` AND `backend/.env`
- Restart both your Next.js app and Python backend

### "Failed to sync Whoop data"
- Check that your Python backend is running (`python backend/start.py`)
- Verify the `PYTHON_API_URL` environment variable is correct
- Check backend logs for errors

### "401 Unauthorized"
- Verify `TRIGGER_SECRET_KEY` is correct
- Make sure you're using the key for the right environment (dev/staging/prod)

## 📖 Resources

- Trigger.dev Docs: https://trigger.dev/docs
- Your Dashboard: https://cloud.trigger.dev/orgs/ritual-1585/projects/ritual-WztW
- Cron Schedule Reference: https://crontab.guru/

## 🎉 You're All Set!

Your Whoop data will automatically sync every morning at 9 AM once you enable the scheduled task. Users will always have their latest sleep data without manually clicking "Sync Now"!

---

**Need help?** Check the Trigger.dev docs or email help@trigger.dev

