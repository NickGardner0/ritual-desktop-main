-- Step 3: Create Optimized Database Functions
-- Run this third in your Supabase SQL Editor

-- Function to get habit metrics efficiently
CREATE OR REPLACE FUNCTION get_user_habit_metrics(user_uuid uuid, date_from date DEFAULT NULL, date_to date DEFAULT NULL)
RETURNS TABLE (
    habit_id uuid,
    habit_name text,
    total_completed bigint,
    total_duration bigint,
    total_amount numeric,
    last_completed_date date
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        h.id,
        h.name,
        COUNT(hl.id) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))::bigint,
        SUM(hl.duration) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))::bigint,
        SUM(hl.amount) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))::numeric,
        MAX(hl.date) FILTER (WHERE hl.status = 'completed' AND 
            (date_from IS NULL OR hl.date >= date_from) AND 
            (date_to IS NULL OR hl.date <= date_to))
    FROM habits h
    LEFT JOIN habit_logs hl ON h.id = hl.habit_id
    WHERE h.user_id = user_uuid
    GROUP BY h.id, h.name
    ORDER BY h.created_at DESC;
END;
$$;

-- Function to refresh materialized view (call this periodically)
CREATE OR REPLACE FUNCTION refresh_habit_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY habit_metrics_summary;
END;
$$;

-- Success message
SELECT 'Step 3 Complete: Database functions created successfully!' as status;
