# Ritual Tinybird Analytics Backend

This directory contains the Tinybird data project for Ritual's analytics backend.

## Architecture

### What's in Tinybird
- `habit_logs` - All habit activity data (time-series)
- `whoop_sleep_data` - Whoop sleep metrics
- `whoop_recovery_data` - Whoop recovery metrics  
- `whoop_workout_data` - Whoop workout/strain data

### What's in Supabase
- `profiles` - User profiles
- `habits` - Habit definitions
- `whoop_connections` - OAuth tokens and connection data
- Real-time subscriptions for UI updates

## Setup

### 1. Install Tinybird CLI

```bash
curl -fsSL https://install.tinybird.co/install.sh | bash
```

### 2. Login to Tinybird

```bash
tb login
```

### 3. Start Tinybird Local (for development)

```bash
tb local start
```

### 4. Deploy to Tinybird Local

```bash
cd tinybird
tb build
tb deploy
```

### 5. Deploy to Tinybird Cloud (production)

```bash
tb --cloud deploy
```

## Python Backend Service

The Python backend service (`/tinybird/python-service/`) handles:
- Writing data to Tinybird Events API
- Dual-write to both Supabase (transactional) and Tinybird (analytics)
- Data migration from Supabase to Tinybird

### Install Python Dependencies

```bash
cd tinybird/python-service
pip install -r requirements.txt
```

### Set Environment Variables

```bash
cp .env.example .env
# Edit .env with your credentials
```

### Run Migration

```bash
python migrate_data.py
```

## API Endpoints

All analytics queries now use Tinybird pipes (exposed as HTTP APIs):

- `GET /v0/pipes/user_habits_summary.json?user_id=xxx` - User habit dashboard
- `GET /v0/pipes/habit_streaks.json?user_id=xxx&habit_id=yyy` - Calculate streaks
- `GET /v0/pipes/whoop_analytics.json?user_id=xxx&date_range=30d` - Whoop metrics
- `GET /v0/pipes/habit_trends.json?user_id=xxx&period=week` - Habit trends over time

## Development Workflow

1. Make changes to `.datasource` or `.pipe` files
2. Test locally: `tb dev`
3. Deploy to local: `tb deploy`
4. Test API endpoints
5. Deploy to cloud: `tb --cloud deploy`

## Cost Optimization

Tinybird pricing is based on:
- Data storage (compressed, columnar)
- Query compute (pay per query)
- Data ingestion (events/second)

Expected costs for Ritual:
- ~$20-50/month for 1-10K users
- 100x cheaper than querying Supabase for analytics
- 10-100x faster query performance

