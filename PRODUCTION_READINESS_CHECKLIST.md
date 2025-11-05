# Production Readiness Checklist

Use this checklist to track your progress toward production deployment.

---

## 🔴 CRITICAL (Must Fix Before Launch)

### Security Issues
- [ ] Database removed from git (`backend/ritual.db`)
- [ ] `.env` files created with all required keys
- [ ] `INTERNAL_API_KEY` generated and set
- [ ] All API routes verify authentication (no user_id param abuse)
- [ ] CORS configured for production domains only
- [ ] Middleware protected routes (remove debug exceptions)
- [ ] No secrets in code or git history

### Configuration
- [ ] Hardcoded API URLs removed
- [ ] Environment variables validated at startup
- [ ] Database connection pooling configured
- [ ] Database indexes added (run `python backend/add_indexes.py`)

---

## 🟠 HIGH PRIORITY (Strongly Recommended)

### Code Quality
- [ ] Unused dependencies removed (`./cleanup.sh`)
- [ ] Duplicate files deleted (HabitsContext backups, etc.)
- [ ] Empty directories removed
- [ ] Supabase dead code removed from `lib/habits-service.ts`
- [ ] Console.log statements replaced with logger

### Performance
- [ ] React Query cache configured globally
- [ ] Timer widget polling replaced with events
- [ ] Lazy loading implemented for heavy components
- [ ] Database queries optimized (indexes verified)

### User Experience
- [ ] Error boundaries added
- [ ] Loading states for all async operations
- [ ] Optimistic updates with proper rollback
- [ ] Rate limiting implemented

---

## 🟡 MEDIUM PRIORITY (Before Scale)

### Maintenance
- [ ] Python requirements pinned to exact versions
- [ ] Large components split into smaller ones
- [ ] Date handling standardized (use date-fns)
- [ ] TypeScript strict mode enabled
- [ ] Duplicate code extracted to shared utilities

### Operations
- [ ] Database backup strategy implemented
- [ ] Health check endpoint enhanced
- [ ] Monitoring setup (uptime, errors, performance)
- [ ] Documentation updated (README, API docs)
- [ ] Deployment guide created

---

## 🟢 NICE TO HAVE (Post-Launch)

### Developer Experience
- [ ] Pre-commit hooks added (Husky)
- [ ] Testing suite implemented
- [ ] CI/CD pipeline configured
- [ ] Bundle size analysis run

### Production Features
- [ ] Error tracking (Sentry)
- [ ] Analytics events
- [ ] Feature flags
- [ ] A/B testing capability

---

## Quick Start (Priority Order)

### Day 1-2: Critical Fixes (6-8 hours)
```bash
# 1. Run cleanup script
./cleanup.sh
npm install

# 2. Set up environment variables
cp ENVIRONMENT_VARIABLES.md temp_reference.md
# Create .env.local and backend/.env with your keys
nano .env.local
nano backend/.env

# 3. Fix hardcoded URLs
# Edit: hooks/use-habits-query.ts
# Edit: lib/habits-service.ts

# 4. Fix API authentication
# Edit all files in: app/api/analytics/habits/
# Add: import { auth } from '@clerk/nextjs'

# 5. Set up database
./setup-db.sh

# 6. Fix CORS
# Edit: backend/main.py (lines 37-43)

# 7. Remove Supabase code
# Edit: lib/habits-service.ts (delete lines 49-307)

# 8. Test everything
npm run dev
cd backend && python main.py
```

### Day 3: High Priority (6-8 hours)
```bash
# 1. Replace console.log
# Create lib/logger.ts
# Find/replace across codebase

# 2. Fix timer polling
# Edit: app/(dashboard)/dashboard/page.tsx

# 3. Add error boundaries
# Create: components/app-error-boundary.tsx

# 4. Configure React Query
# Edit: components/providers.tsx

# 5. Remove middleware debug exceptions
# Edit: middleware.ts
```

### Day 4: Testing & Verification (4-6 hours)
```bash
# 1. Manual testing checklist
- [ ] Can sign up new user
- [ ] Can log in/out
- [ ] Can create habit
- [ ] Can log habit
- [ ] Can delete habit
- [ ] Analytics load correctly
- [ ] WHOOP integration works
- [ ] Timer widget works
- [ ] Voice input works

# 2. Security testing
- [ ] Cannot access other users' data
- [ ] Cannot access API without auth
- [ ] CORS blocks unauthorized origins
- [ ] Rate limiting works

# 3. Performance testing
- [ ] Page load < 2 seconds
- [ ] API response < 500ms
- [ ] No memory leaks (check DevTools)
- [ ] Database queries efficient
```

### Day 5: Documentation & Deployment Prep (4 hours)
```bash
# 1. Update README
# 2. Create deployment guide
# 3. Document environment setup
# 4. Set up monitoring
# 5. Create runbook for common issues
```

---

## Verification Scripts

### Check Critical Issues Fixed
```bash
./verify-fixes.sh
```

### Check Bundle Size
```bash
npm run build
# Check .next/static size
du -sh .next/static
```

### Check Dependencies
```bash
npm outdated
npm audit
```

### Check Database
```bash
cd backend
sqlite3 ritual.db <<EOF
.tables
SELECT COUNT(*) as index_count FROM sqlite_master WHERE type='index';
SELECT COUNT(*) as users FROM users;
SELECT COUNT(*) as habits FROM habits;
SELECT COUNT(*) as logs FROM habit_logs;
EOF
```

---

## Launch Day Checklist

### Pre-Launch (1 hour before)
- [ ] All critical issues resolved
- [ ] All tests passing
- [ ] Staging deployment successful
- [ ] Database backed up
- [ ] Monitoring active
- [ ] Error tracking configured
- [ ] Team notified

### Launch
- [ ] Deploy to production
- [ ] Verify health endpoint
- [ ] Test user sign-up flow
- [ ] Test critical paths
- [ ] Monitor error rates
- [ ] Check performance metrics

### Post-Launch (First 24 hours)
- [ ] Monitor error rates every 2 hours
- [ ] Check server resources (CPU, memory, disk)
- [ ] Review user feedback
- [ ] Check analytics events
- [ ] Verify integrations working
- [ ] Document any issues

---

## Key Metrics to Monitor

### Application Health
- **Uptime:** Target 99.9%
- **Error Rate:** < 0.1% of requests
- **Response Time:** p95 < 1000ms
- **Database Connections:** < 80% of pool

### User Experience
- **Page Load Time:** < 2 seconds
- **Time to Interactive:** < 3 seconds
- **Failed Requests:** < 0.5%
- **Session Duration:** Track increase

### Business Metrics
- **Daily Active Users**
- **Habits Created per User**
- **Habit Logs per Day**
- **Feature Usage** (timer, voice, analytics)

---

## Rollback Plan

If critical issues occur:

```bash
# 1. Revert to previous version
git revert HEAD
git push origin main

# 2. Redeploy previous version
# (depends on your deployment setup)

# 3. Restore database backup if needed
cp backend/backups/ritual_YYYYMMDD_HHMMSS.db backend/ritual.db

# 4. Notify users
# Post status update on your status page
```

---

## Support Resources

### Documentation
- [Full Audit Report](PRE_PRODUCTION_AUDIT_REPORT.md) - Detailed findings
- [Quick Fix Guide](QUICK_FIX_GUIDE.md) - Step-by-step fixes
- [Environment Variables](ENVIRONMENT_VARIABLES.md) - Configuration guide

### Scripts
- `./cleanup.sh` - Remove unused code and dependencies
- `./setup-db.sh` - Add database indexes
- `./verify-fixes.sh` - Verify critical fixes

### External Services
- **Clerk Dashboard:** https://dashboard.clerk.com/
- **Tinybird Console:** https://www.tinybird.co/
- **WHOOP Developer:** https://developer.whoop.com/

---

## Success Criteria

You're ready for production when:

✅ All critical issues resolved (8/8)
✅ All high-priority issues resolved (12/12)
✅ Manual testing checklist complete
✅ Security audit passed
✅ Performance benchmarks met
✅ Documentation complete
✅ Monitoring configured
✅ Team trained on deployment process

---

## Post-Production Improvements

After successful launch, consider:

1. **Week 1:** Monitor and fix any issues
2. **Week 2:** Add automated tests
3. **Week 3:** Optimize based on real usage data
4. **Week 4:** Implement medium-priority improvements

---

## Notes

- Keep this checklist updated as you progress
- Document any deviations or additional issues
- Share with your team
- Review before each deployment

---

**Last Updated:** November 1, 2025
**Next Review:** After completing critical fixes

---

## Quick Status Check

Run this to get a status overview:

```bash
#!/bin/bash
echo "🔍 Production Readiness Status"
echo "=============================="
echo ""

# Count completed items from checklist
critical_total=8
high_total=12
medium_total=9

echo "Progress Summary:"
echo "  🔴 Critical: ?/$critical_total"
echo "  🟠 High Priority: ?/$high_total"
echo "  🟡 Medium Priority: ?/$medium_total"
echo ""

# Check key files
echo "File Check:"
[ -f ".env.local" ] && echo "  ✅ .env.local exists" || echo "  ❌ .env.local missing"
[ -f "backend/.env" ] && echo "  ✅ backend/.env exists" || echo "  ❌ backend/.env missing"
[ -f "cleanup.sh" ] && echo "  ✅ cleanup.sh ready" || echo "  ❌ cleanup.sh missing"
[ -f "setup-db.sh" ] && echo "  ✅ setup-db.sh ready" || echo "  ❌ setup-db.sh missing"
echo ""

# Check git
echo "Git Status:"
if git ls-files --error-unmatch backend/ritual.db > /dev/null 2>&1; then
    echo "  ⚠️  Database in git (MUST FIX)"
else
    echo "  ✅ Database not in git"
fi
echo ""

echo "Next Steps:"
echo "  1. Review QUICK_FIX_GUIDE.md"
echo "  2. Run ./cleanup.sh"
echo "  3. Set up environment variables"
echo "  4. Fix critical issues"
echo ""
```

Save and run:
```bash
chmod +x status-check.sh
./status-check.sh
```

