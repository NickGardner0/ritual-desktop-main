"""Integration API routers extracted from main.py."""

import logging
import os
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from database.connection import get_db_session
from database.models import WearableEventDB, WhoopIntegrationDB
from services.unified_wearables_service import wearable_connection_service

logger = logging.getLogger(__name__)


class WhoopSyncHourUpdate(BaseModel):
    sync_hour: int


class WhoopBulkSyncRequest(BaseModel):
    daysBack: Optional[int] = None
    hour: Optional[int] = None
    forceFullSync: bool = False
    fullHistory: bool = False


class TeslaBackfillRequest(BaseModel):
    previous_odometer: float
    as_of_date: str  # ISO date string e.g. "2025-10-01"


def create_whoop_router(
    *,
    get_current_user: Callable[..., Any],
    whoop_service: Any,
) -> APIRouter:
    """Build Whoop integration router with injected dependencies."""
    router = APIRouter(prefix="/api/integrations/whoop", tags=["integrations"])

    async def _whoop_sleep_status(user_id: str, canonical: Any = None) -> dict[str, Any]:
        settings = {}
        if canonical and canonical.settings_json:
            try:
                settings = json.loads(canonical.settings_json)
            except Exception:
                settings = {}

        async with get_db_session() as session:
            latest_sleep_result = await session.execute(
                select(func.max(WearableEventDB.attributed_date)).where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.provider == "whoop",
                    WearableEventDB.event_type == "sleep_total",
                    WearableEventDB.deleted_at.is_(None),
                    WearableEventDB.attributed_date.is_not(None),
                )
            )
        latest_sleep_date = latest_sleep_result.scalar_one_or_none()
        latest_upstream_sleep_date = settings.get("latest_upstream_sleep_date")
        today = datetime.now(timezone.utc).date().isoformat()
        stale_threshold = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
        is_upstream_stale = bool(latest_upstream_sleep_date and latest_upstream_sleep_date < stale_threshold)
        stale_message = (
            f"Whoop has not returned sleep after {latest_upstream_sleep_date} yet."
            if is_upstream_stale
            else None
        )
        latest_display_date = latest_sleep_date or latest_upstream_sleep_date
        sleep_status_message = (
            f"Latest Whoop sleep imported: {latest_display_date}."
            if latest_display_date
            else "No Whoop sleep has been imported yet."
        )
        if latest_upstream_sleep_date and latest_upstream_sleep_date < today:
            sleep_status_message += " If you expected a newer sleep, Whoop has not returned it to Ritual yet."

        return {
            "latest_sleep_date": latest_sleep_date,
            "latest_upstream_sleep_date": latest_upstream_sleep_date,
            "latest_upstream_sleep_start": settings.get("latest_upstream_sleep_start"),
            "latest_upstream_sleep_end": settings.get("latest_upstream_sleep_end"),
            "latest_upstream_sleep_score_state": settings.get("latest_upstream_sleep_score_state"),
            "latest_upstream_sleep_id": settings.get("latest_upstream_sleep_id"),
            "latest_upstream_sleep_cycle_id": settings.get("latest_upstream_sleep_cycle_id"),
            "is_upstream_stale": is_upstream_stale,
            "stale_message": stale_message,
            "sleep_status_message": sleep_status_message,
        }

    @router.post("/callback")
    async def whoop_callback(
        code: str,
        state: Optional[str] = None,
        error: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        del state  # Reserved for future CSRF state checks.
        try:
            if error:
                raise HTTPException(status_code=400, detail="Whoop authorization failed.")
            if not code:
                raise HTTPException(status_code=400, detail="No authorization code provided")

            user_id = current_user["id"]
            logger.info("Whoop callback: exchanging code for user %s", user_id)
            token_data = await whoop_service.exchange_code_for_token(code)
            user_info = await whoop_service.get_whoop_user_info(token_data["access_token"])

            await whoop_service.save_integration(
                user_id=user_id,
                access_token=token_data["access_token"],
                refresh_token=token_data.get("refresh_token"),
                expires_in=token_data.get("expires_in", 3600),
                whoop_user_id=str(user_info["user_id"]),
                scope=token_data.get("scope"),
            )
            logger.info("Whoop integration saved for user %s", user_id)

            return {
                "status": "success",
                "message": "Whoop connected successfully",
                "whoop_user_id": user_info["user_id"],
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Whoop callback failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/status")
    async def whoop_status(current_user=Depends(get_current_user)):
        try:
            integration = await whoop_service.get_integration(current_user["id"])
            canonical = await wearable_connection_service.get_connection(current_user["id"], "whoop")
            sleep_status = await _whoop_sleep_status(current_user["id"], canonical)
            if not integration:
                if not canonical:
                    return {"connected": False, **sleep_status}
                return {
                    "connected": canonical.status == "active",
                    "whoop_user_id": canonical.provider_user_id,
                    "connected_at": canonical.created_at.isoformat(),
                    "last_sync_at": canonical.last_sync_at.isoformat() if canonical.last_sync_at else None,
                    "is_active": canonical.status == "active",
                    "sync_hour": 9,
                    **sleep_status,
                }

            return {
                "connected": True,
                "whoop_user_id": canonical.provider_user_id if canonical and canonical.provider_user_id else integration.whoop_user_id,
                "connected_at": integration.connected_at.isoformat(),
                "last_sync_at": (
                    canonical.last_sync_at.isoformat()
                    if canonical and canonical.last_sync_at
                    else (integration.last_sync_at.isoformat() if integration.last_sync_at else None)
                ),
                "is_active": canonical.status == "active" if canonical else integration.is_active,
                "sync_hour": integration.whoop_sync_hour or 9,
                **sleep_status,
            }
        except Exception:
            logger.exception("Whoop status check failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/sync")
    async def whoop_sync(
        days_back: Optional[int] = None,
        force_full_sync: bool = False,
        full_history: bool = False,
        current_user=Depends(get_current_user),
    ):
        try:
            sync_type = "smart incremental"
            if full_history:
                sync_type = "full history"
            elif force_full_sync:
                sync_type = "full (forced)"
            elif days_back is not None:
                sync_type = f"manual ({days_back} days)"

            logger.info(
                "Starting Whoop %s sync for user %s",
                sync_type,
                current_user["id"],
            )
            result = await whoop_service.sync_whoop_data(
                current_user["id"],
                days_back=days_back,
                force_full_sync=force_full_sync,
                full_history=full_history,
            )
            logger.info("Whoop sync completed for user %s", current_user["id"])
            return result
        except Exception as exc:
            logger.exception("Whoop sync failed")
            message = str(exc).strip() or "Request could not be processed."
            lower = message.lower()
            status_code = 500
            if any(
                marker in lower
                for marker in (
                    "authentication failed",
                    "token invalid",
                    "integration not found",
                    "reconnect your whoop integration",
                    "authorization",
                    "unauthorized",
                )
            ):
                status_code = 401
            elif "configuration missing" in lower:
                status_code = 503

            raise HTTPException(
                status_code=status_code,
                detail={
                    "message": message,
                    "display_message": message,
                },
            )

    @router.post("/sync-all")
    async def whoop_sync_all(
        payload: Optional[WhoopBulkSyncRequest] = None,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        try:
            expected_internal_key = os.getenv("INTERNAL_API_KEY")
            if not expected_internal_key:
                logger.error("INTERNAL_API_KEY is not configured")
                raise HTTPException(status_code=503, detail="Service temporarily unavailable")
            if internal_key != expected_internal_key:
                raise HTTPException(status_code=403, detail="Invalid internal API key")

            logger.info("Starting bulk Whoop sync for all users")
            async with get_db_session() as session:
                result = await session.execute(
                    select(WhoopIntegrationDB).where(WhoopIntegrationDB.is_active.is_(True))
                )
                integrations = result.scalars().all()

            sync_results = []
            for integration in integrations:
                canonical = await wearable_connection_service.get_connection(integration.user_id, "whoop")
                settings = {}
                if canonical and canonical.settings_json:
                    try:
                        import json
                        settings = json.loads(canonical.settings_json)
                    except Exception:
                        settings = {}
                enabled = bool(settings.get("auto_sync_enabled", True))
                configured_hour = settings.get("sync_hour", settings.get("whoop_sync_hour", integration.whoop_sync_hour or 9))
                if not enabled:
                    continue
                if payload and payload.hour is not None and int(configured_hour) != int(payload.hour):
                    continue
                try:
                    result = await whoop_service.sync_whoop_data(
                        integration.user_id,
                        days_back=payload.daysBack if payload else None,
                        force_full_sync=payload.forceFullSync if payload else False,
                        full_history=payload.fullHistory if payload else False,
                    )
                    sync_results.append(
                        {
                            "user_id": integration.user_id,
                            "success": True,
                            "data": result,
                        }
                    )
                except Exception:
                    logger.exception(
                        "Whoop bulk sync failed for user %s", integration.user_id
                    )
                    sync_results.append(
                        {
                            "user_id": integration.user_id,
                            "success": False,
                            "error": "Sync failed",
                        }
                    )

            successful_syncs = sum(1 for r in sync_results if r["success"])
            logger.info(
                "Bulk Whoop sync completed: %s/%s successful",
                successful_syncs,
                len(sync_results),
            )
            return {
                "success": True,
                "total_users": len(sync_results),
                "successful_syncs": successful_syncs,
                "results": sync_results,
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Bulk Whoop sync failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.delete("")
    async def whoop_disconnect(current_user=Depends(get_current_user)):
        try:
            success = await whoop_service.disconnect_integration(current_user["id"])
            if not success:
                raise HTTPException(
                    status_code=500,
                    detail={
                        "message": "Failed to disconnect Whoop",
                        "display_message": "Failed to disconnect Whoop. Please try again.",
                    },
                )
            logger.info("Whoop disconnected for user %s", current_user["id"])
            return {
                "status": "success",
                "message": "Whoop disconnected successfully",
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Whoop disconnect failed")
            message = str(exc).strip() or "Request could not be processed."
            raise HTTPException(
                status_code=500,
                detail={
                    "message": message,
                    "display_message": message,
                },
            )

    @router.put("/sync-hour")
    async def update_whoop_sync_hour(
        update_data: WhoopSyncHourUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            if not 0 <= update_data.sync_hour <= 23:
                raise HTTPException(status_code=400, detail="Sync hour must be between 0 and 23")

            async with get_db_session() as session:
                result = await session.execute(
                    select(WhoopIntegrationDB).where(
                        WhoopIntegrationDB.user_id == current_user["id"]
                    )
                )
                integration = result.scalar_one_or_none()
                if not integration:
                    raise HTTPException(status_code=404, detail="Whoop integration not found")

                integration.whoop_sync_hour = update_data.sync_hour
                await session.commit()

            canonical = await wearable_connection_service.get_connection(current_user["id"], "whoop")
            if canonical:
                await wearable_connection_service.get_or_create_connection(
                    user_id=current_user["id"],
                    provider="whoop",
                    auth_method=canonical.auth_method,
                    provider_user_id=canonical.provider_user_id,
                    token_expires_at=canonical.token_expires_at,
                    settings={"whoop_sync_hour": update_data.sync_hour},
                    status=canonical.status,
                )

            logger.info(
                "Updated Whoop sync hour to %s for user %s",
                update_data.sync_hour,
                current_user["id"],
            )
            return {
                "status": "success",
                "message": f"Sync hour updated to {update_data.sync_hour}:00",
                "sync_hour": update_data.sync_hour,
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Whoop sync-hour update failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    return router


# ── Tesla Integration Router ─────────────────────────────


def create_tesla_router(
    *,
    get_current_user: Callable[..., Any],
    tesla_service: Any,
) -> APIRouter:
    """Build Tesla integration router with injected dependencies."""
    router = APIRouter(prefix="/api/integrations/tesla", tags=["integrations"])

    @router.post("/callback")
    async def tesla_callback(
        code: str,
        current_user=Depends(get_current_user),
    ):
        try:
            if not code:
                raise HTTPException(status_code=400, detail="No authorization code provided")

            user_id = current_user["id"]
            logger.info("Tesla callback: exchanging code for user %s", user_id)
            token_data = await tesla_service.exchange_code_for_token(code)

            await tesla_service.save_connection(
                user_id=user_id,
                access_token=token_data["access_token"],
                refresh_token=token_data.get("refresh_token"),
                expires_in=token_data.get("expires_in", 28800),
            )
            logger.info("Tesla integration saved for user %s", user_id)

            # Discover vehicles and do initial odometer snapshot
            try:
                access_token = token_data["access_token"]
                vehicles = await tesla_service.list_vehicles(access_token)
                if vehicles:
                    # Store vehicle info + take first odometer reading (no miles logged yet)
                    await tesla_service.sync_odometer(user_id)
            except Exception:
                logger.warning("Initial Tesla vehicle discovery failed (non-fatal)", exc_info=True)

            return {
                "status": "success",
                "message": "Tesla connected successfully",
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Tesla callback failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/status")
    async def tesla_status(current_user=Depends(get_current_user)):
        try:
            return await tesla_service.get_connection_status(current_user["id"])
        except Exception:
            logger.exception("Tesla status check failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/sync")
    async def tesla_sync(current_user=Depends(get_current_user)):
        try:
            logger.info("Starting Tesla odometer sync for user %s", current_user["id"])
            result = await tesla_service.sync_odometer(current_user["id"])
            return result
        except Exception as exc:
            logger.exception("Tesla sync failed")
            message = str(exc).strip() or "Request could not be processed."
            raise HTTPException(status_code=500, detail=message)

    @router.post("/backfill-odometer")
    async def tesla_backfill_odometer(
        payload: "TeslaBackfillRequest",
        current_user=Depends(get_current_user),
    ):
        try:
            logger.info(
                "Tesla backfill for user %s: previous_odometer=%.1f, date=%s",
                current_user["id"],
                payload.previous_odometer,
                payload.as_of_date,
            )
            result = await tesla_service.backfill_from_odometer(
                user_id=current_user["id"],
                previous_odometer=payload.previous_odometer,
                as_of_date=payload.as_of_date,
            )
            return result
        except Exception as exc:
            logger.exception("Tesla backfill failed")
            raise HTTPException(status_code=500, detail=str(exc) or "Backfill failed")

    @router.post("/sync-all")
    async def tesla_sync_all(
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        """Bulk sync all active Tesla connections (called by Trigger.dev)."""
        try:
            expected_internal_key = os.getenv("INTERNAL_API_KEY")
            if not expected_internal_key:
                raise HTTPException(status_code=503, detail="INTERNAL_API_KEY not configured")
            if internal_key != expected_internal_key:
                raise HTTPException(status_code=403, detail="Invalid internal API key")

            logger.info("Starting bulk Tesla sync for all users")
            from database.models import WearableConnectionDB as WC

            async with get_db_session() as session:
                result = await session.execute(
                    select(WC).where(
                        WC.provider == "tesla",
                        WC.status == "active",
                    )
                )
                connections = result.scalars().all()

            sync_results = []
            for conn in connections:
                try:
                    r = await tesla_service.sync_odometer(conn.user_id)
                    sync_results.append({"user_id": conn.user_id, "success": True, "data": r})
                except Exception:
                    logger.exception("Tesla bulk sync failed for user %s", conn.user_id)
                    sync_results.append({"user_id": conn.user_id, "success": False, "error": "Sync failed"})

            successful = sum(1 for r in sync_results if r["success"])
            logger.info("Bulk Tesla sync completed: %s/%s successful", successful, len(sync_results))
            return {
                "success": True,
                "total_users": len(sync_results),
                "successful_syncs": successful,
                "results": sync_results,
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Bulk Tesla sync failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.delete("")
    async def tesla_disconnect(current_user=Depends(get_current_user)):
        try:
            await tesla_service.disconnect(current_user["id"])
            logger.info("Tesla disconnected for user %s", current_user["id"])
            return {"status": "success", "message": "Tesla disconnected successfully"}
        except Exception:
            logger.exception("Tesla disconnect failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    return router
