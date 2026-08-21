"""Background scheduler loops for the Ritual backend."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from database.connection import get_db_session

logger = logging.getLogger(__name__)


async def internal_scheduler_loop(tesla_service) -> None:
    """Background loop that fires once per hour to run scheduled tasks."""
    from datetime import datetime as _dt, timezone as _tz

    await asyncio.sleep(30)
    logger.info("⏰ Internal scheduler loop started (runs every hour)")

    while True:
        current_hour = _dt.now(_tz.utc).hour
        logger.info("⏰ Scheduler tick — UTC hour %d", current_hour)

        try:
            from services.proactive_sms_service import run_hourly_proactive_sweep

            results = await run_hourly_proactive_sweep()
            total_sent = sum(r.get("sent", 0) for r in results)
            logger.info(
                "📬 Proactive SMS sweep complete: %d messages sent across %d trigger types",
                total_sent,
                len(results),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Proactive SMS sweep failed: %s", exc)

        try:
            from services.whoop_service import whoop_service as _whoop
            from services.wearables_unified import wearable_connection_service as _wc
            from database.models import WhoopIntegrationDB
            from sqlalchemy import select as _sel
            import json as _json

            async with get_db_session() as session:
                rows = await session.execute(
                    _sel(WhoopIntegrationDB).where(WhoopIntegrationDB.is_active.is_(True))
                )
                integrations = rows.scalars().all()

            synced = 0
            for integration in integrations:
                canonical = await _wc.get_connection(integration.user_id, "whoop")
                settings = {}
                if canonical and canonical.settings_json:
                    try:
                        settings = _json.loads(canonical.settings_json)
                    except Exception:
                        pass
                if not settings.get("auto_sync_enabled", True):
                    continue
                configured_hour = int(
                    settings.get(
                        "sync_hour",
                        settings.get(
                            "whoop_sync_hour",
                            integration.whoop_sync_hour or 9,
                        ),
                    )
                )
                if configured_hour != current_hour:
                    continue
                try:
                    await _whoop.sync_whoop_data(integration.user_id)
                    synced += 1
                except Exception:
                    logger.exception("Whoop sync failed for user %s", integration.user_id)
            if synced:
                logger.info("🏋️ Whoop sync: %d users synced at hour %d", synced, current_hour)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Whoop scheduler sync failed: %s", exc)

        try:
            from services.oura_service import oura_service as _oura
            from services.garmin_service import garmin_service as _garmin
            from database.models import WearableConnectionDB
            from sqlalchemy import select as _sel
            import json as _json

            for provider, svc in [("oura", _oura), ("garmin", _garmin)]:
                async with get_db_session() as session:
                    rows = await session.execute(
                        _sel(WearableConnectionDB).where(
                            WearableConnectionDB.provider == provider,
                            WearableConnectionDB.status == "active",
                        )
                    )
                    connections = rows.scalars().all()

                synced = 0
                for conn in connections:
                    settings = {}
                    if conn.settings_json:
                        try:
                            settings = _json.loads(conn.settings_json)
                        except Exception:
                            pass
                    if not settings.get("auto_sync_enabled", True):
                        continue
                    configured_hour = int(settings.get("sync_hour", 9))
                    if configured_hour != current_hour:
                        continue
                    try:
                        if provider == "oura":
                            await svc.sync_oura_data(conn.user_id)
                        else:
                            await svc.sync_garmin_account(conn.user_id)
                        synced += 1
                    except Exception:
                        logger.exception(
                            "%s sync failed for user %s",
                            provider.title(),
                            conn.user_id,
                        )
                if synced:
                    logger.info(
                        "⌚ %s sync: %d users synced at hour %d",
                        provider.title(),
                        synced,
                        current_hour,
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Oura/Garmin scheduler sync failed: %s", exc)

        try:
            from database.models import WearableConnectionDB
            from sqlalchemy import select as _sel

            async with get_db_session() as session:
                rows = await session.execute(
                    _sel(WearableConnectionDB).where(
                        WearableConnectionDB.provider == "tesla",
                        WearableConnectionDB.status == "active",
                    )
                )
                connections = rows.scalars().all()

            synced = 0
            for conn in connections:
                settings = {}
                if conn.settings_json:
                    try:
                        import json as _json

                        settings = _json.loads(conn.settings_json)
                    except Exception:
                        pass
                if not settings.get("auto_sync_enabled", True):
                    continue
                configured_hour = int(settings.get("sync_hour", 9))
                if configured_hour != current_hour:
                    continue
                try:
                    await tesla_service.sync_odometer(conn.user_id)
                    synced += 1
                except Exception:
                    logger.exception("Tesla sync failed for user %s", conn.user_id)
            if synced:
                logger.info("🚗 Tesla sync: %d users synced at hour %d", synced, current_hour)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Tesla scheduler sync failed: %s", exc)

        try:
            from services.financial_sync_service import financial_sync_service as _fin

            result = await _fin.sync_all_active(hour=current_hour)
            synced = result.get("successful_syncs", 0)
            if synced:
                logger.info(
                    "💰 Financial sync: %d connections synced at hour %d",
                    synced,
                    current_hour,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Financial scheduler sync failed: %s", exc)

        try:
            from services.location.retention import cleanup_old_pings

            deleted = await cleanup_old_pings()
            if deleted:
                logger.info("📍 Location retention removed %d raw pings", deleted)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Location retention cleanup failed: %s", exc)

        logger.info("⏰ Scheduler tick complete — sleeping 1 hour")
        await asyncio.sleep(3600)


async def report_scheduler_loop() -> None:
    """Dispatch and process scheduled habit reports on a shorter cadence."""
    await asyncio.sleep(45)
    logger.info("📨 Report scheduler loop started (runs every 15 minutes)")

    while True:
        try:
            from services.reports_service import reports_service

            result = await reports_service.scheduler_tick()
            queued = int(result.get("queued", 0) or 0)
            processed = int(result.get("processed", 0) or 0)
            failed = int(result.get("failed", 0) or 0)
            if queued or processed or failed:
                logger.info(
                    "📨 Report scheduler tick: queued=%d processed=%d failed=%d",
                    queued,
                    processed,
                    failed,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Report scheduler tick failed: %s", exc)

        await asyncio.sleep(900)


async def workflow_scheduler_loop() -> None:
    """Dispatch and process scheduled workflow runs on a shorter cadence."""
    await asyncio.sleep(50)
    logger.info("🧭 Workflow scheduler loop started (runs every 5 minutes)")

    while True:
        try:
            from services.workflow_service import workflow_service

            result = await workflow_service.scheduler_tick()
            queued = int(result.get("queued", 0) or 0)
            processed = int(result.get("processed", 0) or 0)
            failed = int(result.get("failed", 0) or 0)
            if queued or processed or failed:
                logger.info(
                    "🧭 Workflow scheduler tick: queued=%d processed=%d failed=%d",
                    queued,
                    processed,
                    failed,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Workflow scheduler tick failed: %s", exc)

        await asyncio.sleep(300)


async def ambient_scheduler_loop() -> None:
    """Evaluate ambient workflow signals and process resulting runs."""
    await asyncio.sleep(65)
    logger.info("🌤️ Ambient scheduler loop started (runs every 15 minutes)")

    while True:
        try:
            from services.workflow_service import workflow_service

            result = await workflow_service.ambient_tick()
            queued = int(result.get("queued", 0) or 0)
            suppressed = int(result.get("suppressed", 0) or 0)
            processed = int(result.get("processed", 0) or 0)
            failed = int(result.get("failed", 0) or 0)
            if queued or suppressed or processed or failed:
                logger.info(
                    "🌤️ Ambient scheduler tick: queued=%d suppressed=%d processed=%d failed=%d",
                    queued,
                    suppressed,
                    processed,
                    failed,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Ambient scheduler tick failed: %s", exc)

        await asyncio.sleep(900)


async def sms_copilot_loop() -> None:
    """Run narrow deterministic copilot checks every five minutes."""
    from sqlalchemy import select
    from database.models import UserDB

    await asyncio.sleep(45)
    logger.info("📲 SMS copilot loop started (runs every 5 minutes)")

    while True:
        candidate_count = 0
        sent_count = 0
        try:
            from services.sms_copilot_dispatch_service import sms_copilot_dispatch_service
            from services.sms_copilot_signal_service import sms_copilot_signal_service

            now_utc = datetime.now(timezone.utc)

            async with get_db_session() as session:
                result = await session.execute(
                    select(UserDB.id).where(
                        UserDB.phone_number.isnot(None),
                        UserDB.onboarding_completed.is_(True),
                    )
                )
                user_ids = [row[0] for row in result.all()]

            for user_id in user_ids:
                candidates = await sms_copilot_signal_service.evaluate_user(
                    user_id=user_id,
                    now_utc=now_utc,
                )
                candidate_count += len(candidates)
                for candidate in candidates:
                    event = await sms_copilot_dispatch_service.dispatch_candidate(candidate)
                    if event.status == "sent":
                        sent_count += 1

            if candidate_count or sent_count:
                logger.info(
                    "📲 SMS copilot tick complete: candidates=%d sent=%d users=%d",
                    candidate_count,
                    sent_count,
                    len(user_ids),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ SMS copilot loop failed: %s", exc)

        await asyncio.sleep(300)


async def wearable_ingest_job_loop() -> None:
    """Process queued wearable backfill/replay jobs in-process."""
    await asyncio.sleep(60)
    logger.info("🧵 Wearable ingest job loop started (runs every 15 seconds)")

    while True:
        try:
            from services.wearable_ingest_job_service import wearable_ingest_job_service

            result = await wearable_ingest_job_service.process_next_job()
            if result:
                logger.info(
                    "🧵 Wearable ingest job processed: job_id=%s status=%s",
                    result.get("job_id"),
                    result.get("status"),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Wearable ingest job loop failed: %s", exc)

        await asyncio.sleep(15)


async def wearable_maintenance_loop() -> None:
    """Compact historical wearable rows and purge expired raw payloads nightly."""
    await asyncio.sleep(90)
    logger.info("🧹 Wearable maintenance loop started (runs every 24 hours)")

    while True:
        try:
            from services.wearables_unified import wearable_sync_service
            from services.wearable_maintenance_service import wearable_maintenance_service

            run = await wearable_sync_service.start_sync_run(
                provider="system",
                trigger="maintenance",
                metadata={"task": "wearable_maintenance"},
            )
            result = await wearable_maintenance_service.run_once()
            items_written = sum(
                int(block.get("written", 0))
                for block in result.values()
                if isinstance(block, dict)
            )
            items_deleted = int(result.get("raw_payloads", {}).get("deleted_payloads", 0))
            await wearable_sync_service.finish_sync_run(
                run.id,
                status="success",
                items_written=items_written,
                items_deleted=items_deleted,
            )
            logger.info("🧹 Wearable maintenance complete: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Wearable maintenance loop failed: %s", exc)

        await asyncio.sleep(86400)


async def wearable_event_outbox_loop() -> None:
    """Process queued internal wearable outbox events in-process."""
    await asyncio.sleep(75)
    logger.info("📮 Wearable event outbox loop started (runs every 15 seconds)")

    while True:
        try:
            from services.wearable_event_outbox_service import wearable_event_outbox_service

            result = await wearable_event_outbox_service.process_next_event()
            if result:
                logger.info(
                    "📮 Wearable outbox event processed: event_id=%s status=%s",
                    result.get("event_id"),
                    result.get("status"),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Wearable outbox loop failed: %s", exc)

        await asyncio.sleep(15)
