# Ritual Test Plan

## Overview

This document outlines the testing strategy for Ritual's production launch.

---

## 1. Unit Tests

### Backend (Python/FastAPI)

| Module | Test File | Priority | Status |
|--------|-----------|----------|--------|
| Auth Service | `backend/tests/test_auth_service.py` | P0 | ❌ TODO |
| Habits Service | `backend/tests/test_habits_service.py` | P0 | ❌ TODO |
| Whoop Service | `backend/tests/test_whoop_service.py` | P1 | ❌ TODO |
| Tinybird Service | `backend/tests/test_tinybird_service.py` | P1 | ❌ TODO |
| Wearables Service | `backend/tests/test_wearables_service.py` | P1 | ❌ TODO |
| Database Models | `backend/tests/test_backend.py` | P0 | ✅ Passing |

**Test Runner:** `pytest backend/tests/`

### Frontend (TypeScript/React)

| Module | Test File | Priority | Status |
|--------|-----------|----------|--------|
| Habits Context | `__tests__/contexts/habits.test.tsx` | P0 | ❌ TODO |
| API Client | `__tests__/lib/api-client.test.ts` | P0 | ❌ TODO |
| Use Habits Query | `__tests__/hooks/use-habits-query.test.ts` | P1 | ❌ TODO |

**Test Runner:** `npm test`

---

## 2. Integration Tests

### API Integration Tests

```python
# backend/tests/test_api_integration.py

class TestHabitsAPI:
    """Test habits CRUD operations end-to-end"""
    
    async def test_create_habit(self):
        # POST /api/habits with valid auth
        pass
    
    async def test_log_habit(self):
        # POST /api/habits/{id}/logs
        pass
    
    async def test_get_habits_list(self):
        # GET /api/habits
        pass

class TestWhoopIntegration:
    """Test Whoop OAuth and sync flow"""
    
    async def test_oauth_callback(self):
        # Handle OAuth code exchange
        pass
    
    async def test_token_refresh(self):
        # Verify token refresh works
        pass
    
    async def test_data_sync(self):
        # Verify sync creates correct records
        pass

class TestWearablesAPI:
    """Test Apple Health / iOS companion API"""
    
    async def test_device_registration(self):
        # POST /api/wearables/register
        pass
    
    async def test_metrics_ingest(self):
        # POST /api/wearables/ingest
        pass
    
    async def test_idempotency(self):
        # Verify duplicate events don't create duplicates
        pass
```

### Database Integration Tests

```python
# backend/tests/test_database_integration.py

class TestTursoConnection:
    """Verify Turso connection and queries"""
    
    async def test_connection(self):
        # Verify can connect to Turso
        pass
    
    async def test_crud_operations(self):
        # Basic CRUD on habits table
        pass
```

---

## 3. End-to-End Tests

### Smoke Test Suite (Critical Path)

| Test Case | Description | Priority |
|-----------|-------------|----------|
| Auth Flow | Sign up → Sign in → Dashboard | P0 |
| Habit CRUD | Create → Log → Edit → Delete habit | P0 |
| Whoop Connect | OAuth → Sync → View data | P1 |
| Analytics Load | Dashboard → Analytics page loads | P0 |
| Chat Works | AI chat responds to messages | P1 |
| Import Data | CSV import → habits created | P2 |

### Manual Test Checklist

```markdown
## Pre-Release Manual Testing

### Authentication
- [ ] Sign up with email works
- [ ] Sign in with email works  
- [ ] OAuth sign in works (Google, Apple)
- [ ] Sign out works
- [ ] Session persists after app restart
- [ ] JWT refresh works (stay logged in)

### Dashboard
- [ ] Habits load correctly
- [ ] Today's logs show correctly
- [ ] Can log a habit (button tap)
- [ ] Can log with value (numeric input)
- [ ] Optimistic update works (instant feedback)
- [ ] Undo log works
- [ ] Streak displays correctly

### Habit Management
- [ ] Create habit (with name, icon, type)
- [ ] Edit habit (name, icon, goal)
- [ ] Delete habit (with confirmation)
- [ ] Reorder habits (drag-drop)
- [ ] Archive habit

### Analytics
- [ ] Page loads without errors
- [ ] Charts render with data
- [ ] Date range picker works
- [ ] Habit filter works
- [ ] Correlation chart loads

### Whoop Integration
- [ ] Connect button shows
- [ ] OAuth redirect works
- [ ] Callback creates integration
- [ ] Sync fetches data
- [ ] Recovery/Sleep/Workouts display
- [ ] Disconnect works

### Apple Health (iOS)
- [ ] iOS app launches
- [ ] Device registration succeeds
- [ ] HealthKit authorization works
- [ ] Metrics sync to backend
- [ ] Data appears in dashboard

### Computer Activity
- [ ] Watcher data displays
- [ ] Daily rollup correct
- [ ] Domain breakdown shows
- [ ] Sync to habit works

### AI Chat
- [ ] Chat opens
- [ ] Messages send
- [ ] Responses stream
- [ ] Context includes habits

### Import/Export
- [ ] CSV import works
- [ ] Apple Health XML import works
- [ ] Mapping modal works
```

---

## 4. Performance Tests

### Load Testing Targets

| Endpoint | Target Response Time | Target RPS |
|----------|---------------------|------------|
| GET /api/habits | < 200ms | 100 |
| POST /api/habits/:id/logs | < 100ms | 50 |
| GET /api/analytics/summary | < 500ms | 50 |
| POST /api/watcher/ingest | < 100ms | 200 |

### Memory/Resource Tests

- Dashboard initial load < 3s
- Dashboard memory < 100MB
- No memory leaks on repeated navigation
- Tauri app bundle size < 50MB

---

## 5. Security Tests

### Authentication
- [ ] API routes require valid JWT
- [ ] Expired tokens are rejected
- [ ] Users can only access their data
- [ ] Rate limiting active on auth endpoints

### API Security
- [ ] Input validation on all endpoints
- [ ] SQL injection prevented (parameterized queries)
- [ ] XSS prevention on stored data
- [ ] CORS correctly configured

### Secrets
- [ ] No secrets in client bundle
- [ ] Env vars not exposed
- [ ] Clerk keys are test vs prod appropriate

---

## 6. Test Data Fixtures

### Golden Samples

```json
// fixtures/whoop_recovery.json
{
  "user_id": "test_user_123",
  "date": "2026-01-01",
  "recovery_score": 75,
  "hrv": 45.2,
  "resting_heart_rate": 55,
  "sleep_performance": 82.5
}

// fixtures/apple_health_metrics.json
{
  "deviceId": "test_device_123",
  "timestamp": "2026-01-01T00:00:00Z",
  "metrics": [
    {"type": "steps", "value": 10000, "unit": "count"},
    {"type": "heartRate", "value": 72, "unit": "bpm"},
    {"type": "sleepHours", "value": 7.5, "unit": "hours"}
  ]
}
```

---

## 7. Test Environment Setup

### Local Testing

```bash
# 1. Install dependencies
npm install
pip install -r backend/requirements.txt

# 2. Set up test database
export DATABASE_URL="libsql://test.turso.io?authToken=..."

# 3. Run backend tests
cd backend && pytest tests/ -v

# 4. Run frontend tests
npm test

# 5. Run E2E tests
npm run test:e2e
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - run: pip install -r backend/requirements.txt
      - run: pytest backend/tests/

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npm test
```

---

## 8. Known Gaps

| Gap | Risk | Mitigation |
|-----|------|------------|
| No E2E test framework set up | Medium | Manual testing for launch |
| Limited unit test coverage | Medium | Add tests post-launch |
| No load testing infrastructure | Low | Monitor production metrics |
| No automated security scans | Low | Manual code review |

---

*Last updated: January 2026*
