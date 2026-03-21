"""
Financial integration API router for Plaid-backed spending sync.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException

from schemas.financial import (
    FinancialAccountPreferenceUpdateRequest,
    FinancialConnectionActionResponse,
    FinancialConnectionsResponse,
    FinancialScheduledSyncRequest,
    FinancialSyncSettingsUpdateRequest,
    FinancialSyncResponse,
    PlaidExchangePublicTokenRequest,
    PlaidLinkTokenRequest,
    PlaidLinkTokenResponse,
)
from services.financial_connection_service import financial_connection_service
from services.financial_rollup_service import financial_rollup_service
from services.financial_sync_service import financial_sync_service
from services.plaid_service import PlaidAPIError, plaid_service
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)


def create_financial_router(
    *,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/financial", tags=["financial"])

    def _serialize_connection(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": item["id"],
            "provider": item["provider"],
            "status": item["status"],
            "institution_id": item.get("institution_id"),
            "institution_name": item.get("institution_name"),
            "last_sync_at": item.get("last_sync_at"),
            "last_successful_sync_at": item.get("last_successful_sync_at"),
            "last_error_json": item.get("last_error_json"),
            "requires_reconnect": bool(item.get("requires_reconnect")),
            "account_count": int(item.get("account_count") or 0),
            "latest_transaction_date": item.get("latest_transaction_date"),
            "auto_sync_enabled": bool(item.get("auto_sync_enabled", True)),
            "sync_hour": int(item.get("sync_hour") or 9),
            "accounts": item.get("accounts") or [],
        }

    @router.post("/plaid/link-token", response_model=PlaidLinkTokenResponse)
    async def create_plaid_link_token(
        request: Optional[PlaidLinkTokenRequest] = Body(default=None),
        current_user=Depends(get_current_user),
    ):
        try:
            request = request or PlaidLinkTokenRequest()
            access_token: Optional[str] = None
            if request.update_mode:
                if not request.connection_id:
                    raise HTTPException(status_code=400, detail="connection_id is required for update mode")
                connection = await financial_connection_service.get_connection(
                    current_user["id"],
                    request.connection_id,
                )
                if connection is None or connection.provider != "plaid":
                    raise HTTPException(status_code=404, detail="Plaid connection not found")
                access_token = token_crypto.decrypt(connection.access_token)
                if not access_token:
                    raise HTTPException(status_code=400, detail="Plaid access token is not available for reconnect")

            payload = await plaid_service.create_link_token(
                current_user["id"],
                access_token=access_token,
                account_selection_enabled=request.account_selection_enabled,
            )
            return PlaidLinkTokenResponse(
                link_token=payload["link_token"],
                expiration=payload.get("expiration"),
                request_id=payload.get("request_id"),
            )
        except PlaidAPIError as exc:
            logger.exception("Plaid link token creation failed")
            raise HTTPException(status_code=502, detail=exc.to_dict())
        except Exception as exc:
            logger.exception("Plaid link token creation failed")
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/plaid/exchange-public-token", response_model=FinancialConnectionActionResponse)
    async def exchange_plaid_public_token(
        request: PlaidExchangePublicTokenRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            exchange = await plaid_service.exchange_public_token(request.public_token)
            access_token = exchange.get("access_token")
            item_id = exchange.get("item_id")
            if not access_token or not item_id:
                raise HTTPException(status_code=500, detail="Plaid token exchange returned incomplete data")

            connection = await financial_connection_service.get_or_create_connection(
                user_id=current_user["id"],
                provider="plaid",
                access_token=access_token,
                item_id=item_id,
                institution_id=request.institution_id,
                institution_name=request.institution_name,
                status="active",
            )
            accounts = await plaid_service.fetch_accounts(access_token)
            await financial_connection_service.upsert_accounts(
                user_id=current_user["id"],
                connection_id=connection.id,
                accounts=accounts,
            )
            await financial_rollup_service.ensure_spending_habit(current_user["id"])

            message = "Plaid connected successfully."
            if request.auto_backfill:
                try:
                    backfill_result = await financial_sync_service.backfill_connection(
                        current_user["id"],
                        connection.id,
                    )
                    message = (
                        "Plaid connected and spending history imported. "
                        f"{backfill_result.get('rollup', {}).get('days_completed', 0)} daily totals updated."
                    )
                except Exception as exc:
                    logger.exception("Automatic Plaid backfill failed immediately after connect")
                    message = (
                        "Plaid connected successfully, but automatic backfill failed. "
                        "Use Backfill History to retry."
                    )
                    logger.warning("Plaid auto-backfill error: %s", exc)

            connections = await financial_connection_service.list_connections(current_user["id"])
            current = next((item for item in connections if item["id"] == connection.id), None)
            return FinancialConnectionActionResponse(
                success=True,
                provider="plaid",
                connection=_serialize_connection(current) if current else None,
                message=message,
            )
        except PlaidAPIError as exc:
            logger.exception("Plaid public token exchange failed")
            raise HTTPException(status_code=502, detail=exc.to_dict())
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Plaid public token exchange failed")
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/plaid/webhook")
    async def handle_plaid_webhook(payload: dict[str, Any]):
        try:
            result = await financial_sync_service.handle_webhook(payload)
            return {"received": True, **result}
        except Exception as exc:
            logger.exception("Plaid webhook handling failed")
            return {"received": True, "handled": False, "error": str(exc)}

    @router.get("/connections", response_model=FinancialConnectionsResponse)
    async def list_financial_connections(current_user=Depends(get_current_user)):
        try:
            connections = await financial_connection_service.list_connections(current_user["id"])
            return FinancialConnectionsResponse(
                connections=[_serialize_connection(item) for item in connections]
            )
        except Exception:
            logger.exception("Failed to list financial connections")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/connections/{connection_id}/backfill", response_model=FinancialSyncResponse)
    async def backfill_financial_connection(
        connection_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            result = await financial_sync_service.backfill_connection(
                current_user["id"],
                connection_id,
            )
            return FinancialSyncResponse(
                success=True,
                provider="plaid",
                connection_id=result["connection_id"],
                items_seen=result.get("items_seen") or 0,
                items_written=result.get("items_written") or 0,
                items_updated=result.get("items_updated") or 0,
                items_deleted=result.get("items_deleted") or 0,
                affected_dates=result.get("affected_dates") or [],
                rollup=result.get("rollup") or {},
                cursor=result.get("cursor"),
                message="Plaid spending history backfill completed.",
            )
        except Exception as exc:
            logger.exception("Plaid backfill failed")
            raise HTTPException(status_code=500, detail=str(exc))

    @router.post("/connections/{connection_id}/sync", response_model=FinancialSyncResponse)
    async def sync_financial_connection(
        connection_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            result = await financial_sync_service.sync_connection(
                current_user["id"],
                connection_id,
            )
            return FinancialSyncResponse(
                success=True,
                provider="plaid",
                connection_id=result["connection_id"],
                items_seen=result.get("items_seen") or 0,
                items_written=result.get("items_written") or 0,
                items_updated=result.get("items_updated") or 0,
                items_deleted=result.get("items_deleted") or 0,
                affected_dates=result.get("affected_dates") or [],
                rollup=result.get("rollup") or {},
                cursor=result.get("cursor"),
                message="Plaid spending sync completed.",
            )
        except Exception as exc:
            logger.exception("Plaid sync failed")
            raise HTTPException(status_code=500, detail=str(exc))

    @router.delete("/connections/{connection_id}", response_model=FinancialConnectionActionResponse)
    async def disconnect_financial_connection(
        connection_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            connection = await financial_connection_service.disconnect(
                current_user["id"],
                connection_id,
            )
            if connection is None:
                raise HTTPException(status_code=404, detail="Financial connection not found")

            connections = await financial_connection_service.list_connections(current_user["id"])
            current = next((item for item in connections if item["id"] == connection.id), None)
            return FinancialConnectionActionResponse(
                success=True,
                provider="plaid",
                connection=_serialize_connection(current) if current else None,
                message="Plaid disconnected successfully.",
            )
        except HTTPException:
            raise
        except Exception:
            logger.exception("Plaid disconnect failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.put("/connections/{connection_id}/sync-settings", response_model=FinancialConnectionActionResponse)
    async def update_financial_sync_settings(
        connection_id: str,
        payload: FinancialSyncSettingsUpdateRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            if payload.sync_hour is not None and not 0 <= payload.sync_hour <= 23:
                raise HTTPException(status_code=400, detail="Sync hour must be between 0 and 23")

            updated = await financial_connection_service.update_sync_settings(
                user_id=current_user["id"],
                connection_id=connection_id,
                auto_sync_enabled=payload.auto_sync_enabled,
                sync_hour=payload.sync_hour,
            )
            if updated is None:
                raise HTTPException(status_code=404, detail="Financial connection not found")

            connections = await financial_connection_service.list_connections(current_user["id"])
            current = next((item for item in connections if item["id"] == connection_id), None)
            return FinancialConnectionActionResponse(
                success=True,
                provider="plaid",
                connection=_serialize_connection(current) if current else None,
                message="Sync settings updated.",
            )
        except HTTPException:
            raise
        except Exception:
            logger.exception("Plaid sync settings update failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.put("/connections/{connection_id}/accounts/{account_id}", response_model=FinancialConnectionActionResponse)
    async def update_financial_account_preferences(
        connection_id: str,
        account_id: str,
        payload: FinancialAccountPreferenceUpdateRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            account = await financial_connection_service.update_account_inclusion(
                user_id=current_user["id"],
                connection_id=connection_id,
                account_id=account_id,
                include_in_spending=payload.include_in_spending,
            )
            if account is None:
                raise HTTPException(status_code=404, detail="Financial account not found")

            affected_dates = await financial_connection_service.get_connection_account_dates(
                user_id=current_user["id"],
                connection_id=connection_id,
                account_id=account_id,
            )
            await financial_rollup_service.rollup_dates(current_user["id"], affected_dates)

            connections = await financial_connection_service.list_connections(current_user["id"])
            current = next((item for item in connections if item["id"] == connection_id), None)
            return FinancialConnectionActionResponse(
                success=True,
                provider="plaid",
                connection=_serialize_connection(current) if current else None,
                message="Account spending preference updated.",
            )
        except HTTPException:
            raise
        except Exception:
            logger.exception("Plaid account preference update failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/sync-all")
    async def sync_all_financial_connections(
        payload: Optional[FinancialScheduledSyncRequest] = None,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        expected_internal_key = os.getenv("INTERNAL_API_KEY")
        if not expected_internal_key:
            raise HTTPException(status_code=503, detail="Service temporarily unavailable")
        if internal_key != expected_internal_key:
            raise HTTPException(status_code=403, detail="Invalid internal API key")

        try:
            return await financial_sync_service.sync_all_active(
                hour=payload.hour if payload else None,
            )
        except Exception:
            logger.exception("Bulk Plaid sync failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    return router
