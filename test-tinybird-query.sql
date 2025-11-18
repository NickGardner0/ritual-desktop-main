-- Test Query for Tinybird Data Explorer
-- Copy and paste this into Tinybird's "Explore" section

-- Query 1: Check ALL recent data (last 7 days)
SELECT 
    date,
    timestamp,
    habit_name,
    duration,
    amount,
    unit,
    status,
    integration_id,
    whoop_metric_type,
    notes
FROM habit_logs
WHERE user_id = 'user_34540XJfN58PS69D6QJZDScb5on'
  AND date >= today() - INTERVAL 7 DAY
ORDER BY timestamp DESC
LIMIT 50;

-- Query 2: Check specifically for November 10-11, 2025
SELECT 
    date,
    timestamp,
    habit_name,
    duration,
    amount,
    status
FROM habit_logs
WHERE user_id = 'user_34540XJfN58PS69D6QJZDScb5on'
  AND date >= '2025-11-10'
ORDER BY timestamp DESC;

-- Query 3: Count total rows by date (to see data distribution)
SELECT 
    date,
    COUNT(*) as log_count
FROM habit_logs
WHERE user_id = 'user_34540XJfN58PS69D6QJZDScb5on'
GROUP BY date
ORDER BY date DESC
LIMIT 30;

