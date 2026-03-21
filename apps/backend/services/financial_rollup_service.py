"""
Daily spending rollups from normalized financial transactions into habit logs.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy import func, select

from database.connection import get_db_session
from database.models import FinancialAccountDB, FinancialConnectionDB, FinancialTransactionDB
from models.habit_models import HabitCreate
from services.financial_connection_service import financial_connection_service
from services.habits_service import HabitsService

logger = logging.getLogger(__name__)


def fallback_completed_at(date_value: str) -> str:
    return f"{date_value}T23:59:59+00:00"


class FinancialRollupService:
    def __init__(self) -> None:
        self.habits_service = HabitsService()

    async def ensure_spending_habit(self, user_id: str) -> str:
        habits = await self.habits_service.get_habits(user_id)
        existing = next(
            (
                habit
                for habit in habits
                if (habit.integration_source or "").lower() == "plaid"
                and (habit.metric_type or "").lower() == "daily_spending"
            ),
            None,
        )
        if existing:
            return existing.id

        habit = await self.habits_service.create_habit(
            HabitCreate(
                name="Spending",
                category="finance",
                icon="lucide:banknote",
                is_custom=False,
                integration_source="plaid",
                unit_type="Dollars",
                sensor_type="Plaid",
                metric_type="daily_spending",
            ),
            user_id,
        )
        return habit.id

    async def _included_account_ids(self, user_id: str) -> Set[str]:
        async with get_db_session() as session:
            connections_result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.user_id == user_id,
                    FinancialConnectionDB.status == "active",
                )
            )
            connections = connections_result.scalars().all()
            connection_map = {connection.id: connection for connection in connections}

            accounts_result = await session.execute(
                select(FinancialAccountDB).where(
                    FinancialAccountDB.user_id == user_id,
                    FinancialAccountDB.is_active.is_(True),
                )
            )
            included_ids: Set[str] = set()
            for account in accounts_result.scalars().all():
                connection = connection_map.get(account.connection_id)
                if connection is None:
                    continue
                settings = financial_connection_service.get_sync_settings(connection.settings_json)
                if account.provider_account_id in set(settings.get("excluded_account_ids", [])):
                    continue
                included_ids.add(account.id)

            return included_ids

    async def rollup_dates(self, user_id: str, dates: Iterable[str]) -> Dict[str, int]:
        unique_dates = sorted({date for date in dates if date})
        if not unique_dates:
            return {"days_processed": 0, "days_completed": 0, "days_skipped": 0}

        habit_id = await self.ensure_spending_habit(user_id)
        included_account_ids = await self._included_account_ids(user_id)

        aggregates = {}
        if included_account_ids:
            async with get_db_session() as session:
                rows = await session.execute(
                    select(
                        FinancialTransactionDB.transaction_date,
                        func.sum(FinancialTransactionDB.amount),
                        func.max(FinancialTransactionDB.posted_at),
                        func.max(FinancialTransactionDB.authorized_at),
                        func.count(FinancialTransactionDB.id),
                    )
                    .where(FinancialTransactionDB.user_id == user_id)
                    .where(FinancialTransactionDB.account_id.in_(included_account_ids))
                    .where(FinancialTransactionDB.counts_toward_spending.is_(True))
                    .where(FinancialTransactionDB.transaction_date.in_(unique_dates))
                    .group_by(FinancialTransactionDB.transaction_date)
                )
                aggregates = {
                    row[0]: {
                        "amount": float(row[1] or 0.0),
                        "posted_at": row[2],
                        "authorized_at": row[3],
                        "transaction_count": int(row[4] or 0),
                    }
                    for row in rows.fetchall()
                }

        days_completed = 0
        days_skipped = 0

        for date_value in unique_dates:
            aggregate = aggregates.get(date_value)
            amount = float(aggregate["amount"]) if aggregate else 0.0
            latest_dt: Optional[datetime] = None
            if aggregate:
                latest_dt = aggregate.get("posted_at") or aggregate.get("authorized_at")

            status = "completed" if amount > 0 else "skipped"
            if status == "completed":
                days_completed += 1
            else:
                days_skipped += 1

            metadata = {
                "transaction_count": aggregate["transaction_count"] if aggregate else 0,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

            completed_at = (
                latest_dt.astimezone(timezone.utc).isoformat()
                if latest_dt is not None
                else fallback_completed_at(date_value)
            )

            await self.habits_service.upsert_habit_log_rollup(
                habit_id=habit_id,
                user_id=user_id,
                date=date_value,
                amount=round(amount, 2),
                completed_at=completed_at,
                status=status,
                source="plaid_sync",
                origin_record_kind="daily_rollup",
                origin_record_id=f"plaid:daily_spending:{date_value}",
                notes="Auto-synced daily spending from Plaid",
                log_metadata=metadata,
            )

        return {
            "days_processed": len(unique_dates),
            "days_completed": days_completed,
            "days_skipped": days_skipped,
        }


financial_rollup_service = FinancialRollupService()
