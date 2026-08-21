# Tinybird projections

Tinybird is the remaining analytics projection. Core mutations commit in Turso first. If Tinybird is down, writes still succeed and ingest is retried from service buffers.

| Pipe / datasource | User-visible caller | Why SQL is not enough | Freshness | Source event | Rebuild | Unavailable behavior |
|---|---|---|---|---|---|---|
| `habit_logs` datasource | analytics ingest from `habits_service` | high-volume append + pipe aggregations | eventual, seconds–minutes | habit log create/update | `apps/backend/scripts/reload_tinybird_from_turso.py` | charts fall back or return empty; logs remain in Turso |
| `habit_trends` pipe | `GET /api/analytics/habits/trends` via Tinybird | multi-habit trend over long ranges | pipe lag | `habit_logs` | reload datasource then replay pipe | API 503/`require_tinybird` or empty series |
| `user_habits_summary` pipe | `GET /api/analytics/...` summary | pre-aggregated user rollup | pipe lag | `habit_logs` | reload datasource | empty summary |
| `recent_habit_logs` pipe | analytics recent-log widgets | bounded recent scan across users/habits | pipe lag | `habit_logs` | reload datasource | empty list |
| `heart_rate_1m_rollups` datasource | wearable HR charts | dense sample compaction | ingest batch | wearable HR rollup writer | re-ingest rollups | chart gap; samples stay in Turso |
| `computer_activity_summary` pipe | web/iOS/long-range computer activity | historical aggregates beyond local `activity.db` 7-day window | pipe lag | watcher sync / Tinybird ingest | rebuild from watcher daily rollups | desktop recent reads stay `local`; web/long-range returns empty/`unavailable` |

MiniSearch remains client-only for the in-modal habit picker. It is not a server projection.
