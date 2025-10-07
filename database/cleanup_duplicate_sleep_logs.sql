-- Clean up duplicate sleep logs from Whoop sync
-- This will keep only one log per user/habit/date combination

-- First, let's see how many duplicates we have
SELECT user_id, habit_id, date, COUNT(*) as count
FROM habit_logs
WHERE source = 'whoop'
GROUP BY user_id, habit_id, date
HAVING COUNT(*) > 1;

-- Delete duplicates, keeping only the most recent one
DELETE FROM habit_logs
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id, habit_id, date ORDER BY created_at DESC) as rn
    FROM habit_logs
    WHERE source = 'whoop'
  ) t
  WHERE t.rn > 1
);

-- Verify the cleanup
SELECT user_id, habit_id, date, COUNT(*) as count
FROM habit_logs
WHERE source = 'whoop'
GROUP BY user_id, habit_id, date
HAVING COUNT(*) > 1;

