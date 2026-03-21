# Release Checklist

## Pre-Release (48 hours before)

### Code Freeze
- [ ] All features complete and merged to main
- [ ] No pending critical PRs
- [ ] Version number updated
- [ ] CHANGELOG updated

### Build Verification
- [ ] `npm run build` passes
- [ ] `npm run lint` passes (or warnings acceptable)
- [ ] Python backend tests pass: `pytest apps/backend/tests/`
- [ ] No TypeScript errors

---

## Environment Configuration

### Production Clerk Keys
- [ ] Switch from test keys to production keys
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`
- [ ] `CLERK_SECRET_KEY=sk_live_...`
- [ ] Verify OAuth callbacks point to production domain

### Production Tinybird
- [ ] Tinybird workspace deployed: `tb push`
- [ ] Production token created with read/write access
- [ ] `TINYBIRD_TOKEN=p.ey...` set
- [ ] `TINYBIRD_API_URL=https://api.us-east.aws.tinybird.co`

### Production Turso
- [ ] Production database created
- [ ] Schema migrations applied
- [ ] `DATABASE_URL` points to production
- [ ] Backup configured
- [ ] `TURSO_LOCAL_ENCRYPTION_KEY` set in production

### Production Plaid
- [ ] Production Plaid access approved
- [ ] `PLAID_CLIENT_ID` and `PLAID_SECRET` set
- [ ] `PLAID_ENV=production`
- [ ] `PLAID_REDIRECT_URI` points to production integration URL
- [ ] `PLAID_WEBHOOK_URL` points to production backend webhook URL
- [ ] `TOKEN_ENCRYPTION_KEY` set

### Production Whoop
- [ ] OAuth app approved by Whoop
- [ ] Production redirect URI configured
- [ ] `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` set

### Other Services
- [ ] `OPENAI_API_KEY` has production quota
- [ ] `SENTRY_DSN` points to production project
- [ ] `OPENPANEL_CLIENT_ID` set

---

## Database Migrations

### Turso Migration Script

```bash
# 1. Backup current production data
turso db shell ritual-prod ".dump" > backup-$(date +%Y%m%d).sql

# 2. Apply migrations
# (No automated migration tool - using SQLAlchemy models)

# 3. Verify tables
turso db shell ritual-prod ".tables"

# 4. Verify critical tables have data
turso db shell ritual-prod "SELECT COUNT(*) FROM habits"
```

### Required Tables
- [ ] `users`
- [ ] `habits`
- [ ] `habit_logs`
- [ ] `whoop_integrations`
- [ ] `wearable_devices`
- [ ] `wearable_metrics`
- [ ] `wearable_ingest_events`
- [ ] `watcher_devices`
- [ ] `activity_events`
- [ ] `ai_conversations`
- [ ] `ai_messages`

---

## Tinybird Deployment

```bash
# 1. Login to Tinybird CLI
tb auth

# 2. Set production workspace
tb workspace use ritual-production

# 3. Push all datasources and pipes
tb push --force

# 4. Verify endpoints
tb pipe ls
tb datasource ls

# 5. Test a pipe
tb pipe data habit_logs_summary --limit 5
```

### Required Pipes
- [ ] `habit_logs_summary`
- [ ] `habit_trends`
- [ ] `habit_streaks`
- [ ] `habit_correlation`
- [ ] `analytics_summary`
- [ ] `whoop_analytics`
- [ ] `computer_activity_summary`

---

## Desktop App (Tauri)

### macOS Build
```bash
# 1. Install Rust toolchain
rustup update stable

# 2. Build for release
cd apps/desktop/src-tauri
cargo build --release

# 3. Bundle
npm run tauri:build
```

### Code Signing
- [ ] Apple Developer certificate installed
- [ ] Notarization credentials configured
- [ ] `APPLE_ID` and `APPLE_PASSWORD` set
- [ ] Build notarized successfully

### Distribution
- [ ] DMG uploaded to distribution server
- [ ] Auto-update endpoint configured (if enabled)
- [ ] Version metadata published

---

## iOS Companion

### TestFlight
- [ ] Archive created in Xcode
- [ ] Uploaded to App Store Connect
- [ ] TestFlight build approved
- [ ] Internal testers notified

### App Store (if public release)
- [ ] App description updated
- [ ] Screenshots uploaded
- [ ] Privacy policy URL set
- [ ] Submit for review

---

## Backend Deployment

### Deployment Steps
```bash
# 1. Build Docker image (if using Docker)
docker build -t ritual-backend:v1.0.0 ./backend

# 2. Push to registry
docker push registry.example.com/ritual-backend:v1.0.0

# 3. Deploy to production
# (platform-specific: Railway, Render, Fly.io, etc.)

# 4. Verify health
curl https://api.ritual.so/health
```

### Environment Verification
- [ ] All env vars set in production
- [ ] CORS allows production domain
- [ ] Rate limiting configured
- [ ] SSL certificate valid
- [ ] Admin/vendor accounts use MFA for critical systems
- [ ] Plaid tokens encrypted at rest
- [ ] Embedded Turso replica encrypted at rest

---

## Frontend Deployment

### Vercel (or similar)
- [ ] Production branch set to `main`
- [ ] Environment variables configured
- [ ] Domain pointed correctly
- [ ] SSL active

### Deployment Verification
```bash
# Check production is serving
curl -I https://ritual.so

# Check API proxy working
curl https://ritual.so/api/health
```

---

## Smoke Tests (Post-Deploy)

### Critical Path
- [ ] Can access https://ritual.so
- [ ] Sign up flow works
- [ ] Sign in flow works
- [ ] Dashboard loads habits
- [ ] Can create a habit
- [ ] Can log a habit
- [ ] Analytics page loads
- [ ] AI chat responds

### Integrations
- [ ] Whoop OAuth flow works
- [ ] Whoop sync fetches data
- [ ] iOS companion can register
- [ ] iOS companion can ingest metrics

### Desktop App
- [ ] App launches
- [ ] Can sign in
- [ ] Habits sync from server
- [ ] Computer tracking works (if Watcher installed)

---

## Rollback Plan

### Frontend Rollback
```bash
# Vercel
vercel rollback [previous-deployment-id]
```

### Backend Rollback
```bash
# Docker/Kubernetes
kubectl rollout undo deployment/ritual-backend

# Or redeploy previous version
docker pull registry.example.com/ritual-backend:v0.9.0
```

### Database Rollback
```bash
# Restore from backup
turso db shell ritual-prod < backup-YYYYMMDD.sql
```

---

## Known Issues

| Issue | Severity | Workaround | ETA for Fix |
|-------|----------|------------|-------------|
| ESLint v9 config needs migration | Low | Using --max-warnings | Post-launch |
| No E2E test suite | Medium | Manual testing | Sprint 2 |
| Python backend needs Sentry | Low | Manual log review | Week 1 |

---

## Communication

### Internal
- [ ] Team notified of launch time
- [ ] On-call rotation set
- [ ] Slack channel monitored

### External
- [ ] Status page ready (statuspage.io, etc.)
- [ ] Support email monitored
- [ ] Social media announcement drafted

---

## Post-Launch Monitoring (First 24 hours)

### Hour 1
- [ ] Error rate < 1%
- [ ] Response times normal
- [ ] No Sentry alerts

### Hour 6
- [ ] User signups as expected
- [ ] Habit logs being created
- [ ] Whoop syncs completing

### Hour 24
- [ ] DAU meets baseline
- [ ] No critical bugs reported
- [ ] Tinybird ingestion healthy

---

*Last updated: January 2026*
