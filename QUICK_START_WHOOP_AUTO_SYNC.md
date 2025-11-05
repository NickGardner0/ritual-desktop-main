# 🎯 Quick Start: Enable Automatic Whoop Sync

Your Whoop integration is working! Now let's set up automatic daily syncing.

## ⚡ Fastest Option: APScheduler (5 minutes)

This runs directly in your Python backend - no external services needed!

### Step 1: Install APScheduler
```bash
cd backend
pip install apscheduler
```

### Step 2: Enable the scheduler in `main.py`

Add this import at the top of `backend/main.py`:
```python
from scheduler import start_scheduler
```

Then add this startup event (add anywhere after `app = FastAPI(...)`):
```python
@app.on_event("startup")
async def startup_event():
    """Start background scheduler on server startup"""
    start_scheduler()
    print("✅ Background scheduler initialized")
```

### Step 3: Restart your Python backend
```bash
# Kill the current backend (Ctrl+C if running in terminal)
# Or:
kill $(lsof -ti:8000)

# Start it again
python start.py
```

**Done!** 🎉 Your Whoop data will automatically sync every day at 9 AM.

### Optional: Change the sync time

Edit `backend/scheduler.py` line 69:
```python
hour=9,  # Change to your preferred hour (0-23)
minute=0,  # Change to your preferred minute (0-59)
```

### Optional: Add multiple sync times per day

Uncomment lines 73-81 in `backend/scheduler.py` to add a noon sync (or add more times).

---

## 🎯 Testing It Works

Test the sync manually:
```bash
curl -X POST http://127.0.0.1:8000/api/integrations/whoop/sync-all \
  -H "X-Internal-Key: test_key_123"
```

(You'll need to add `INTERNAL_API_KEY=test_key_123` to your backend `.env` file first)

---

## 🚀 For Production: Trigger.dev

When you're ready to deploy to production, see `WHOOP_SCHEDULED_SYNC_SETUP.md` for Trigger.dev setup (15 minutes).

Trigger.dev provides:
- ✅ Automatic retries if sync fails
- ✅ Web dashboard to monitor all syncs
- ✅ Email alerts on failures
- ✅ Works even if your server restarts

---

## 📊 Monitoring

Check your backend logs to see sync activity:
```bash
cd backend
tail -f backend_debug.log | grep "Whoop sync"
```

You'll see logs like:
```
🔄 [2025-10-22 09:00:00] Starting scheduled Whoop sync for all users...
✅ Synced for user user_xxxxx: {...}
✅ Scheduled Whoop sync completed: 1 successful, 0 failed
```

---

## Need Help?

- Check `WHOOP_SCHEDULED_SYNC_SETUP.md` for all options (Trigger.dev, Supabase pg_cron, APScheduler)
- The backend endpoint `/api/integrations/whoop/sync-all` is already set up and ready to use
- Default sync time is 9 AM (when Whoop has usually finished processing last night's sleep)

