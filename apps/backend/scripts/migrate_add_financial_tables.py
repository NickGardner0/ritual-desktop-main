#!/usr/bin/env python3
"""Migration script to add financial sync tables for Plaid spending rollups."""

import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from database.models import (
    FinancialAccountDB,
    FinancialConnectionDB,
    FinancialSyncCursorDB,
    FinancialSyncRunDB,
    FinancialTransactionDB,
)

load_dotenv()

db_path = backend_dir / ".turso_replica.db"


def check_table_exists(table_name: str) -> bool:
    with sqlite3.connect(str(db_path)) as conn:
        result = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        )
        return result.fetchone() is not None


def main() -> int:
    if not db_path.exists():
        print(f"❌ Local Turso replica not found at {db_path}")
        print("   Start the backend once so the replica is created, then rerun this migration.")
        return 1

    tables_to_create = [
        ("financial_connections", FinancialConnectionDB),
        ("financial_accounts", FinancialAccountDB),
        ("financial_transactions", FinancialTransactionDB),
        ("financial_sync_cursors", FinancialSyncCursorDB),
        ("financial_sync_runs", FinancialSyncRunDB),
    ]

    missing = []
    for table_name, model in tables_to_create:
        exists = check_table_exists(table_name)
        print(f"{'✅' if exists else '⏳'} {table_name}")
        if not exists:
            missing.append((table_name, model))

    if not missing:
        print("✅ Financial tables already exist")
        return 0

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        for _, model in missing:
            model.__table__.create(engine, checkfirst=True)
    finally:
        engine.dispose()

    all_exist = True
    for table_name, _ in tables_to_create:
        exists = check_table_exists(table_name)
        print(f"{'✅' if exists else '❌'} {table_name}")
        if not exists:
            all_exist = False

    return 0 if all_exist else 1


if __name__ == "__main__":
    raise SystemExit(main())
