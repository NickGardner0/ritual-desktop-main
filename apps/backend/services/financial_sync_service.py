"""
Sync orchestration for Plaid-backed spending rollups.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import select

from database.connection import get_db_session
from database.models import (
    FinancialAccountDB,
    FinancialConnectionDB,
    FinancialSyncCursorDB,
    FinancialSyncRunDB,
    FinancialTransactionDB,
)
from services.financial_connection_service import financial_connection_service
from services.financial_rollup_service import financial_rollup_service
from services.plaid_service import PlaidAPIError, plaid_service
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)


class FinancialSyncService:
    @staticmethod
    def _serialize_error(exc: Exception) -> Dict[str, Any]:
        if isinstance(exc, PlaidAPIError):
            payload = exc.to_dict()
            payload["reconnect_required"] = financial_connection_service.error_requires_reconnect(
                payload
            )
            return payload
        return {"message": str(exc)}

    async def start_sync_run(
        self,
        *,
        provider: str,
        trigger: str,
        connection_id: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> FinancialSyncRunDB:
        async with get_db_session() as session:
            run = FinancialSyncRunDB(
                id=str(uuid.uuid4()),
                connection_id=connection_id,
                provider=provider,
                trigger=trigger,
                status="running",
                started_at=datetime.now(timezone.utc),
                metadata_json=json.dumps(metadata) if metadata else None,
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            return run

    async def finish_sync_run(
        self,
        run_id: str,
        *,
        status: str,
        items_seen: int = 0,
        items_written: int = 0,
        items_updated: int = 0,
        items_deleted: int = 0,
        error: Optional[Dict[str, Any]] = None,
    ) -> None:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialSyncRunDB).where(FinancialSyncRunDB.id == run_id)
            )
            run = result.scalar_one_or_none()
            if run is None:
                return

            run.status = status
            run.completed_at = datetime.now(timezone.utc)
            run.items_seen = items_seen
            run.items_written = items_written
            run.items_updated = items_updated
            run.items_deleted = items_deleted
            run.error_json = json.dumps(error) if error else None
            await session.commit()

    async def backfill_connection(self, user_id: str, connection_id: str) -> Dict[str, Any]:
        return await self._sync_connection(
            user_id=user_id,
            connection_id=connection_id,
            trigger="backfill",
            use_cursor=False,
        )

    async def sync_connection(self, user_id: str, connection_id: str) -> Dict[str, Any]:
        return await self._sync_connection(
            user_id=user_id,
            connection_id=connection_id,
            trigger="manual",
            use_cursor=True,
        )

    async def sync_all_active(self, hour: Optional[int] = None) -> Dict[str, Any]:
        connections = await financial_connection_service.get_active_connections("plaid")
        results = []
        for connection in connections:
            settings = financial_connection_service.get_sync_settings(connection.settings_json)
            if not settings["auto_sync_enabled"]:
                continue
            if hour is not None and int(settings["sync_hour"]) != int(hour):
                continue
            try:
                result = await self.sync_connection(connection.user_id, connection.id)
                results.append({"connection_id": connection.id, "success": True, "data": result})
            except Exception as exc:
                results.append(
                    {
                        "connection_id": connection.id,
                        "success": False,
                        "error": str(exc),
                    }
                )
        return {
            "total_connections": len(results),
            "successful_syncs": sum(1 for item in results if item["success"]),
            "results": results,
        }

    async def handle_webhook(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        item_id = str(payload.get("item_id") or "")
        webhook_type = str(payload.get("webhook_type") or "")
        webhook_code = str(payload.get("webhook_code") or "")

        if not item_id:
            return {"handled": False, "reason": "missing_item_id"}

        connection = await financial_connection_service.get_connection_by_item_id(
            provider="plaid",
            item_id=item_id,
        )
        if connection is None:
            return {"handled": False, "reason": "connection_not_found"}

        if webhook_type == "TRANSACTIONS" and webhook_code == "SYNC_UPDATES_AVAILABLE":
            result = await self.sync_connection(connection.user_id, connection.id)
            return {
                "handled": True,
                "action": "sync_connection",
                "connection_id": connection.id,
                "result": result,
            }

        if webhook_type == "ITEM" and webhook_code in {
            "ERROR",
            "PENDING_DISCONNECT",
            "PENDING_EXPIRATION",
        }:
            await financial_connection_service.update_connection_error(
                connection_id=connection.id,
                error={
                    "webhook_type": webhook_type,
                    "webhook_code": webhook_code,
                    "error_code": payload.get("error_code"),
                    "error_message": payload.get("error_message"),
                    "display_message": payload.get("display_message"),
                    "reconnect_required": financial_connection_service.error_requires_reconnect(
                        {
                            "webhook_code": webhook_code,
                            "error_code": payload.get("error_code"),
                        }
                    ),
                },
            )
            return {
                "handled": True,
                "action": "mark_reconnect_required",
                "connection_id": connection.id,
            }

        if webhook_type == "ITEM" and webhook_code == "LOGIN_REPAIRED":
            await financial_connection_service.update_connection_error(
                connection_id=connection.id,
                error=None,
            )
            result = await self.sync_connection(connection.user_id, connection.id)
            return {
                "handled": True,
                "action": "login_repaired_sync",
                "connection_id": connection.id,
                "result": result,
            }

        return {
            "handled": False,
            "reason": "ignored_webhook",
            "webhook_type": webhook_type,
            "webhook_code": webhook_code,
        }

    async def _sync_connection(
        self,
        *,
        user_id: str,
        connection_id: str,
        trigger: str,
        use_cursor: bool,
    ) -> Dict[str, Any]:
        connection = await financial_connection_service.get_connection(user_id, connection_id)
        if connection is None:
            raise RuntimeError("Financial connection not found")
        if connection.status != "active":
            raise RuntimeError("Financial connection is not active")

        run = await self.start_sync_run(
            provider=connection.provider,
            trigger=trigger,
            connection_id=connection.id,
            metadata={"requested_by": user_id},
        )

        try:
            access_token = token_crypto.decrypt(connection.access_token)
            if not access_token:
                raise RuntimeError("No Plaid access token is stored for this connection")

            cursor = await self._get_cursor(connection.id, "transactions_sync_cursor") if use_cursor else None
            sync_payload = await plaid_service.fetch_transactions(access_token, cursor=cursor)
            accounts = await financial_connection_service.upsert_accounts(
                user_id=user_id,
                connection_id=connection.id,
                accounts=sync_payload["accounts"],
            )

            account_map = {account.provider_account_id: account for account in accounts}
            affected_dates, write_counts = await self._apply_transaction_changes(
                user_id=user_id,
                connection=connection,
                account_map=account_map,
                sync_payload=sync_payload,
            )

            await self._set_cursor(
                connection.id,
                "transactions_sync_cursor",
                sync_payload.get("cursor") or cursor or "",
            )

            async with get_db_session() as session:
                result = await session.execute(
                    select(FinancialConnectionDB).where(FinancialConnectionDB.id == connection.id)
                )
                current_connection = result.scalar_one()
                now = datetime.now(timezone.utc)
                current_connection.last_sync_at = now
                current_connection.last_error_json = None
                current_connection.updated_at = now
                if write_counts["items_seen"] > 0 or trigger == "backfill":
                    current_connection.last_successful_sync_at = now
                await session.commit()

            rollup_summary = await financial_rollup_service.rollup_dates(user_id, affected_dates)
            await self.finish_sync_run(
                run.id,
                status="success",
                items_seen=write_counts["items_seen"],
                items_written=write_counts["items_written"],
                items_updated=write_counts["items_updated"],
                items_deleted=write_counts["items_deleted"],
            )

            return {
                "connection_id": connection.id,
                "provider": connection.provider,
                "items_seen": write_counts["items_seen"],
                "items_written": write_counts["items_written"],
                "items_updated": write_counts["items_updated"],
                "items_deleted": write_counts["items_deleted"],
                "affected_dates": sorted(affected_dates),
                "rollup": rollup_summary,
                "cursor": sync_payload.get("cursor"),
            }
        except Exception as exc:
            error_payload = self._serialize_error(exc)
            async with get_db_session() as session:
                result = await session.execute(
                    select(FinancialConnectionDB).where(FinancialConnectionDB.id == connection.id)
                )
                current_connection = result.scalar_one_or_none()
                if current_connection is not None:
                    current_connection.last_error_json = json.dumps(error_payload)
                    current_connection.updated_at = datetime.now(timezone.utc)
                    await session.commit()
            await self.finish_sync_run(
                run.id,
                status="failed",
                error=error_payload,
            )
            raise

    async def _get_cursor(self, connection_id: str, cursor_key: str) -> Optional[str]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialSyncCursorDB).where(
                    FinancialSyncCursorDB.connection_id == connection_id,
                    FinancialSyncCursorDB.cursor_key == cursor_key,
                )
            )
            cursor = result.scalar_one_or_none()
            return cursor.cursor_value if cursor else None

    async def _set_cursor(self, connection_id: str, cursor_key: str, cursor_value: str) -> None:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialSyncCursorDB).where(
                    FinancialSyncCursorDB.connection_id == connection_id,
                    FinancialSyncCursorDB.cursor_key == cursor_key,
                )
            )
            cursor = result.scalar_one_or_none()
            now = datetime.now(timezone.utc)
            if cursor is None:
                cursor = FinancialSyncCursorDB(
                    id=str(uuid.uuid4()),
                    connection_id=connection_id,
                    cursor_key=cursor_key,
                    created_at=now,
                )
                session.add(cursor)

            cursor.cursor_value = cursor_value
            cursor.last_synced_at = now
            cursor.updated_at = now
            await session.commit()

    async def _apply_transaction_changes(
        self,
        *,
        user_id: str,
        connection: FinancialConnectionDB,
        account_map: Dict[str, FinancialAccountDB],
        sync_payload: Dict[str, Any],
    ) -> tuple[Set[str], Dict[str, int]]:
        added = sync_payload.get("added", [])
        modified = sync_payload.get("modified", [])
        removed = sync_payload.get("removed", [])
        ids_to_lookup = [
            item["provider_transaction_id"]
            for item in [*added, *modified]
            if item.get("provider_transaction_id")
        ] + [item["provider_transaction_id"] for item in removed if item.get("provider_transaction_id")]

        async with get_db_session() as session:
            existing_transactions = {}
            if ids_to_lookup:
                existing_result = await session.execute(
                    select(FinancialTransactionDB).where(
                        FinancialTransactionDB.user_id == user_id,
                        FinancialTransactionDB.provider_transaction_id.in_(ids_to_lookup),
                    )
                )
                existing_transactions = {
                    item.provider_transaction_id: item
                    for item in existing_result.scalars().all()
                }

            affected_dates: Set[str] = set()
            items_written = 0
            items_updated = 0
            items_deleted = 0

            for payload in [*added, *modified]:
                provider_transaction_id = payload["provider_transaction_id"]
                account = account_map.get(payload["provider_account_id"])
                if account is None:
                    logger.warning(
                        "Skipping Plaid transaction with unknown account_id=%s",
                        payload["provider_account_id"],
                    )
                    continue

                existing = existing_transactions.get(provider_transaction_id)
                if existing is None:
                    existing = FinancialTransactionDB(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        connection_id=connection.id,
                        account_id=account.id,
                        provider_transaction_id=provider_transaction_id,
                        created_at=datetime.now(timezone.utc),
                    )
                    session.add(existing)
                    items_written += 1
                else:
                    if existing.transaction_date:
                        affected_dates.add(existing.transaction_date)
                    items_updated += 1

                existing.connection_id = connection.id
                existing.account_id = account.id
                existing.transaction_date = payload["transaction_date"]
                existing.authorized_at = payload.get("authorized_at")
                existing.posted_at = payload.get("posted_at")
                existing.name = payload["name"]
                existing.merchant_name = payload.get("merchant_name")
                existing.amount = float(payload["amount"])
                existing.currency = payload.get("currency")
                existing.direction = payload["direction"]
                existing.pending = bool(payload.get("pending"))
                existing.raw_category_json = payload.get("raw_category_json")
                existing.raw_transaction_code = payload.get("raw_transaction_code")
                existing.counts_toward_spending = bool(payload.get("counts_toward_spending"))
                existing.updated_at = datetime.now(timezone.utc)
                affected_dates.add(existing.transaction_date)

            for payload in removed:
                provider_transaction_id = payload["provider_transaction_id"]
                existing = existing_transactions.get(provider_transaction_id)
                if existing is None:
                    continue
                if existing.transaction_date:
                    affected_dates.add(existing.transaction_date)
                await session.delete(existing)
                items_deleted += 1

            await session.commit()
            return affected_dates, {
                "items_seen": int(sync_payload.get("total_seen") or 0),
                "items_written": items_written,
                "items_updated": items_updated,
                "items_deleted": items_deleted,
            }


financial_sync_service = FinancialSyncService()
