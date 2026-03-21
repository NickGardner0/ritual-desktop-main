"""
Seed demo habit logs for landing page screenshots.
Generates 3 months of realistic fake data for specified habits.
Uses Turso HTTP API + Tinybird Events API directly (no local file locks).

Usage:
    cd apps/backend && python scripts/seed_demo_logs.py
    cd apps/backend && python scripts/seed_demo_logs.py --dry-run
    cd apps/backend && python scripts/seed_demo_logs.py --undo
    cd apps/backend && python scripts/seed_demo_logs.py --sync-tinybird
"""

import asyncio
import uuid
import json
import random
import argparse
import os
import httpx
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from dotenv import load_dotenv

os.chdir(Path(__file__).parent.parent)
load_dotenv()

SEED_SOURCE = "demo_seed_v1"

# ─── Turso HTTP API helpers ─────────────────────────────────────────────────

def _turso_config():
    db_url = os.getenv("DATABASE_URL", "")
    parsed = urlparse(db_url)
    query_params = parse_qs(parsed.query)
    auth_token = query_params.get("authToken", [None])[0]
    if not auth_token:
        # Try separate env var
        auth_token = os.getenv("DATABASE_AUTH_TOKEN", "")
    host = parsed.netloc
    return f"https://{host}", auth_token


async def turso_execute(statements: list[dict], http: httpx.AsyncClient) -> dict:
    """Execute statements via Turso HTTP API."""
    url, token = _turso_config()
    resp = await http.post(
        f"{url}/v2/pipeline",
        headers={"Authorization": f"Bearer {token}"},
        json={"requests": [{"type": "execute", "stmt": s} for s in statements] + [{"type": "close"}]},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


async def turso_query(sql: str, http: httpx.AsyncClient, args: list | None = None) -> list[list]:
    """Run a single query and return rows."""
    stmt = {"sql": sql}
    if args:
        stmt["args"] = [{"type": "text", "value": str(a)} if isinstance(a, str) else
                         {"type": "integer", "value": str(a)} if isinstance(a, int) else
                         {"type": "float", "value": str(a)} if isinstance(a, float) else
                         {"type": "null"} for a in args]
    result = await turso_execute([stmt], http)
    rows_data = result["results"][0]["response"]["result"]["rows"]
    return [[col.get("value") for col in row] for row in rows_data]


# ─── Tinybird helpers ───────────────────────────────────────────────────────

def _tinybird_config():
    base_url = os.getenv("TINYBIRD_API_URL", "https://api.us-east.aws.tinybird.co")
    token = os.getenv("TINYBIRD_TOKEN", "")
    return base_url, token


async def tinybird_ingest(events: list[dict], http: httpx.AsyncClient) -> dict:
    """Ingest events to Tinybird habit_logs datasource via Events API."""
    base_url, token = _tinybird_config()
    ndjson = "\n".join(json.dumps(e) for e in events)
    resp = await http.post(
        f"{base_url}/v0/events?name=habit_logs",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        content=ndjson,
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


async def tinybird_delete(condition: str, http: httpx.AsyncClient) -> dict:
    """Delete from Tinybird datasource by condition."""
    base_url, token = _tinybird_config()
    resp = await http.post(
        f"{base_url}/v0/datasources/habit_logs/delete",
        headers={"Authorization": f"Bearer {token}"},
        data={"delete_condition": condition},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


# ─── Data generation ────────────────────────────────────────────────────────

HABIT_CONFIGS = {
    "daily reading": {
        "amount_range": (5, 30),
        "unit": "pages",
        "skip_chance": 0.20,
        "weekend_boost": 1.3,
        "trend": "gradual_increase",
    },
    "morning workout": {
        "duration_range": (1200, 3600),
        "amount_range": (0.33, 1.0),
        "unit": "hours",
        "skip_chance": 0.25,
        "weekend_boost": 1.0,
        "trend": "consistent",
    },
    "coding": {
        "duration_range": (3600, 21600),
        "amount_range": (1.0, 6.0),
        "unit": "hours",
        "skip_chance": 0.12,
        "weekend_boost": 0.5,
        "trend": "consistent",
    },
    "steps": {
        "amount_range": (3000, 12000),
        "unit": "steps",
        "skip_chance": 0.05,
        "weekend_boost": 1.2,
        "trend": "gradual_increase",
    },
    "screen time": {
        "amount_range": (1.5, 5.0),
        "unit": "hours",
        "skip_chance": 0.05,
        "weekend_boost": 1.15,
        "trend": "gradual_decrease",
    },
    "heart rate": {
        "amount_range": (58, 78),
        "unit": "bpm",
        "skip_chance": 0.08,
        "weekend_boost": 1.0,
        "trend": "consistent",
    },
    "daily walk": {
        "amount_range": (0.5, 3.0),
        "unit": "miles",
        "skip_chance": 0.18,
        "weekend_boost": 1.4,
        "trend": "gradual_increase",
    },
    "spending": {
        "amount_range": (4, 120),
        "unit": "dollars",
        "skip_chance": 0.10,
        "weekend_boost": 1.5,
        "trend": "consistent",
    },
}


def generate_logs_for_habit(habit_id: str, habit_name: str, user_id: str, days: int = 90):
    config_key = habit_name.strip().lower()
    config = HABIT_CONFIGS.get(config_key)
    if not config:
        for key in HABIT_CONFIGS:
            if key in config_key or config_key in key:
                config = HABIT_CONFIGS[key]
                break
    if not config:
        print(f"  ⚠️  No config for '{habit_name}', skipping")
        return []

    logs = []
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    for day_offset in range(days, -1, -1):  # include today (day_offset=0)
        date = today - timedelta(days=day_offset)
        date_str = date.strftime("%Y-%m-%d")

        if random.random() < config["skip_chance"]:
            continue

        lo, hi = config["amount_range"]
        amount = random.uniform(lo, hi)

        if date.weekday() >= 5:
            amount *= config.get("weekend_boost", 1.0)

        progress = 1.0 - (day_offset / days)
        trend = config.get("trend", "consistent")
        if trend == "gradual_increase":
            amount *= (0.7 + 0.6 * progress)
        elif trend == "gradual_decrease":
            amount *= (1.3 - 0.6 * progress)

        amount *= random.uniform(0.88, 1.12)
        amount = max(lo, min(hi, amount))

        if config["unit"] in ("steps", "bpm", "pages"):
            amount = round(amount)
        else:
            amount = round(amount, 2)

        if config_key == "morning workout":
            hour = random.randint(6, 9)
        elif config_key == "daily reading":
            hour = random.choice([7, 8, 21, 22, 23])
        elif config_key == "coding":
            hour = random.randint(17, 23)
        else:
            hour = random.randint(8, 22)

        completed_at = date.replace(hour=hour, minute=random.randint(0, 59))

        duration = None
        if "duration_range" in config:
            dur_lo, dur_hi = config["duration_range"]
            duration = random.randint(dur_lo, dur_hi)

        logs.append({
            "id": str(uuid.uuid4()),
            "habit_id": habit_id,
            "habit_name": habit_name,
            "user_id": user_id,
            "date": date_str,
            "completed_at": completed_at.isoformat(),
            "status": "completed",
            "amount": amount,
            "duration": duration,
            "source": SEED_SOURCE,
            "unit": config["unit"],
        })

    return logs


# ─── DB operations via Turso HTTP API ───────────────────────────────────────

async def get_user_and_habits(http: httpx.AsyncClient):
    rows = await turso_query("SELECT id FROM users LIMIT 1", http)
    if not rows:
        print("❌ No users found in database")
        return None, []

    user_id = rows[0][0]
    print(f"👤 User: {user_id}")

    habit_rows = await turso_query(
        "SELECT id, name, unit_type, category FROM habits WHERE user_id = ? ORDER BY name",
        http, [user_id]
    )
    habits = [{"id": r[0], "name": r[1], "unit_type": r[2], "category": r[3]} for r in habit_rows]
    print(f"📋 Found {len(habits)} habits:")
    for h in habits:
        print(f"   - {h['name']} ({h['unit_type'] or 'no unit'}) [{h['id'][:8]}...]")

    return user_id, habits


async def insert_logs_turso(logs: list, http: httpx.AsyncClient):
    """Insert logs into Turso via HTTP API in batches."""
    batch_size = 50
    for i in range(0, len(logs), batch_size):
        batch = logs[i:i + batch_size]
        stmts = []
        for log in batch:
            stmts.append({
                "sql": """INSERT INTO habit_logs (id, habit_id, habit_name, date, completed_at,
                          status, amount, duration, notes, source, log_metadata)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                "args": [
                    {"type": "text", "value": log["id"]},
                    {"type": "text", "value": log["habit_id"]},
                    {"type": "text", "value": log["habit_name"]},
                    {"type": "text", "value": log["date"]},
                    {"type": "text", "value": log["completed_at"]},
                    {"type": "text", "value": log["status"]},
                    {"type": "float", "value": log["amount"]},
                    {"type": "integer", "value": str(log["duration"])} if log["duration"] else {"type": "null"},
                    {"type": "null"},
                    {"type": "text", "value": log["source"]},
                    {"type": "null"},
                ],
            })
        await turso_execute(stmts, http)
        print(f"   Turso: {min(i + batch_size, len(logs))}/{len(logs)}")


async def ingest_logs_tinybird(logs: list, user_id: str, habits: list, http: httpx.AsyncClient):
    """Ingest logs to Tinybird in batches."""
    habit_units = {h["id"]: h["unit_type"] or "none" for h in habits}
    batch_size = 500
    total = 0

    for i in range(0, len(logs), batch_size):
        batch = logs[i:i + batch_size]
        events = []
        for log in batch:
            completed_at = log["completed_at"]
            try:
                ts = datetime.fromisoformat(completed_at).strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

            events.append({
                "id": log["id"],
                "habit_id": log["habit_id"],
                "habit_name": log["habit_name"],
                "user_id": user_id,
                "date": log["date"],
                "timestamp": ts,
                "status": log["status"],
                "duration": log["duration"] or 0,
                "amount": float(log["amount"]),
                "unit": habit_units.get(log["habit_id"], log.get("unit", "none")),
                "notes": "none",
                "source": log["source"],
                "integration_id": "none",
                "whoop_metric_type": "none",
                "metadata": "{}",
                "created_at": ts,
            })

        await tinybird_ingest(events, http)
        total += len(events)
        print(f"   Tinybird: {total}/{len(logs)}")

    return total


async def undo_all(http: httpx.AsyncClient):
    """Remove demo seed logs from Turso + Tinybird."""
    # Count in Turso
    rows = await turso_query(
        f"SELECT COUNT(*) FROM habit_logs WHERE source = '{SEED_SOURCE}'", http
    )
    count = int(rows[0][0]) if rows else 0

    if count > 0:
        print(f"🗑️  Deleting {count} demo logs from Turso...")
        await turso_execute([{"sql": f"DELETE FROM habit_logs WHERE source = '{SEED_SOURCE}'"}], http)
        print(f"✅ Deleted {count} logs from Turso")
    else:
        print("No demo seed logs in Turso.")

    print("🗑️  Deleting demo seed logs from Tinybird...")
    try:
        result = await tinybird_delete(f"source = '{SEED_SOURCE}'", http)
        print(f"✅ Tinybird: {result}")
    except Exception as e:
        print(f"⚠️  Tinybird delete: {e}")


async def sync_tinybird_only(user_id: str, habits: list, http: httpx.AsyncClient):
    """Sync existing demo logs from Turso to Tinybird."""
    rows = await turso_query(
        f"SELECT id, habit_id, habit_name, date, completed_at, status, amount, duration FROM habit_logs WHERE source = '{SEED_SOURCE}'",
        http,
    )
    if not rows:
        print("No demo seed logs in Turso to sync.")
        return

    logs = [{"id": r[0], "habit_id": r[1], "habit_name": r[2], "date": r[3],
             "completed_at": r[4], "status": r[5], "amount": float(r[6] or 0),
             "duration": int(r[7]) if r[7] else None, "source": SEED_SOURCE} for r in rows]

    print(f"📤 Syncing {len(logs)} logs to Tinybird...")
    total = await ingest_logs_tinybird(logs, user_id, habits, http)
    print(f"✅ Synced {total} logs to Tinybird")


# ─── Main ───────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Seed demo habit logs")
    parser.add_argument("--dry-run", action="store_true", help="Print stats without inserting")
    parser.add_argument("--undo", action="store_true", help="Remove all seeded logs from Turso + Tinybird")
    parser.add_argument("--sync-tinybird", action="store_true", help="Sync existing demo logs to Tinybird")
    parser.add_argument("--days", type=int, default=90, help="Days of history (default: 90)")
    args = parser.parse_args()

    async with httpx.AsyncClient() as http:
        if args.undo:
            await undo_all(http)
            return

        user_id, habits = await get_user_and_habits(http)
        if not user_id:
            return

        if args.sync_tinybird:
            await sync_tinybird_only(user_id, habits, http)
            return

        # Match habits to configs
        target_habits = []
        for habit in habits:
            name_lower = habit["name"].strip().lower()
            for config_key in HABIT_CONFIGS:
                if config_key == name_lower or config_key in name_lower or name_lower in config_key:
                    target_habits.append(habit)
                    break

        if not target_habits:
            print("\n❌ No matching habits found.")
            return

        print(f"\n🎯 Generating {args.days} days of logs for {len(target_habits)} habits:")

        all_logs = []
        for habit in target_habits:
            logs = generate_logs_for_habit(habit["id"], habit["name"], user_id, days=args.days)
            all_logs.extend(logs)
            amounts = [l["amount"] for l in logs]
            if amounts:
                print(f"   ✅ {habit['name']}: {len(logs)} logs "
                      f"(avg={sum(amounts)/len(amounts):.1f}, "
                      f"min={min(amounts):.1f}, max={max(amounts):.1f})")

        print(f"\n📊 Total: {len(all_logs)} logs")

        if args.dry_run:
            print("\n🔍 Dry run - no data inserted")
            return

        print("\n📥 Inserting into Turso...")
        await insert_logs_turso(all_logs, http)

        print("\n📤 Syncing to Tinybird...")
        await ingest_logs_tinybird(all_logs, user_id, habits, http)

        print(f"\n✅ Done! {len(all_logs)} demo logs in both Turso + Tinybird")
        print(f"   To undo: python scripts/seed_demo_logs.py --undo")


if __name__ == "__main__":
    asyncio.run(main())
