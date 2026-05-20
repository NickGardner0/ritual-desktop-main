#!/usr/bin/env python3
"""Dry-run, apply, and reconcile canonical metric facts for one user.

Raw source data is never deleted or mutated. By default this script is a dry-run;
pass --apply to write derived metric_daily_facts rows.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import pathlib
import sys
from typing import Optional

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from database.connection import _run_migrations, async_session_factory, init_database  # noqa: E402
from services.metric_facts_service import metric_fact_service  # noqa: E402


def _csv(value: Optional[str]) -> Optional[list[str]]:
    if not value:
        return None
    items = [item.strip() for item in value.split(",") if item.strip()]
    return items or None


async def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild canonical metric facts for one user.")
    parser.add_argument("--user-id", required=True, help="Ritual/Clerk user id to rebuild.")
    parser.add_argument("--start-date", help="Inclusive YYYY-MM-DD start date.")
    parser.add_argument("--end-date", help="Inclusive YYYY-MM-DD end date.")
    parser.add_argument("--days-back", type=int, default=3650, help="Fallback range when dates are omitted.")
    parser.add_argument("--habit-ids", help="Comma-separated habit ids to restrict the rebuild.")
    parser.add_argument("--source-families", help="Comma-separated families: wearable,plaid,watcher,manual.")
    parser.add_argument("--apply", action="store_true", help="Write facts. Omit for dry-run.")
    parser.add_argument("--no-legacy-fallback", action="store_true", help="Do not preserve projected habit-log fallback rows.")
    parser.add_argument("--reconcile", action="store_true", help="Run reconciliation after rebuild.")
    parser.add_argument("--skip-migrations", action="store_true", help="Do not run additive schema checks first.")
    args = parser.parse_args()

    if not args.skip_migrations:
        await init_database(fast_startup=True)
        async with async_session_factory() as session:
            await _run_migrations(session)
            await session.commit()

    rebuild = await metric_fact_service.rebuild_facts(
        user_id=args.user_id,
        start_date=args.start_date,
        end_date=args.end_date,
        days_back=args.days_back,
        habit_ids=_csv(args.habit_ids),
        source_families=_csv(args.source_families),
        include_legacy_fallback=not args.no_legacy_fallback,
        apply=args.apply,
    )
    result = {"rebuild": rebuild}
    if args.reconcile:
        result["reconcile"] = await metric_fact_service.reconcile(
            user_id=args.user_id,
            start_date=args.start_date,
            end_date=args.end_date,
            days_back=args.days_back,
            habit_ids=_csv(args.habit_ids),
        )
    print(json.dumps(result, indent=2, sort_keys=True, default=str))


if __name__ == "__main__":
    asyncio.run(main())
