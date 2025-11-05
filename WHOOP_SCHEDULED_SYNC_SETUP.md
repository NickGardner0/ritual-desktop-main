# Whoop Automated Daily Sync Setup

This guide explains how to set up automatic daily syncing of your Whoop sleep data.

## Quick Summary

Your Whoop integration now works correctly! To automatically sync sleep data every day, you have **3 options**:

## Option 1: Trigger.dev (Recommended - Production Ready)

**Pros:** Best developer experience, built for Next.js, automatic retries, monitoring dashboard  
**Setup Time:** ~15 minutes  
**Cost:** Free tier available

### Steps:

1. **Sign up at [trigger.dev](https://trigger.dev)**
   - Create a new project
   - Copy your API key

2. **Update `trigger.config.ts`**
   ```typescript
   project: "proj_YOUR_ACTUAL_PROJECT_ID", // Replace with your project ID from dashboard
   ```

3. **Add environment variables to `.env.local`:**
   ```bash
   TRIGGER_SECRET_KEY=your_trigger_api_key
   INTERNAL_API_KEY=your_secure_random_string_here  # Generate a secure random string
   PYTHON_API_URL=http://127.0.0.1:8000  # Or your production URL
   ```

4. **Add to Python backend `.env`:**
   ```bash
   INTERNAL_API_KEY=your_secure_random_string_here  # Same as above
   ```

5. **Deploy the job:**
   ```bash
   npx trigger.dev@latest dev  # For development
   # OR
   npx trigger.dev@latest deploy  # For production
   ```

6. **Configure in Trigger.dev dashboard:**
   - Go to your project → Scheduled Tasks
   - Enable the "daily-whoop-sync-9am" task
   - Set your timezone (adjust from 9 AM if needed)

**The job will automatically run every day at 9 AM**, syncing sleep data for all users!

---

## Option 2: Supabase pg_cron + Edge Functions (Simplest for Supabase Users)

**Pros:** Native to your stack, no external dependencies, free  
**Setup Time:** ~10 minutes  
**Cost:** Free (included with Supabase)

Since you prefer Supabase for backend functionality, this is a great option!

### Steps:

1. **Create a Supabase Edge Function:**
   ```bash
   supabase functions new sync-whoop-daily
   ```

2. **Edit `supabase/functions/sync-whoop-daily/index.ts`:**
   ```typescript
   import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

   serve(async (req) => {
     const authHeader = req.headers.get('Authorization')
     if (authHeader !== `Bearer ${Deno.env.get('INTERNAL_API_KEY')}`) {
       return new Response('Unauthorized', { status: 401 })
     }

     // Call your Python backend
     const response = await fetch(`${Deno.env.get('PYTHON_API_URL')}/api/integrations/whoop/sync-all`, {
       method: 'POST',
       headers: {
         'X-Internal-Key': Deno.env.get('INTERNAL_API_KEY')!,
       },
     })

     const result = await response.json()
     return new Response(JSON.stringify(result), {
       headers: { 'Content-Type': 'application/json' },
     })
   })
   ```

3. **Deploy the function:**
   ```bash
   supabase functions deploy sync-whoop-daily
   ```

4. **Set up pg_cron in Supabase Dashboard:**
   - Go to Database → Functions
   - Run this SQL:
   ```sql
   SELECT cron.schedule(
     'whoop-daily-sync',
     '0 9 * * *',  -- Every day at 9 AM
     $$
     SELECT net.http_post(
       url:='https://YOUR_PROJECT.supabase.co/functions/v1/sync-whoop-daily',
       headers:='{"Authorization": "Bearer YOUR_INTERNAL_API_KEY"}'::jsonb
     );
     $$
   );
   ```

---

## Option 3: Python APScheduler (Simplest - No External Services)

**Pros:** Simplest, no external dependencies, runs locally  
**Setup Time:** ~5 minutes  
**Cost:** Free

### Steps:

1. **Install APScheduler:**
   ```bash
   cd backend
   pip install apscheduler
   ```

2. **Add to `backend/requirements.txt`:**
   ```
   apscheduler==3.10.4
   ```

3. **Create `backend/scheduler.py`:**
   ```python
   from apscheduler.schedulers.asyncio import AsyncIOScheduler
   from services.whoop_service import WhoopService
   from database.connection import get_db_session
   from database.models import WhoopIntegrationDB
   from sqlalchemy import select
   import asyncio
   
   async def sync_all_whoop_users():
       """Sync Whoop data for all active users"""
       print("🔄 Starting scheduled Whoop sync for all users...")
       
       whoop_service = WhoopService()
       
       async with get_db_session() as session:
           result = await session.execute(
               select(WhoopIntegrationDB).where(WhoopIntegrationDB.is_active == True)
           )
           integrations = result.scalars().all()
       
       for integration in integrations:
           try:
               print(f"🔄 Syncing Whoop data for user {integration.user_id}")
               await whoop_service.sync_whoop_data(integration.user_id, days_back=2)
               print(f"✅ Synced for user {integration.user_id}")
           except Exception as e:
               print(f"❌ Failed to sync for user {integration.user_id}: {str(e)}")
       
       print("✅ Scheduled Whoop sync completed")
   
   def start_scheduler():
       """Start the scheduler"""
       scheduler = AsyncIOScheduler()
       
       # Schedule daily at 9 AM
       scheduler.add_job(
           sync_all_whoop_users,
           'cron',
           hour=9,
           minute=0,
           id='whoop_daily_sync'
       )
       
       scheduler.start()
       print("✅ Scheduler started - Whoop sync will run daily at 9 AM")
   ```

4. **Update `backend/main.py` to start scheduler:**
   ```python
   from scheduler import start_scheduler
   
   @app.on_event("startup")
   async def startup_event():
       start_scheduler()
   ```

5. **Restart your Python backend:**
   ```bash
   python start.py
   ```

**That's it!** The sync will now run automatically every day at 9 AM.

---

## Recommended Times

- **9 AM**: Most sleep sessions from the night before will be processed
- **10 AM**: Even safer, gives Whoop more time to process data
- **Multiple times**: You can run at 9 AM, 12 PM, and 6 PM to catch any delayed processing

## Testing

To test any of these setups manually:

```bash
# Test the bulk sync endpoint
curl -X POST http://127.0.0.1:8000/api/integrations/whoop/sync-all \
  -H "X-Internal-Key: your_internal_api_key"
```

## Monitoring

All options include logging. Check:
- **Trigger.dev**: Built-in dashboard with execution history
- **Supabase**: Edge Function logs in dashboard
- **APScheduler**: Check your Python backend logs

---

## My Recommendation

For your use case, I recommend **Option 3 (APScheduler)** for development and **Option 1 (Trigger.dev)** for production because:

1. **APScheduler** is the simplest - no external signup, works immediately
2. **Trigger.dev** is production-ready with monitoring, retries, and a great dashboard
3. You already have the backend endpoint set up - it's ready to use!

Start with APScheduler today, then migrate to Trigger.dev when you're ready to deploy to production.

