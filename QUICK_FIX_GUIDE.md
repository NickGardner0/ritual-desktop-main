# Quick Fix Guide - Critical Issues

This guide helps you fix the **8 critical issues** that MUST be addressed before production.

## ⏱️ Time Required: 4-6 hours

---

## 1. Remove Database from Git (5 minutes)

```bash
# Remove from git tracking
git rm --cached backend/ritual.db

# Update .gitignore to block it permanently
# Open .gitignore and DELETE this line:
# !backend/ritual.db

# Commit the change
git commit -m "fix: remove database from version control"
```

**Why:** Database contains user data and should never be in git.

---

## 2. Fix Hardcoded API URLs (15 minutes)

### File: `hooks/use-habits-query.ts`

**Before (Line 19):**
```typescript
const PYTHON_API_BASE = 'http://127.0.0.1:8000';
```

**After:**
```typescript
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL;
if (!PYTHON_API_BASE) {
  throw new Error('NEXT_PUBLIC_PYTHON_API_URL must be configured');
}
```

### File: `lib/habits-service.ts`

**Before (Line 22):**
```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000'
```

**After:**
```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL;
if (!API_BASE_URL) {
  throw new Error('NEXT_PUBLIC_PYTHON_API_URL must be configured');
}
```

**Then create `.env.local`:**
```bash
NEXT_PUBLIC_PYTHON_API_URL=http://127.0.0.1:8000
```

---

## 3. Fix Authentication on API Routes (45 minutes)

### File: `app/api/analytics/habits/metrics/route.ts`

**Before:**
```typescript
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const userId = searchParams.get('user_id'); // ❌ User controls this!
  
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }
```

**After:**
```typescript
import { auth } from '@clerk/nextjs';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Use authenticated userId, not request parameter
  const searchParams = req.nextUrl.searchParams;
  const habitId = searchParams.get('habit_id');
  const daysBack = parseInt(searchParams.get('days_back') || '30');
```

**Apply this pattern to ALL analytics routes:**
- `app/api/analytics/habits/breakdown/route.ts`
- `app/api/analytics/habits/streaks/route.ts`
- `app/api/analytics/habits/summary/route.ts`
- `app/api/analytics/habits/trends/route.ts`
- `app/api/analytics/whoop/summary/route.ts`

---

## 4. Set Internal API Key (10 minutes)

```bash
# Generate a secure key
openssl rand -hex 32

# Add to backend/.env
echo "INTERNAL_API_KEY=<paste_generated_key_here>" >> backend/.env
```

**Verify it works:**
```bash
cd backend
python -c "import os; from dotenv import load_dotenv; load_dotenv(); print('✅ Set' if os.getenv('INTERNAL_API_KEY') else '❌ Not set')"
```

---

## 5. Add Database Connection Pooling (30 minutes)

### File: `backend/database/connection.py`

**Before:**
```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./ritual.db")
engine = create_async_engine(DATABASE_URL, echo=False)
```

**After:**
```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool, NullPool

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./ritual.db")

# Use connection pooling for better performance
# Note: SQLite doesn't support pooling well, use NullPool
# For PostgreSQL in production, use QueuePool
is_sqlite = "sqlite" in DATABASE_URL

engine = create_async_engine(
    DATABASE_URL, 
    echo=False,
    poolclass=NullPool if is_sqlite else QueuePool,
    pool_size=10 if not is_sqlite else None,
    max_overflow=20 if not is_sqlite else None,
    pool_pre_ping=True if not is_sqlite else False
)
```

---

## 6. Add Database Indexes (5 minutes)

```bash
# Run the existing script
cd backend
python add_indexes.py
```

**Verify:**
```bash
sqlite3 ritual.db "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';"
```

Should show indexes like:
- `idx_habit_logs_habit_id`
- `idx_habit_logs_date`
- `idx_habit_logs_habit_date`
- etc.

---

## 7. Remove Dead Supabase Code (30 minutes)

### File: `lib/habits-service.ts`

**Keep only this:**
```typescript
/**
 * Type definitions for Habits
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL;
if (!API_BASE_URL) {
  throw new Error('NEXT_PUBLIC_PYTHON_API_URL must be configured');
}

export interface Habit {
  id?: string
  name: string
  category: string
  icon?: string
  is_custom?: boolean
  integration_source?: string
  created_at?: string
  updated_at?: string
  user_id?: string
  unit_type?: string
}

export interface HabitLog {
  id?: string
  habit_id: string
  duration?: number
  amount?: number
  unit?: string
  date: string
  completed_at?: string
  status: 'completed' | 'skipped' | 'missed'
  notes?: string
}

// All actual functionality is now in HabitsContext
// Use: const { habits, logHabit, createHabit, ... } = useHabits()
```

**Delete lines 49-307** (all the Supabase service class code)

**Find and remove Supabase imports:**
```bash
grep -r "from.*supabase" --include="*.ts" --include="*.tsx" .
# Remove any found imports
```

---

## 8. Fix CORS Configuration (10 minutes)

### File: `backend/main.py`

**Before (Lines 37-43):**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://localhost:3000", "tauri://localhost"],
    allow_credentials=True,
    allow_methods=["*"],  # Too permissive
    allow_headers=["*"],  # Too permissive
)
```

**After:**
```python
# For development
ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS", 
    "http://localhost:3000,https://localhost:3000,tauri://localhost"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
```

**For production, set in `backend/.env`:**
```bash
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

---

## Verification Checklist

After fixing all issues, verify:

### 1. Environment Variables
```bash
# Frontend
cat .env.local | grep NEXT_PUBLIC_PYTHON_API_URL

# Backend
cd backend && cat .env | grep -E "(INTERNAL_API_KEY|CLERK_SECRET_KEY|TINYBIRD_TOKEN)"
```

### 2. Start Application
```bash
# Terminal 1: Backend
cd backend && python main.py

# Terminal 2: Frontend
npm run dev
```

### 3. Test Authentication
- Open http://localhost:3000
- Try to access dashboard without logging in (should redirect)
- Log in with Clerk
- Verify habits load

### 4. Test API Security
```bash
# This should fail (no auth)
curl http://localhost:8000/api/habits

# This should fail (invalid user_id param)
curl "http://localhost:3000/api/analytics/habits/metrics?user_id=someone_else"
```

### 5. Check Database
```bash
cd backend
sqlite3 ritual.db "SELECT COUNT(*) FROM sqlite_master WHERE type='index';"
# Should show multiple indexes
```

### 6. Check Git
```bash
git status
# Should NOT show backend/ritual.db

git ls-files | grep ritual.db
# Should return empty
```

---

## Quick Test Script

Save as `verify-fixes.sh`:

```bash
#!/bin/bash

echo "🔍 Verifying critical fixes..."

errors=0

# 1. Check database not in git
if git ls-files --error-unmatch backend/ritual.db > /dev/null 2>&1; then
    echo "❌ Database still in git"
    errors=$((errors+1))
else
    echo "✅ Database removed from git"
fi

# 2. Check .env files exist
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local missing"
    errors=$((errors+1))
else
    echo "✅ .env.local exists"
fi

if [ ! -f "backend/.env" ]; then
    echo "❌ backend/.env missing"
    errors=$((errors+1))
else
    echo "✅ backend/.env exists"
fi

# 3. Check for hardcoded URLs
if grep -r "127.0.0.1:8000" hooks/ lib/ --include="*.ts" | grep -v "process.env"; then
    echo "❌ Hardcoded API URLs found"
    errors=$((errors+1))
else
    echo "✅ No hardcoded API URLs"
fi

# 4. Check database indexes
index_count=$(sqlite3 backend/ritual.db "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';" 2>/dev/null)
if [ "$index_count" -lt 5 ]; then
    echo "❌ Database indexes missing (found: $index_count)"
    errors=$((errors+1))
else
    echo "✅ Database indexes present ($index_count)"
fi

echo ""
if [ $errors -eq 0 ]; then
    echo "🎉 All critical fixes verified!"
    exit 0
else
    echo "⚠️  $errors issues remain"
    exit 1
fi
```

Run with:
```bash
chmod +x verify-fixes.sh
./verify-fixes.sh
```

---

## Next Steps

After fixing these critical issues:

1. Run the full cleanup script: `./cleanup.sh`
2. Review the full audit report: `PRE_PRODUCTION_AUDIT_REPORT.md`
3. Address high-priority issues
4. Set up monitoring and error tracking
5. Perform load testing
6. Deploy to staging first

---

## Need Help?

If you encounter issues:

1. Check the full audit report for detailed explanations
2. Review environment variables guide: `ENVIRONMENT_VARIABLES.md`
3. Check backend logs: `backend/backend_debug.log`
4. Check browser console for frontend errors
5. Verify all dependencies are installed: `npm install && cd backend && pip install -r requirements.txt`

---

**Estimated Total Time:** 4-6 hours for all 8 critical fixes

Good luck with your production deployment! 🚀

