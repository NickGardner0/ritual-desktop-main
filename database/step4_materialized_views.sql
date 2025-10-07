-- Step 4: Create Materialized Views for Fast Aggregations
-- Run this fourth in your Supabase SQL Editor

-- Create a materialized view for habit metrics (refreshed periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS habit_metrics_summary AS
SELECT 
    h.id as habit_id,
    h.user_id,
    h.name,
    h.type,
    COUNT(hl.id) FILTER (WHERE hl.status = 'completed') as total_completed,
    COUNT(hl.id) FILTER (WHERE hl.status = 'completed' AND hl.date >= CURRENT_DATE - INTERVAL '7 days') as completed_last_7_days,
    COUNT(hl.id) FILTER (WHERE hl.status = 'completed' AND hl.date >= CURRENT_DATE - INTERVAL '30 days') as completed_last_30_days,
    SUM(hl.duration) FILTER (WHERE hl.status = 'completed') as total_duration,
    SUM(hl.amount) FILTER (WHERE hl.status = 'completed') as total_amount,
    MAX(hl.date) FILTER (WHERE hl.status = 'completed') as last_completed_date
FROM habits h
LEFT JOIN habit_logs hl ON h.id = hl.habit_id
GROUP BY h.id, h.user_id, h.name, h.type;

-- Create index on the materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_metrics_summary_habit_id 
  ON habit_metrics_summary(habit_id);

CREATE INDEX IF NOT EXISTS idx_habit_metrics_summary_user_id 
  ON habit_metrics_summary(user_id);

-- Success message
SELECT 'Step 4 Complete: Materialized views created successfully!' as status;
