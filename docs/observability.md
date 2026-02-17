# Observability & Launch Safety Net

## Overview

This document outlines the observability infrastructure for Ritual's production launch.

---

## 1. Current Implementation

### Error Tracking (Sentry)

Already integrated in the codebase:

```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

**Coverage:**
- ✅ Frontend errors (React)
- ✅ API route errors (Next.js)
- ✅ Edge function errors
- ❌ Python backend (needs setup)

### Analytics (OpenPanel)

Product analytics are configured:

```typescript
// apps/dashboard/components/openpanel-provider.tsx
<OpenPanelComponent
  clientId={process.env.OPENPANEL_CLIENT_ID}
  // ...
/>
```

**Events tracked:**
- `habit_created`
- `habit_logged`
- `habit_deleted`
- Page views

---

## 2. Logging Strategy

### Backend Structured Logging

Add to `apps/backend/services/`:

```python
# apps/backend/config/logging.py
import logging
import json
from datetime import datetime

class StructuredLogger:
    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
        
    def log(self, level: str, message: str, **context):
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": level,
            "message": message,
            "service": "ritual-backend",
            **context
        }
        getattr(self.logger, level.lower())(json.dumps(log_entry))
    
    def info(self, message: str, **context):
        self.log("INFO", message, **context)
    
    def error(self, message: str, **context):
        self.log("ERROR", message, **context)
    
    def warn(self, message: str, **context):
        self.log("WARNING", message, **context)

# Usage
logger = StructuredLogger("habits")
logger.info("Habit logged", user_id=user_id, habit_id=habit_id)
```

### Log Levels

| Level | When to Use |
|-------|-------------|
| ERROR | Exceptions, failures that need attention |
| WARN | Degraded service, retries, fallbacks |
| INFO | Key business events (habit logged, sync completed) |
| DEBUG | Detailed debugging (disabled in prod) |

### Key Log Points

```python
# Whoop sync
logger.info("whoop_sync_started", user_id=user_id)
logger.info("whoop_sync_completed", user_id=user_id, records=count)
logger.error("whoop_sync_failed", user_id=user_id, error=str(e))

# Apple Health ingest
logger.info("wearables_ingest", device_id=device_id, metrics=len(metrics))
logger.warn("wearables_duplicate", event_id=client_event_id)

# Habit operations
logger.info("habit_created", user_id=user_id, habit_id=habit_id)
logger.info("habit_logged", user_id=user_id, habit_id=habit_id, value=value)
```

---

## 3. Metrics & Dashboards

### Key Metrics to Track

| Metric | Type | Alert Threshold |
|--------|------|-----------------|
| API Error Rate | Counter | > 5% errors |
| API Latency P99 | Histogram | > 2s |
| Active Users (DAU) | Gauge | Drop > 50% |
| Whoop Sync Failures | Counter | > 10 in 1hr |
| Tinybird Ingest Failures | Counter | > 50 in 1hr |

### Suggested Metrics Service

```python
# apps/backend/config/metrics.py
from dataclasses import dataclass
from typing import Optional
import time

@dataclass
class RequestMetrics:
    endpoint: str
    method: str
    status_code: int
    duration_ms: float
    user_id: Optional[str]

class MetricsCollector:
    def track_request(self, metrics: RequestMetrics):
        # Send to metrics backend (Prometheus, DataDog, etc.)
        pass
    
    def increment(self, name: str, value: int = 1, **tags):
        pass
    
    def histogram(self, name: str, value: float, **tags):
        pass
```

### Tinybird as Metrics Store

Ritual already uses Tinybird - can add a `metrics` datasource:

```sql
-- apps/tinybird/datasources/api_metrics.datasource
SCHEMA >
    timestamp DateTime,
    endpoint String,
    method String,
    status_code UInt16,
    duration_ms Float32,
    user_id Nullable(String)

ENGINE MergeTree
ENGINE_PARTITION_KEY toYYYYMM(timestamp)
ENGINE_SORTING_KEY (timestamp, endpoint)
```

---

## 4. Rate Limiting

### Current Implementation

```python
# apps/backend/main.py
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.get("/api/habits")
@limiter.limit("100/minute")
async def get_habits():
    ...
```

### Recommended Limits

| Endpoint | Limit | Rationale |
|----------|-------|-----------|
| POST /api/habits/:id/logs | 60/min | Normal usage ~1/min |
| POST /api/watcher/ingest | 600/min | Watcher sends batches |
| POST /api/wearables/ingest | 60/min | iOS syncs periodically |
| GET /api/habits | 100/min | Page loads |
| POST /api/chat | 30/min | AI chat |
| POST /api/auth/* | 10/min | Prevent brute force |

---

## 5. Health Checks

### Backend Health Endpoint

```python
# Already in apps/backend/main.py
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }
```

### Deep Health Check

```python
@app.get("/health/deep")
async def deep_health_check():
    checks = {}
    
    # Database check
    try:
        async with get_session() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {str(e)}"
    
    # Tinybird check
    try:
        # Quick query to Tinybird
        checks["tinybird"] = "ok"
    except Exception as e:
        checks["tinybird"] = f"error: {str(e)}"
    
    all_ok = all(v == "ok" for v in checks.values())
    return {
        "status": "healthy" if all_ok else "degraded",
        "checks": checks
    }
```

---

## 6. Alerting

### Critical Alerts (Wake-up call)

| Alert | Condition | Action |
|-------|-----------|--------|
| API Down | Health check fails 3x | Page on-call |
| Error Spike | >10% error rate for 5min | Page on-call |
| Database Down | Turso connection failed | Page on-call |

### Warning Alerts (Next business hour)

| Alert | Condition | Action |
|-------|-----------|--------|
| High Latency | P99 > 2s for 15min | Slack notification |
| Whoop Sync Failures | >5 failures in 1hr | Slack notification |
| Rate Limit Hits | >100 429s in 1hr | Review for abuse |

---

## 7. Feature Flags

### Suggested Implementation

```typescript
// apps/dashboard/lib/feature-flags.ts
export const flags = {
  AI_CHAT_ENABLED: true,
  WHOOP_INTEGRATION: true,
  APPLE_HEALTH_SYNC: true,
  COMPUTER_TRACKING: true,
  NEW_ANALYTICS: false,
  
  // Kill switches
  DISABLE_WHOOP_SYNC: false,
  DISABLE_TINYBIRD_INGEST: false,
  READ_ONLY_MODE: false,
};

export function isEnabled(flag: keyof typeof flags): boolean {
  // Could fetch from remote config
  return flags[flag];
}
```

### Kill Switches

For emergency situations:

```python
# apps/backend/config/settings.py
KILL_SWITCHES = {
    "disable_whoop_sync": os.getenv("KILL_WHOOP_SYNC", "false") == "true",
    "disable_tinybird": os.getenv("KILL_TINYBIRD", "false") == "true",
    "read_only_mode": os.getenv("READ_ONLY_MODE", "false") == "true",
}
```

---

## 8. First Week of Launch Runbook

### Day 1 Checklist
- [ ] Monitor error rate every 2 hours
- [ ] Check Sentry for new error types
- [ ] Review Tinybird ingest success rate
- [ ] Check user signups and first actions
- [ ] Verify Whoop syncs completing

### Incident Response

1. **Detection**: Sentry alert or user report
2. **Triage**: Determine impact scope
3. **Mitigation**: Enable kill switch if needed
4. **Communication**: Update status page
5. **Resolution**: Deploy fix
6. **Postmortem**: Document learnings

### Rollback Procedure

```bash
# 1. Identify last good version
git log --oneline -10

# 2. Rollback frontend (Vercel)
vercel rollback [deployment-id]

# 3. Rollback backend
# SSH to server and restart with previous image

# 4. Verify health
curl https://api.ritual.so/health
```

---

## 9. Missing Components (Recommended for Post-Launch)

| Component | Priority | Effort |
|-----------|----------|--------|
| Python Sentry integration | P1 | 1 hour |
| Structured logging throughout | P1 | 4 hours |
| Metrics dashboard | P2 | 1 day |
| Automated alerting | P1 | 4 hours |
| Performance monitoring (APM) | P2 | 4 hours |
| Feature flag service | P3 | 1 day |

---

*Last updated: January 2026*

