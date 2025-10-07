# Supabase Edge Functions Setup

This directory contains Supabase Edge Functions for automated tasks.

## Whoop Auto-Sync Function

Automatically syncs Whoop data for all connected users on a schedule.

### Setup Instructions

#### 1. Install Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# Or with npm
npm install -g supabase
```

#### 2. Link Your Project

```bash
# Login to Supabase
supabase login

# Link to your project (get project ref from Supabase dashboard URL)
supabase link --project-ref your-project-ref
```

#### 3. Set Environment Variables

In your Supabase dashboard:
- Go to Project Settings → Edge Functions → Add secrets

Add these secrets:
```
WHOOP_CLIENT_ID=your-whoop-client-id
WHOOP_CLIENT_SECRET=your-whoop-client-secret
```

#### 4. Deploy the Function

```bash
# Deploy the whoop-auto-sync function
supabase functions deploy whoop-auto-sync
```

#### 5. Set Up Cron Schedule

In your Supabase dashboard:
1. Go to Database → Extensions
2. Enable `pg_cron` extension
3. Go to SQL Editor and run:

```sql
-- Schedule to run every day at 6:00 AM UTC
select cron.schedule(
  'whoop-daily-sync',
  '0 6 * * *',
  $$
  select
    net.http_post(
        url:='https://your-project-ref.supabase.co/functions/v1/whoop-auto-sync',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
    ) as request_id;
  $$
);
```

Replace:
- `your-project-ref` with your actual project reference
- `YOUR_ANON_KEY` with your anon/public key from Project Settings → API

#### 6. View Cron Jobs

```sql
-- List all cron jobs
SELECT * FROM cron.job;

-- View job run history
SELECT * FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;
```

#### 7. Update Cron Schedule (Optional)

```sql
-- Change to run every 6 hours
SELECT cron.schedule(
  'whoop-daily-sync',
  '0 */6 * * *',  -- Every 6 hours
  $$ ... $$
);

-- Change to run every morning at 9:00 AM
SELECT cron.schedule(
  'whoop-daily-sync',
  '0 9 * * *',  -- 9:00 AM UTC daily
  $$ ... $$
);
```

#### 8. Delete Cron Job (if needed)

```sql
-- Unschedule the job
SELECT cron.unschedule('whoop-daily-sync');
```

## Testing the Function Manually

You can test the function manually before setting up the cron:

```bash
# Using curl
curl -L -X POST 'https://your-project-ref.supabase.co/functions/v1/whoop-auto-sync' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  --data '{}'
```

## Monitoring

### View Function Logs

```bash
# View logs for the function
supabase functions logs whoop-auto-sync

# Follow logs in real-time
supabase functions logs whoop-auto-sync --follow
```

### Check Sync Status

You can check the `last_synced_at` field in the `whoop_connections` table:

```sql
SELECT 
  user_id, 
  last_synced_at,
  is_active,
  AGE(NOW(), last_synced_at) as time_since_last_sync
FROM whoop_connections
WHERE is_active = true;
```

## Troubleshooting

### Function not running?
1. Check if pg_cron extension is enabled
2. Verify the cron job exists: `SELECT * FROM cron.job;`
3. Check job run history: `SELECT * FROM cron.job_run_details;`

### No data syncing?
1. Check function logs: `supabase functions logs whoop-auto-sync`
2. Verify Whoop credentials are set in Edge Function secrets
3. Check if users have active Whoop connections in database

### Token refresh errors?
- Ensure WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are correctly set
- Check if refresh_token is valid in whoop_connections table

## Alternative: Client-Side Auto-Sync

If you prefer client-side syncing, you can also add a periodic sync in the app:

```typescript
// In your dashboard or layout component
useEffect(() => {
  const syncWhoop = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) return
    
    await fetch('/api/integrations/whoop/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: session.user.id }),
    })
  }
  
  // Sync on mount
  syncWhoop()
  
  // Sync every 6 hours while app is open
  const interval = setInterval(syncWhoop, 6 * 60 * 60 * 1000)
  
  return () => clearInterval(interval)
}, [])
```

## Cost Considerations

- Edge Functions: Free tier includes 500,000 invocations/month
- Cron running daily = ~30 invocations/month (well within free tier)
- Each sync processes all active users in one invocation

