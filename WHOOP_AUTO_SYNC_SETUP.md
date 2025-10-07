# ✅ Whoop Auto-Sync Setup Complete

## Status: Edge Function Deployed! 🎉

Your Whoop auto-sync Edge Function has been successfully deployed to:
```
https://bvwgycgdmrozxfmyxpuy.supabase.co/functions/v1/whoop-auto-sync
```

---

## 📋 Next Steps to Complete Setup

### Step 4: Add Whoop Credentials to Edge Function Secrets

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/bvwgycgdmrozxfmyxpuy
2. Navigate to: **Project Settings → Edge Functions → Secrets**
3. Add these two secrets:

   ```
   WHOOP_CLIENT_ID
   b124c08c-ebb4-4d1b-9be7-0dc788a8f38e
   ```

   ```
   WHOOP_CLIENT_SECRET
   3e97e3d62d9fccd3195f9b1838520ff81f6cf3745673084f6bb6d4d6d8d83ba1
   ```

### Step 5: Set Up Automatic Daily Sync

1. Go to: **SQL Editor** in your Supabase dashboard
2. Copy the SQL from `database/setup_whoop_cron.sql`
3. **IMPORTANT**: Replace `YOUR_ANON_KEY` with your actual anon key from:
   - **Project Settings → API → Project API keys → anon/public**
4. Run the SQL script

This will:
- Enable `pg_cron` and `pg_net` extensions
- Schedule daily sync at 6:00 AM UTC
- Create a cron job that calls your Edge Function

---

## 🧪 Test the Function Manually (Optional)

Before setting up the cron, test the function works:

```bash
curl -L -X POST 'https://bvwgycgdmrozxfmyxpuy.supabase.co/functions/v1/whoop-auto-sync' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  --data '{}'
```

Replace `YOUR_ANON_KEY` with your anon key from the dashboard.

You should see a response like:
```json
{
  "message": "Whoop auto-sync completed",
  "results": [...],
  "total_users": 1
}
```

---

## 🔍 Monitor Your Auto-Sync

### View Edge Function Logs
```bash
supabase functions logs whoop-auto-sync
```

### Check Last Sync Time
Run this in SQL Editor:
```sql
SELECT 
  user_id, 
  last_synced_at,
  is_active,
  AGE(NOW(), last_synced_at) as time_since_last_sync
FROM whoop_connections
WHERE is_active = true;
```

### View Cron Job History
```sql
SELECT 
  start_time,
  end_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'whoop-daily-sync')
ORDER BY start_time DESC
LIMIT 10;
```

---

## ⏰ Sync Schedule

Currently set to: **Daily at 6:00 AM UTC**

This means:
- **West Coast (PST/PDT)**: 10:00 PM / 11:00 PM
- **East Coast (EST/EDT)**: 1:00 AM / 2:00 AM
- **UK (GMT/BST)**: 6:00 AM / 7:00 AM

Your Whoop data will be automatically synced every morning before you wake up!

---

## 💡 How It Works

1. **Cron Job**: Runs daily at 6:00 AM UTC
2. **Edge Function**: Gets triggered by cron
3. **Fetches Data**: Pulls last 7 days of Whoop data for all connected users
4. **Token Refresh**: Automatically refreshes expired tokens
5. **Stores Data**: Inserts into `habit_logs` table with `source='whoop'`
6. **Dashboard Updates**: Your dashboard automatically shows the synced data

---

## 🛠️ Troubleshooting

### Sync not working?
1. Check Edge Function secrets are set correctly
2. View function logs: `supabase functions logs whoop-auto-sync`
3. Verify cron job exists: `SELECT * FROM cron.job WHERE jobname = 'whoop-daily-sync';`

### No data appearing?
1. Check if you have active Whoop connection: `SELECT * FROM whoop_connections;`
2. Verify you've created the Whoop habits (Sleep Duration, Recovery Score, etc.)
3. Check habit_logs for source='whoop': `SELECT * FROM habit_logs WHERE source = 'whoop';`

### Want to trigger sync now?
- Use the "Sync Now" button on the integrations page
- Or call the Edge Function manually (see test command above)

---

## 📝 Files Created

- `supabase/functions/whoop-auto-sync/index.ts` - Edge Function code
- `database/setup_whoop_cron.sql` - SQL to set up cron job
- `supabase/functions/README.md` - Detailed documentation

---

## ✨ Benefits

✅ **Automatic**: No manual syncing needed  
✅ **All Users**: Syncs everyone's data in one run  
✅ **Cost Efficient**: ~30 runs/month (well within free tier)  
✅ **Token Management**: Handles token refresh automatically  
✅ **Reliable**: Runs even when app is closed  
✅ **Keep Manual Sync**: "Sync Now" button still works for immediate updates

