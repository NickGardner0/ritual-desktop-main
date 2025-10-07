-- Step 5: Analyze Tables and Final Optimizations
-- Run this last in your Supabase SQL Editor

-- Update table statistics for better query planning
ANALYZE habits;
ANALYZE habit_logs;
ANALYZE profiles;
ANALYZE predefined_habits;

-- Enable auto-vacuum for better maintenance
ALTER TABLE habits SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE habit_logs SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE profiles SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_analyze_scale_factor = 0.1
);

-- Final success message
SELECT 'All Steps Complete: Database optimization finished successfully! 🎉' as status,
       'Your database should now be significantly faster and more cost-effective.' as message;
