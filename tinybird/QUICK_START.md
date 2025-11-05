# Quick Start - Tinybird Migration

## TL;DR - Get Running in 10 Minutes

### 1. Install Tinybird CLI

**Check official docs**: https://www.tinybird.co/docs/cli/install

```bash
# Try npm installation (recommended)
npm install -g @tinybirdco/cli

# Or Homebrew (macOS)
brew tap tinybirdco/tinybird
brew install tinybird

# Then login
tb login
```

### 2. Install Docker (Required for Local Development)

Tinybird Local runs in Docker. Choose one:

```bash
# Option A: OrbStack (recommended for macOS - faster)
brew install --cask orbstack
open -a OrbStack

# Option B: Docker Desktop
brew install --cask docker
open -a Docker

# Option C: Colima (lightweight)
brew install colima
colima start

# Verify Docker is running
docker ps
```

### 3. Start Local Tinybird
```bash
tb local start
# Wait ~30 seconds for container to be ready
```

**Alternative**: Skip local and use cloud directly:
```bash
tb login
cd tinybird
tb --cloud deploy
# No Docker needed!
```

### 3. Deploy Data Sources
```bash
cd tinybird
tb build
tb deploy
```

### 4. Set Environment Variables
Add to `.env.local`:
```bash
TINYBIRD_LOCAL_URL=http://localhost:7181
TINYBIRD_LOCAL_TOKEN=admin local_testing@tinybird.co
TINYBIRD_ENV=local
```

### 5. Install Python Dependencies
```bash
cd python-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp env.example .env
# Edit .env with your Supabase credentials
```

### 6. Run Migration
```bash
python migrate_data.py --env local --table all
```

### 7. Test It Works
```bash
# Test query
curl "http://localhost:7181/v0/pipes/user_habits_summary.json?user_id=YOUR_USER_ID&days_back=30"
```

### 8. Update Your App
```bash
cd ../..
npm run dev
```

Visit your app - analytics endpoints are now available at:
- `/api/analytics/habits/summary`
- `/api/analytics/habits/streaks`
- `/api/analytics/whoop/summary`
- `/api/analytics/habits/trends`

## 🎉 Done!

Your app now uses Tinybird for blazing-fast analytics!

**Next steps:**
- See full migration guide: `TINYBIRD_MIGRATION_GUIDE.md`
- Deploy to cloud: `tb --cloud deploy`
- Update frontend to use new API routes

## 🐛 Troubleshooting

**Tinybird Local won't start?**
```bash
tb local stop
tb local start --reset
```

**Migration fails?**
- Check Supabase credentials in `.env`
- Verify Tinybird Local is running: `curl http://localhost:7181`

**No data in queries?**
- Run migration again: `python migrate_data.py --env local --table all`
- Check data exists: `tb datasource ls habit_logs`

