"""Integration API routers extracted from main.py."""

import logging
import os
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from database.connection import get_db_session
from database.models import WhoopIntegrationDB
from services.unified_wearables_service import wearable_connection_service

logger = logging.getLogger(__name__)


class WhoopSyncHourUpdate(BaseModel):
    sync_hour: int


class WhoopBulkSyncRequest(BaseModel):
    daysBack: Optional[int] = None
    hour: Optional[int] = None
    forceFullSync: bool = False


def create_whoop_router(
    *,
    get_current_user: Callable[..., Any],
    whoop_service: Any,
) -> APIRouter:
    """Build Whoop integration router with injected dependencies."""
    router = APIRouter(prefix="/api/integrations/whoop", tags=["integrations"])

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
            if not integration:
                if not canonical:
                    return {"connected": False}
                return {
                    "connected": canonical.status == "active",
                    "whoop_user_id": canonical.provider_user_id,
                    "connected_at": canonical.created_at.isoformat(),
                    "last_sync_at": canonical.last_sync_at.isoformat() if canonical.last_sync_at else None,
                    "is_active": canonical.status == "active",
                    "sync_hour": 9,
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
            }
        except Exception:
            logger.exception("Whoop status check failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/sync")
    async def whoop_sync(
        days_back: Optional[int] = None,
        force_full_sync: bool = False,
        current_user=Depends(get_current_user),
    ):
        try:
            sync_type = "smart incremental"
            if force_full_sync:
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
            )
            logger.info("Whoop sync completed for user %s", current_user["id"])
            return result
        except Exception:
            logger.exception("Whoop sync failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

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
                raise HTTPException(status_code=500, detail="Failed to disconnect Whoop")
            logger.info("Whoop disconnected for user %s", current_user["id"])
            return {
                "status": "success",
                "message": "Whoop disconnected successfully",
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Whoop disconnect failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

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
