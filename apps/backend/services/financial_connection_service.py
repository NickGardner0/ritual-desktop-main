"""
Financial connection storage and query helpers.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select

from database.connection import get_db_session
from database.models import (
    FinancialAccountDB,
    FinancialConnectionDB,
    FinancialTransactionDB,
)
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)


class FinancialConnectionService:
    @staticmethod
    def error_requires_reconnect(error: Optional[Dict[str, Any]]) -> bool:
        if not error:
            return False
        code = str(
            error.get("error_code")
            or error.get("webhook_code")
            or error.get("code")
            or ""
        ).upper()
        return code in {"ITEM_LOGIN_REQUIRED", "PENDING_DISCONNECT", "PENDING_EXPIRATION"}

    @staticmethod
    def get_sync_settings(settings_json: Optional[str]) -> Dict[str, Any]:
        settings: Dict[str, Any] = {}
        if settings_json:
            try:
                settings = json.loads(settings_json)
            except Exception:
                settings = {}

        auto_sync_enabled = bool(settings.get("auto_sync_enabled", True))
        sync_hour = settings.get("sync_hour")
        if sync_hour is None:
            sync_hour = 9

        excluded_account_ids = [
            str(item)
            for item in (settings.get("excluded_account_ids") or [])
            if item
        ]

        return {
            "auto_sync_enabled": auto_sync_enabled,
            "sync_hour": int(sync_hour),
            "excluded_account_ids": excluded_account_ids,
        }

    async def get_or_create_connection(
        self,
        *,
        user_id: str,
        provider: str,
        access_token: Optional[str] = None,
        item_id: Optional[str] = None,
        institution_id: Optional[str] = None,
        institution_name: Optional[str] = None,
        settings: Optional[Dict[str, Any]] = None,
        status: str = "active",
    ) -> FinancialConnectionDB:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.user_id == user_id,
                    FinancialConnectionDB.provider == provider,
                )
            )
            connection = result.scalar_one_or_none()
            now = datetime.now(timezone.utc)

            if connection is None:
                connection = FinancialConnectionDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    provider=provider,
                    created_at=now,
                )
                session.add(connection)

            connection.status = status
            if access_token:
                connection.access_token = token_crypto.encrypt(access_token)
            if item_id is not None:
                connection.item_id = item_id
            if institution_id is not None:
                connection.institution_id = institution_id
            if institution_name is not None:
                connection.institution_name = institution_name
            if settings is not None:
                merged_settings: Dict[str, Any] = {}
                if connection.settings_json:
                    try:
                        merged_settings.update(json.loads(connection.settings_json))
                    except Exception:
                        merged_settings = {}
                merged_settings.update(settings)
                connection.settings_json = json.dumps(merged_settings)
            connection.updated_at = now

            await session.commit()
            await session.refresh(connection)
            return connection

    async def get_connection(
        self, user_id: str, connection_id: str
    ) -> Optional[FinancialConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.user_id == user_id,
                    FinancialConnectionDB.id == connection_id,
                )
            )
            return result.scalar_one_or_none()

    async def list_connections(self, user_id: str) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(FinancialConnectionDB.user_id == user_id)
            )
            connections = result.scalars().all()

            counts_result = await session.execute(
                select(FinancialAccountDB.connection_id, func.count(FinancialAccountDB.id))
                .where(FinancialAccountDB.user_id == user_id)
                .where(FinancialAccountDB.is_active.is_(True))
                .group_by(FinancialAccountDB.connection_id)
            )
            account_counts = {row[0]: row[1] for row in counts_result.fetchall()}

            tx_result = await session.execute(
                select(
                    FinancialTransactionDB.connection_id,
                    func.max(FinancialTransactionDB.transaction_date),
                )
                .where(FinancialTransactionDB.user_id == user_id)
                .group_by(FinancialTransactionDB.connection_id)
            )
            latest_transaction_dates = {row[0]: row[1] for row in tx_result.fetchall()}

            accounts_result = await session.execute(
                select(FinancialAccountDB).where(
                    FinancialAccountDB.user_id == user_id,
                )
            )
            accounts_by_connection: Dict[str, List[FinancialAccountDB]] = {}
            for account in accounts_result.scalars().all():
                accounts_by_connection.setdefault(account.connection_id, []).append(account)

            items = []
            for connection in connections:
                sync_settings = self.get_sync_settings(connection.settings_json)
                excluded_account_ids = set(sync_settings["excluded_account_ids"])
                serialized_accounts = []
                for account in sorted(
                    accounts_by_connection.get(connection.id, []),
                    key=lambda item: (
                        0 if item.is_active else 1,
                        item.account_type or "",
                        item.name or "",
                    ),
                ):
                    serialized_accounts.append(
                        {
                            "id": account.id,
                            "provider_account_id": account.provider_account_id,
                            "name": account.name,
                            "official_name": account.official_name,
                            "mask": account.mask,
                            "account_type": account.account_type,
                            "account_subtype": account.account_subtype,
                            "currency": account.currency,
                            "is_active": bool(account.is_active),
                            "include_in_spending": bool(
                                account.is_active and account.provider_account_id not in excluded_account_ids
                            ),
                        }
                    )
                items.append(
                    {
                        "id": connection.id,
                        "provider": connection.provider,
                        "status": connection.status,
                        "institution_id": connection.institution_id,
                        "institution_name": connection.institution_name,
                        "last_sync_at": connection.last_sync_at.isoformat()
                        if connection.last_sync_at
                        else None,
                        "last_successful_sync_at": connection.last_successful_sync_at.isoformat()
                        if connection.last_successful_sync_at
                        else None,
                        "last_error_json": json.loads(connection.last_error_json)
                        if connection.last_error_json
                        else None,
                        "requires_reconnect": self.error_requires_reconnect(
                            json.loads(connection.last_error_json)
                            if connection.last_error_json
                            else None
                        ),
                        "account_count": account_counts.get(connection.id, 0),
                        "latest_transaction_date": latest_transaction_dates.get(connection.id),
                        "auto_sync_enabled": sync_settings["auto_sync_enabled"],
                        "sync_hour": sync_settings["sync_hour"],
                        "accounts": serialized_accounts,
                    }
                )
            return items

    async def get_connection_by_item_id(
        self,
        *,
        provider: str,
        item_id: str,
    ) -> Optional[FinancialConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.provider == provider,
                    FinancialConnectionDB.item_id == item_id,
                )
            )
            return result.scalar_one_or_none()

    async def upsert_accounts(
        self,
        *,
        user_id: str,
        connection_id: str,
        accounts: List[Dict[str, Any]],
    ) -> List[FinancialAccountDB]:
        async with get_db_session() as session:
            connection_result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.user_id == user_id,
                    FinancialConnectionDB.id == connection_id,
                )
            )
            connection = connection_result.scalar_one_or_none()
            if connection is None:
                raise RuntimeError("Financial connection not found")

            existing_result = await session.execute(
                select(FinancialAccountDB).where(
                    FinancialAccountDB.user_id == user_id,
                    FinancialAccountDB.connection_id == connection_id,
                )
            )
            existing_accounts = {
                account.provider_account_id: account
                for account in existing_result.scalars().all()
            }

            seen_ids = set()
            updated_accounts: List[FinancialAccountDB] = []
            now = datetime.now(timezone.utc)

            for payload in accounts:
                provider_account_id = payload["provider_account_id"]
                seen_ids.add(provider_account_id)
                account = existing_accounts.get(provider_account_id)
                if account is None:
                    account = FinancialAccountDB(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        connection_id=connection_id,
                        provider_account_id=provider_account_id,
                        created_at=now,
                    )
                    session.add(account)

                account.name = payload["name"]
                account.official_name = payload.get("official_name")
                account.mask = payload.get("mask")
                account.account_type = payload.get("account_type") or "other"
                account.account_subtype = payload.get("account_subtype")
                account.currency = payload.get("currency")
                account.is_active = True
                account.updated_at = now
                updated_accounts.append(account)

            for provider_account_id, account in existing_accounts.items():
                if provider_account_id not in seen_ids:
                    account.is_active = False
                    account.updated_at = now

            await session.commit()
            for account in updated_accounts:
                await session.refresh(account)
            return updated_accounts

    async def update_sync_settings(
        self,
        *,
        user_id: str,
        connection_id: str,
        auto_sync_enabled: bool,
        sync_hour: Optional[int] = None,
    ) -> Optional[FinancialConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.user_id == user_id,
                    FinancialConnectionDB.id == connection_id,
                )
            )
            connection = result.scalar_one_or_none()
            if connection is None:
                return None

            settings = self.get_sync_settings(connection.settings_json)
            settings["auto_sync_enabled"] = bool(auto_sync_enabled)
            if sync_hour is not None:
                settings["sync_hour"] = int(sync_hour)
            connection.settings_json = json.dumps(settings)
            connection.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(connection)
            return connection

    async def update_account_inclusion(
        self,
        *,
        user_id: str,
        connection_id: str,
        account_id: str,
        include_in_spending: bool,
    ) -> Optional[FinancialAccountDB]:
        async with get_db_session() as session:
            connection_result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.user_id == user_id,
                    FinancialConnectionDB.id == connection_id,
                )
            )
            connection = connection_result.scalar_one_or_none()
            if connection is None:
                return None

            account_result = await session.execute(
                select(FinancialAccountDB).where(
                    FinancialAccountDB.user_id == user_id,
                    FinancialAccountDB.connection_id == connection_id,
                    FinancialAccountDB.id == account_id,
                )
            )
            account = account_result.scalar_one_or_none()
            if account is None:
                return None

            settings = self.get_sync_settings(connection.settings_json)
            excluded_account_ids = {
                str(item) for item in settings.get("excluded_account_ids", []) if item
            }
            if include_in_spending:
                excluded_account_ids.discard(account.provider_account_id)
            else:
                excluded_account_ids.add(account.provider_account_id)

            settings["excluded_account_ids"] = sorted(excluded_account_ids)
            connection.settings_json = json.dumps(settings)
            connection.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(account)
            return account

    async def disconnect(self, user_id: str, connection_id: str) -> Optional[FinancialConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.user_id == user_id,
                    FinancialConnectionDB.id == connection_id,
                )
            )
            connection = result.scalar_one_or_none()
            if connection is None:
                return None

            connection.status = "revoked"
            connection.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(connection)
            return connection

    async def update_connection_error(
        self,
        *,
        connection_id: str,
        error: Optional[Dict[str, Any]],
    ) -> Optional[FinancialConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(FinancialConnectionDB.id == connection_id)
            )
            connection = result.scalar_one_or_none()
            if connection is None:
                return None

            connection.last_error_json = json.dumps(error) if error else None
            connection.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(connection)
            return connection

    async def get_connection_account_dates(
        self,
        *,
        user_id: str,
        connection_id: str,
        account_id: Optional[str] = None,
    ) -> List[str]:
        async with get_db_session() as session:
            query = select(FinancialTransactionDB.transaction_date).where(
                FinancialTransactionDB.user_id == user_id,
                FinancialTransactionDB.connection_id == connection_id,
            )
            if account_id is not None:
                query = query.where(FinancialTransactionDB.account_id == account_id)
            result = await session.execute(query.distinct())
            return sorted({row[0] for row in result.fetchall() if row[0]})

    async def get_active_connections(self, provider: str) -> List[FinancialConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(FinancialConnectionDB).where(
                    FinancialConnectionDB.provider == provider,
                    FinancialConnectionDB.status == "active",
                )
            )
            return list(result.scalars().all())


financial_connection_service = FinancialConnectionService()
