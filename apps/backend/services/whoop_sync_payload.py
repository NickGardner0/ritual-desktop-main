"""
Whoop sync payload orchestration.

This module keeps Whoop API fetch/write orchestration outside the legacy
WhoopService class. The service remains as a compatibility facade, while
canonical persistence/projection continues through wearables_unified.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError

from database.connection import get_db_session
from database.models import WhoopIntegrationDB
from services.wearables_unified import (
    wearable_connection_service,
    wearable_sync_service,
)
from services.whoop_tinybird_sink import ingest_whoop_tinybird

logger = logging.getLogger(__name__)


def latest_sleep_record_metadata(sleep_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    records = list((sleep_data or {}).get("records") or [])
    candidates: List[tuple[str, Dict[str, Any]]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        sort_key = str(record.get("end") or record.get("start") or "")
        if sort_key:
            candidates.append((sort_key, record))

    if not candidates:
        return {
            "latest_upstream_sleep_date": None,
            "latest_upstream_sleep_start": None,
            "latest_upstream_sleep_end": None,
            "latest_upstream_sleep_score_state": None,
            "latest_upstream_sleep_id": None,
            "latest_upstream_sleep_cycle_id": None,
        }

    _, latest = max(candidates, key=lambda item: item[0])
    sleep_end = str(latest.get("end") or "")
    sleep_start = str(latest.get("start") or "")
    date_value = (sleep_end or sleep_start)[:10] or None
    return {
        "latest_upstream_sleep_date": date_value,
        "latest_upstream_sleep_start": sleep_start or None,
        "latest_upstream_sleep_end": sleep_end or None,
        "latest_upstream_sleep_score_state": latest.get("score_state"),
        "latest_upstream_sleep_id": latest.get("id"),
        "latest_upstream_sleep_cycle_id": latest.get("cycle_id"),
    }


def _record_date(record: Dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = record.get(key)
        if isinstance(value, datetime):
            return value.date().isoformat()
        if value:
            date_value = str(value)[:10]
            if len(date_value) == 10:
                return date_value
    return None


def affected_metric_fact_dates(
    *,
    recovery_data: Optional[Dict[str, Any]],
    sleep_data: Optional[Dict[str, Any]],
    workout_data: Optional[Dict[str, Any]],
    cycle_data: Optional[Dict[str, Any]],
) -> List[str]:
    dates: set[str] = set()

    for record in (sleep_data or {}).get("records") or []:
        if isinstance(record, dict):
            date_value = _record_date(record, "end", "start", "updated_at", "created_at")
            if date_value:
                dates.add(date_value)

    for record in (workout_data or {}).get("records") or []:
        if isinstance(record, dict):
            date_value = _record_date(record, "start", "end", "updated_at", "created_at")
            if date_value:
                dates.add(date_value)

    for record in (recovery_data or {}).get("records") or []:
        if isinstance(record, dict):
            date_value = _record_date(record, "created_at", "updated_at", "start", "end")
            if date_value:
                dates.add(date_value)

    for record in (cycle_data or {}).get("records") or []:
        if isinstance(record, dict):
            date_value = _record_date(record, "start", "end", "updated_at", "created_at")
            if date_value:
                dates.add(date_value)

    return sorted(dates)


async def fetch_whoop_sync_payload(
    service: Any,
    user_id: str,
    days_back: int = None,
    force_full_sync: bool = False,
    full_history: bool = False,
) -> Dict[str, Any]:
    """
    Fetch Whoop data with smart incremental syncing.

    The passed service supplies token and integration helpers while this module
    owns the orchestration logic. The returned payload is intentionally raw and
    is written through canonical wearables_unified ingest.
    """
    access_token = await service.get_valid_access_token(user_id)

    if not access_token:
        raise Exception("Whoop integration not found or token invalid")

    integration = await service.get_integration(user_id)
    enabled_metrics = await service._get_enabled_whoop_sync_metrics(user_id)
    logger.info("📋 Whoop metric mappings enabled: %s", enabled_metrics)

    end_date = datetime.utcnow()
    default_initial_sync_days = max(service.DEFAULT_INITIAL_SYNC_DAYS, 1)
    overlap_days = max(service.DEFAULT_RECONNECT_OVERLAP_DAYS, 1)

    if full_history:
        full_history_days = max(service.DEFAULT_FULL_HISTORY_SYNC_DAYS, default_initial_sync_days)
        start_date = end_date - timedelta(days=full_history_days)
        logger.info("📅 Full history sync requested: fetching last %s days", full_history_days)
    elif days_back is not None:
        requested_days = max(int(days_back), 1)
        sync_days = min(requested_days, service.MAX_MANUAL_SYNC_DAYS)
        start_date = end_date - timedelta(days=sync_days)
        if sync_days != requested_days:
            logger.info("📅 Manual sync request clamped from %s to %s days", requested_days, sync_days)
        else:
            logger.info("📅 Manual sync: fetching last %s days", sync_days)
    elif force_full_sync:
        start_date = end_date - timedelta(days=default_initial_sync_days)
        logger.info("📅 Full sync requested: fetching last %s days", default_initial_sync_days)
    elif integration and integration.last_sync_at:
        last_sync = integration.last_sync_at
        days_since_sync = (end_date - last_sync).days
        sync_days = min(max(days_since_sync + overlap_days, 1), service.MAX_MANUAL_SYNC_DAYS)
        start_date = end_date - timedelta(days=sync_days)
        logger.info(
            "📅 Incremental sync: last sync was %s days ago, fetching last %s days",
            days_since_sync,
            sync_days,
        )
    else:
        inferred_last_sync = await service._infer_last_sync_from_stored_data(user_id)
        if inferred_last_sync:
            days_since_sync = (end_date - inferred_last_sync).days
            sync_days = min(max(days_since_sync + overlap_days, 1), service.MAX_MANUAL_SYNC_DAYS)
            start_date = end_date - timedelta(days=sync_days)
            logger.info(
                "📅 Recovered incremental sync: inferred checkpoint was %s days ago, fetching last %s days",
                days_since_sync,
                sync_days,
            )
        else:
            start_date = end_date - timedelta(days=default_initial_sync_days)
            logger.info("📅 First sync: fetching last %s days of historical data", default_initial_sync_days)

    try:
        fetched = await service.api_client.fetch_enabled_data(
            access_token=access_token,
            start_date=start_date,
            end_date=end_date,
            enabled_metrics=enabled_metrics,
        )
    except Exception as exc:
        logger.warning("⚠️  Error fetching Whoop data: %s", str(exc))
        raise

    if not fetched.any_api_success:
        total_records = sum(fetched.synced_data.values())
        if total_records == 0:
            raise Exception(
                "Whoop API authentication failed - all requests returned 401. "
                "Please disconnect and reconnect your Whoop integration to get fresh tokens."
            )

    return {
        "user_id": user_id,
        "access_token": access_token,
        "integration": {
            "id": integration.id if integration else user_id,
            "whoop_user_id": integration.whoop_user_id if integration else user_id,
            "refresh_token": integration.refresh_token if integration else None,
            "token_expires_at": integration.token_expires_at if integration else None,
            "whoop_sync_hour": integration.whoop_sync_hour if integration else 9,
        },
        "start_date": start_date,
        "end_date": end_date,
        "recovery_data": fetched.recovery_data,
        "sleep_data": fetched.sleep_data,
        "workout_data": fetched.workout_data,
        "cycle_data": fetched.cycle_data,
        "synced_data": fetched.synced_data,
        "any_api_success": fetched.any_api_success,
    }


async def write_whoop_sync_payload(
    service: Any,
    user_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    integration = payload["integration"]
    access_token = payload["access_token"]
    start_date = payload["start_date"]
    end_date = payload["end_date"]
    recovery_data = payload.get("recovery_data")
    sleep_data: Dict[str, Any] = payload.get("sleep_data") or {"records": []}
    workout_data = payload.get("workout_data")
    cycle_data = payload.get("cycle_data")
    synced_data = payload.get("synced_data") or {"recovery": 0, "sleep": 0, "workouts": 0, "cycles": 0}
    canonical_sync_succeeded = False
    metric_facts_result: Optional[Dict[str, Any]] = None
    metric_facts_error: Optional[str] = None
    canonical_sync_error: Optional[str] = None

    if service.tinybird_enabled:
        try:
            await ingest_whoop_tinybird(
                service.tinybird,
                user_id=user_id,
                whoop_connection_id=integration["id"],
                recovery_data=recovery_data,
                sleep_data=sleep_data,
                workout_data=workout_data,
                cycle_data=cycle_data,
            )
            logger.info("✅ Whoop data synced to Tinybird for analytics")
        except Exception as tb_error:
            logger.warning("⚠️  Tinybird ingestion failed (non-fatal): %s", str(tb_error))

    try:
        canonical_result = await wearable_sync_service.ingest_whoop_data(
            user_id=user_id,
            provider_user_id=integration["whoop_user_id"],
            recovery_data=recovery_data,
            sleep_data=sleep_data,
            workout_data=workout_data,
            cycle_data=cycle_data,
            access_token=access_token,
            refresh_token=integration["refresh_token"],
            token_expires_at=integration["token_expires_at"],
        )
        canonical_sync_succeeded = bool(canonical_result.get("post_ingest_success", True))
        metric_facts_result = canonical_result.get("metric_facts")
        metric_facts_error = canonical_result.get("metric_facts_error")
        canonical_sync_error = metric_facts_error
        if canonical_sync_succeeded:
            logger.info("✅ Whoop data synced through canonical wearable storage and post-ingest")
        else:
            logger.warning(
                "⚠️  Whoop canonical wearable sync completed but post-ingest failed: %s",
                canonical_sync_error,
            )
    except Exception as db_error:
        canonical_sync_error = str(db_error)
        metric_facts_error = canonical_sync_error
        logger.warning("⚠️  Canonical wearable sync failed (non-fatal): %s", canonical_sync_error)

    if canonical_sync_succeeded:
        try:
            latest_cycle_date = None
            if cycle_data and cycle_data.get("records"):
                latest_cycle_date = max(
                    (
                        str(record.get("start", ""))[:10]
                        for record in cycle_data["records"]
                        if record.get("start")
                    ),
                    default=None,
                )
            latest_sleep_metadata = latest_sleep_record_metadata(sleep_data)

            await wearable_connection_service.get_or_create_connection(
                user_id=user_id,
                provider="whoop",
                auth_method="oauth",
                provider_user_id=integration["whoop_user_id"],
                access_token=access_token,
                refresh_token=integration["refresh_token"],
                token_expires_at=integration["token_expires_at"],
                settings={
                    "whoop_sync_hour": integration["whoop_sync_hour"] or 9,
                    "sync_hour": integration["whoop_sync_hour"] or 9,
                    "auto_sync_enabled": True,
                    "latest_upstream_cycle_date": latest_cycle_date,
                    **latest_sleep_metadata,
                },
                status="active",
            )
        except Exception as connection_error:
            logger.warning("⚠️  Failed to persist Whoop upstream sync metadata: %s", str(connection_error))
    else:
        logger.warning(
            "⚠️  Skipping Whoop sync metadata/checkpoint update because canonical post-ingest did not succeed"
        )

    if canonical_sync_succeeded:
        async with get_db_session() as session:
            try:
                synced_at = datetime.utcnow()

                def _mark_synced(sync_session):
                    sync_session.execute(
                        update(WhoopIntegrationDB)
                        .where(WhoopIntegrationDB.user_id == user_id)
                        .where(WhoopIntegrationDB.is_active == True)
                        .values(last_sync_at=synced_at)
                    )

                await session.run_sync(_mark_synced)
                await session.commit()
            except SQLAlchemyError as exc:
                logger.warning("⚠️  Error updating last_sync_at: %s", str(exc))
    else:
        logger.warning(
            "⚠️  Preserving Whoop last_sync_at because canonical ingest/post-ingest failed: %s",
            canonical_sync_error or metric_facts_error or "unknown error",
        )

    days_synced = (end_date - start_date).days

    return {
        "status": "success" if canonical_sync_succeeded else "partial",
        "synced_at": datetime.utcnow().isoformat(),
        "sync_period": {
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "days": days_synced,
        },
        "data": synced_data,
        "data_freshness": latest_sleep_record_metadata(sleep_data),
        "metric_facts": metric_facts_result,
        "metric_facts_error": metric_facts_error,
        "canonical_sync_error": canonical_sync_error,
    }
