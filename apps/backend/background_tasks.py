"""Background scheduler loops for the Ritual backend."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from database.connection import get_db_session

logger = logging.getLogger(__name__)


async def _sleep_after_clock_tick(tick_started_at: datetime, cadence_seconds: int) -> None:
    """Align to the next UTC occurrence, or catch up immediately after an overrun."""
    tick_seconds = tick_started_at.timestamp()
    next_boundary = (int(tick_seconds) // cadence_seconds + 1) * cadence_seconds
    remaining = next_boundary - datetime.now(timezone.utc).timestamp()
    await asyncio.sleep(max(0.0, remaining))


async def _run_proactive_sms(trigger_type: str = "all", target_hour: int | None = None):
    from services.proactive_sms_service import run_hourly_proactive_sweep, run_proactive_sweep

    if trigger_type == "all":
        results = await run_hourly_proactive_sweep()
        total_sent = sum(result.get("sent", 0) for result in results)
        logger.info(
            "📬 Proactive SMS sweep complete: %d messages sent across %d trigger types",
            total_sent,
            len(results),
        )
        return results
    return await run_proactive_sweep(trigger_type=trigger_type, target_hour=target_hour)


async def run_proactive_sms_scheduler_job(
    *,
    trigger_type: str = "all",
    target_hour: int | None = None,
    now: datetime | None = None,
):
    """Run internal or legacy external delivery through the same occurrence claim."""
    from services.scheduler_service import run_clock_job

    scope_key = "global" if trigger_type == "all" else f"trigger:{trigger_type}"
    return await run_clock_job(
        "proactive_sms",
        lambda: _run_proactive_sms(trigger_type, target_hour),
        scope_key=scope_key,
        now=now,
    )


async def _run_whoop_auto_sync(current_hour: int) -> int:
    import json
    from sqlalchemy import select

    from database.models import WhoopIntegrationDB
    from services.wearables_unified import wearable_connection_service
    from services.whoop_service import whoop_service

    async with get_db_session() as session:
        rows = await session.execute(
            select(WhoopIntegrationDB).where(WhoopIntegrationDB.is_active.is_(True))
        )
        integrations = rows.scalars().all()
    synced = 0
    for integration in integrations:
        canonical = await wearable_connection_service.get_connection(integration.user_id, "whoop")
        try:
            settings = json.loads(canonical.settings_json) if canonical and canonical.settings_json else {}
        except Exception:
            settings = {}
        if not settings.get("auto_sync_enabled", True):
            continue
        configured_hour = int(
            settings.get(
                "sync_hour",
                settings.get("whoop_sync_hour", integration.whoop_sync_hour or 9),
            )
        )
        if configured_hour != current_hour:
            continue
        try:
            await whoop_service.sync_whoop_data(integration.user_id)
            synced += 1
        except Exception:
            logger.exception("Whoop sync failed for user %s", integration.user_id)
    if synced:
        logger.info("🏋️ Whoop sync: %d users synced at hour %d", synced, current_hour)
    return synced


async def _run_oura_or_garmin_auto_sync(provider: str, current_hour: int) -> int:
    import json
    from sqlalchemy import select

    from database.models import WearableConnectionDB
    from services.garmin_service import garmin_service
    from services.oura_service import oura_service

    services = {"oura": oura_service, "garmin": garmin_service}
    if provider not in services:
        raise ValueError(f"Unsupported scheduled wearable provider: {provider}")
    service = services[provider]
    async with get_db_session() as session:
        rows = await session.execute(
            select(WearableConnectionDB).where(
                WearableConnectionDB.provider == provider,
                WearableConnectionDB.status == "active",
            )
        )
        connections = rows.scalars().all()
    synced = 0
    for connection in connections:
        try:
            settings = json.loads(connection.settings_json) if connection.settings_json else {}
        except Exception:
            settings = {}
        if not settings.get("auto_sync_enabled", True) or int(settings.get("sync_hour", 9)) != current_hour:
            continue
        try:
            if provider == "oura":
                await service.sync_oura_data(connection.user_id)
            else:
                await service.sync_garmin_account(connection.user_id)
            synced += 1
        except Exception:
            logger.exception("%s sync failed for user %s", provider.title(), connection.user_id)
    if synced:
        logger.info("⌚ %s sync: %d users synced at hour %d", provider.title(), synced, current_hour)
    return synced


async def run_whoop_scheduler_job(work, *, now: datetime | None = None):
    """Fence internal and retained external Whoop clock delivery identically."""
    from services.scheduler_service import run_clock_job

    return await run_clock_job("whoop_auto_sync", work, now=now)


async def run_oura_garmin_scheduler_job(
    provider: str,
    work,
    *,
    now: datetime | None = None,
):
    """Fence each provider without letting one provider suppress the other."""
    from services.scheduler_service import run_clock_job

    if provider not in {"oura", "garmin"}:
        raise ValueError(f"Unsupported scheduled wearable provider: {provider}")
    return await run_clock_job(
        "oura_garmin_auto_sync",
        work,
        scope_key=f"provider:{provider}",
        now=now,
    )


async def run_tesla_scheduler_job(work, *, now: datetime | None = None):
    """Fence internal and retained external Tesla clock delivery identically."""
    from services.scheduler_service import run_clock_job

    return await run_clock_job("tesla_odometer_sync", work, now=now)


async def run_financial_scheduler_job(work, *, now: datetime | None = None):
    """Fence internal and retained external financial clock delivery identically."""
    from services.scheduler_service import run_clock_job

    return await run_clock_job("financial_sync", work, now=now)


async def _run_tesla_odometer_sync(tesla_service, current_hour: int) -> int:
    import json
    from sqlalchemy import select

    from database.models import WearableConnectionDB

    async with get_db_session() as session:
        rows = await session.execute(
            select(WearableConnectionDB).where(
                WearableConnectionDB.provider == "tesla",
                WearableConnectionDB.status == "active",
            )
        )
        connections = rows.scalars().all()
    synced = 0
    for connection in connections:
        try:
            settings = json.loads(connection.settings_json) if connection.settings_json else {}
        except Exception:
            settings = {}
        if not settings.get("auto_sync_enabled", True) or int(settings.get("sync_hour", 9)) != current_hour:
            continue
        try:
            await tesla_service.sync_odometer(connection.user_id)
            synced += 1
        except Exception:
            logger.exception("Tesla sync failed for user %s", connection.user_id)
    if synced:
        logger.info("🚗 Tesla sync: %d users synced at hour %d", synced, current_hour)
    return synced


async def _run_financial_sync(current_hour: int):
    from services.financial_sync_service import financial_sync_service

    result = await financial_sync_service.sync_all_active(hour=current_hour)
    synced = result.get("successful_syncs", 0)
    if synced:
        logger.info("💰 Financial sync: %d connections synced at hour %d", synced, current_hour)
    return result


async def _run_location_retention() -> int:
    from services.location.retention import cleanup_old_pings
    from services.scheduler_service import cleanup_scheduler_occurrences

    deleted = await cleanup_old_pings()
    scheduler_claims_deleted = await cleanup_scheduler_occurrences()
    if deleted:
        logger.info("📍 Location retention removed %d raw pings", deleted)
    if scheduler_claims_deleted:
        logger.info("🧹 Scheduler retention removed %d terminal occurrence claims", scheduler_claims_deleted)
    return deleted + scheduler_claims_deleted


async def internal_scheduler_loop(tesla_service) -> None:
    """Run the six hourly domain owners behind independent occurrence claims."""
    from services.scheduler_service import run_clock_job

    await asyncio.sleep(30)
    logger.info("⏰ Internal scheduler loop started (runs every hour)")
    while True:
        tick_now = datetime.now(timezone.utc)
        current_hour = tick_now.hour
        jobs = (
            (
                "proactive_sms",
                lambda: run_proactive_sms_scheduler_job(now=tick_now),
            ),
            (
                "whoop_auto_sync",
                lambda: run_whoop_scheduler_job(
                    lambda: _run_whoop_auto_sync(current_hour),
                    now=tick_now,
                ),
            ),
            (
                "oura_garmin_auto_sync",
                lambda: run_oura_garmin_scheduler_job(
                    "oura",
                    lambda: _run_oura_or_garmin_auto_sync("oura", current_hour),
                    now=tick_now,
                ),
            ),
            (
                "oura_garmin_auto_sync",
                lambda: run_oura_garmin_scheduler_job(
                    "garmin",
                    lambda: _run_oura_or_garmin_auto_sync("garmin", current_hour),
                    now=tick_now,
                ),
            ),
            (
                "tesla_odometer_sync",
                lambda: run_tesla_scheduler_job(
                    lambda: _run_tesla_odometer_sync(tesla_service, current_hour),
                    now=tick_now,
                ),
            ),
            (
                "financial_sync",
                lambda: run_financial_scheduler_job(
                    lambda: _run_financial_sync(current_hour),
                    now=tick_now,
                ),
            ),
            (
                "location_ping_retention",
                lambda: run_clock_job(
                    "location_ping_retention",
                    _run_location_retention,
                    now=tick_now,
                ),
            ),
        )
        for job_key, run_job in jobs:
            try:
                execution = await run_job()
                if execution.status == "duplicate":
                    logger.info("⏭️ Scheduler occurrence already claimed: %s %s", job_key, execution.scheduled_for)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("⚠️ Scheduler job %s failed: %s", job_key, exc)
        logger.info("⏰ Scheduler tick complete — waiting for next hourly boundary")
        await _sleep_after_clock_tick(tick_now, 3600)


async def report_scheduler_loop() -> None:
    """Dispatch and process scheduled habit reports on a shorter cadence."""
    from services.scheduler_service import run_clock_job

    await asyncio.sleep(45)
    logger.info("📨 Report scheduler loop started (runs every 15 minutes)")

    while True:
        tick_now = datetime.now(timezone.utc)
        try:
            from services.reports_service import reports_service

            execution = await run_clock_job("habit_reports", reports_service.scheduler_tick, now=tick_now)
            if execution.status == "duplicate":
                await _sleep_after_clock_tick(tick_now, 900)
                continue
            result = execution.result or {}
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

        await _sleep_after_clock_tick(tick_now, 900)


async def workflow_scheduler_loop() -> None:
    """Dispatch and process scheduled workflow runs on a shorter cadence."""
    from services.scheduler_service import run_clock_job

    await asyncio.sleep(50)
    logger.info("🧭 Workflow scheduler loop started (runs every 5 minutes)")

    while True:
        tick_now = datetime.now(timezone.utc)
        try:
            from services.workflow_service import workflow_service

            execution = await run_clock_job("workflow_runs", workflow_service.scheduler_tick, now=tick_now)
            if execution.status == "duplicate":
                await _sleep_after_clock_tick(tick_now, 300)
                continue
            result = execution.result or {}
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

        await _sleep_after_clock_tick(tick_now, 300)


async def ambient_scheduler_loop() -> None:
    """Evaluate ambient workflow signals and process resulting runs."""
    from services.scheduler_service import run_clock_job

    await asyncio.sleep(65)
    logger.info("🌤️ Ambient scheduler loop started (runs every 15 minutes)")

    while True:
        tick_now = datetime.now(timezone.utc)
        try:
            from services.workflow_service import workflow_service

            execution = await run_clock_job("ambient_signals", workflow_service.ambient_tick, now=tick_now)
            if execution.status == "duplicate":
                await _sleep_after_clock_tick(tick_now, 900)
                continue
            result = execution.result or {}
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

        await _sleep_after_clock_tick(tick_now, 900)


async def sms_copilot_loop() -> None:
    """Run narrow deterministic copilot checks every five minutes."""
    from sqlalchemy import select
    from database.models import UserDB
    from services.scheduler_service import run_clock_job

    await asyncio.sleep(45)
    logger.info("📲 SMS copilot loop started (runs every 5 minutes)")

    while True:
        tick_now = datetime.now(timezone.utc)
        try:
            from services.sms_copilot_dispatch_service import sms_copilot_dispatch_service
            from services.sms_copilot_signal_service import sms_copilot_signal_service

            async def run_tick():
                candidate_count = 0
                sent_count = 0
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
                return candidate_count, sent_count, len(user_ids)

            execution = await run_clock_job("sms_copilot", run_tick, now=tick_now)
            if execution.status == "duplicate":
                await _sleep_after_clock_tick(tick_now, 300)
                continue
            candidate_count, sent_count, user_count = execution.result or (0, 0, 0)
            if candidate_count or sent_count:
                logger.info(
                    "📲 SMS copilot tick complete: candidates=%d sent=%d users=%d",
                    candidate_count,
                    sent_count,
                    user_count,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ SMS copilot loop failed: %s", exc)

        await _sleep_after_clock_tick(tick_now, 300)


async def wearable_ingest_job_loop() -> None:
    """Process queued wearable backfill/replay jobs in-process."""
    from services.scheduler_service import run_queue_job

    await asyncio.sleep(60)
    logger.info("🧵 Wearable ingest job loop started (runs every 15 seconds)")

    while True:
        try:
            from services.wearable_ingest_job_service import wearable_ingest_job_service

            execution = await run_queue_job(
                "wearable_ingest",
                wearable_ingest_job_service.process_next_job,
            )
            result = execution.result
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
    from services.scheduler_service import run_clock_job

    await asyncio.sleep(90)
    logger.info("🧹 Wearable maintenance loop started (runs every 24 hours)")

    while True:
        tick_now = datetime.now(timezone.utc)
        try:
            from services.wearables_unified import wearable_sync_service
            from services.wearable_maintenance_service import wearable_maintenance_service

            async def run_maintenance():
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
                return result

            execution = await run_clock_job("wearable_maintenance", run_maintenance, now=tick_now)
            if execution.status == "completed":
                logger.info("🧹 Wearable maintenance complete: %s", execution.result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("⚠️ Wearable maintenance loop failed: %s", exc)

        await _sleep_after_clock_tick(tick_now, 86400)


async def wearable_event_outbox_loop() -> None:
    """Process queued internal wearable outbox events in-process."""
    from services.scheduler_service import run_queue_job

    await asyncio.sleep(75)
    logger.info("📮 Wearable event outbox loop started (runs every 15 seconds)")

    while True:
        try:
            from services.wearable_event_outbox_service import wearable_event_outbox_service

            execution = await run_queue_job(
                "wearable_event_outbox",
                wearable_event_outbox_service.process_next_event,
            )
            result = execution.result
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
