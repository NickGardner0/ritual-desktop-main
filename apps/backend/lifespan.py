"""FastAPI startup and shutdown lifecycle hooks."""

from __future__ import annotations

import asyncio
import logging
import os

from fastapi import FastAPI

from background_tasks import (
    ambient_scheduler_loop,
    internal_scheduler_loop,
    report_scheduler_loop,
    wearable_event_outbox_loop,
    wearable_ingest_job_loop,
    wearable_maintenance_loop,
    workflow_scheduler_loop,
)
from database.connection import (
    close_database,
    complete_database_startup_maintenance,
    init_database,
)
from services.scheduler_service import SCHEDULER_JOB_DEFINITIONS, scheduler_runtime

logger = logging.getLogger(__name__)

STARTUP_MAINTENANCE_DELAY_SECONDS = float(
    os.getenv("STARTUP_MAINTENANCE_DELAY_SECONDS", "15")
)
ENABLE_STARTUP_MAINTENANCE_TASK = os.getenv(
    "ENABLE_STARTUP_MAINTENANCE_TASK", "0"
).lower() in {"1", "true", "yes", "on"}
ENABLE_INTERNAL_SCHEDULER = os.getenv(
    "ENABLE_INTERNAL_SCHEDULER", "0"
).lower() in {"1", "true", "yes", "on"}


async def post_startup_initialization(app: FastAPI, tesla_service) -> None:
    """Run nonessential startup work after readiness is available."""
    uvicorn_logger = logging.getLogger("uvicorn")

    try:
        migration_summary = await complete_database_startup_maintenance()
        uvicorn_logger.info(
            "🗃️ Deferred database startup maintenance complete (status=%s, warnings=%s)",
            migration_summary.get("status"),
            migration_summary.get("warning_count"),
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        uvicorn_logger.warning("⚠️ Deferred database startup maintenance failed: %s", exc)
        return


async def delayed_post_startup_initialization(app: FastAPI, tesla_service) -> None:
    """Wait briefly so platform readiness checks can succeed before heavy startup work."""
    if STARTUP_MAINTENANCE_DELAY_SECONDS > 0:
        await asyncio.sleep(STARTUP_MAINTENANCE_DELAY_SECONDS)
    await post_startup_initialization(app, tesla_service)


def start_internal_scheduler_tasks(app: FastAPI, tesla_service) -> None:
    """Start every scheduler loop independently of deferred startup maintenance."""
    uvicorn_logger = logging.getLogger("uvicorn")
    scheduler_runtime.reset()
    scheduler_runtime.configure(ENABLE_INTERNAL_SCHEDULER)
    app.state.scheduler_tasks = {}
    loop_specs = (
        ("hourly_domain", "scheduler_task", internal_scheduler_loop(tesla_service)),
        ("habit_reports", "report_scheduler_task", report_scheduler_loop()),
        ("workflow_runs", "workflow_scheduler_task", workflow_scheduler_loop()),
        ("ambient_signals", "ambient_scheduler_task", ambient_scheduler_loop()),
        ("wearable_ingest", "wearable_ingest_job_task", wearable_ingest_job_loop()),
        ("wearable_maintenance", "wearable_maintenance_task", wearable_maintenance_loop()),
        ("wearable_event_outbox", "wearable_event_outbox_task", wearable_event_outbox_loop()),
    )
    for _, attribute, coroutine in loop_specs:
        setattr(app.state, attribute, None)
    if not ENABLE_INTERNAL_SCHEDULER:
        for _, _, coroutine in loop_specs:
            coroutine.close()
        uvicorn_logger.info(
            "⏭️ Internal scheduler disabled (set ENABLE_INTERNAL_SCHEDULER=1 to enable)"
        )
        return

    for loop_key, attribute, coroutine in loop_specs:
        task = asyncio.create_task(coroutine, name=f"ritual-scheduler:{loop_key}")
        setattr(app.state, attribute, task)
        app.state.scheduler_tasks[loop_key] = task
        scheduler_runtime.register_loop(
            loop_key,
            [item.job_key for item in SCHEDULER_JOB_DEFINITIONS if item.loop_key == loop_key],
        )
    uvicorn_logger.info(
        "⏰ Internal scheduler started: %d jobs across %d loops",
        len(SCHEDULER_JOB_DEFINITIONS),
        len(loop_specs),
    )


def register_lifecycle(app: FastAPI, tesla_service) -> None:
    """Attach startup and shutdown handlers to the FastAPI app."""

    @app.on_event("startup")
    async def startup_event():
        uvicorn_logger = logging.getLogger("uvicorn")
        await init_database(fast_startup=True)
        uvicorn_logger.info("🚀 Ritual Backend API started successfully!")
        uvicorn_logger.info("🖥️ Watcher API ready for computer activity tracking")
        app.state.startup_maintenance_task = None
        app.state.scheduler_task = None
        app.state.report_scheduler_task = None
        app.state.workflow_scheduler_task = None
        app.state.ambient_scheduler_task = None
        app.state.wearable_ingest_job_task = None
        app.state.wearable_maintenance_task = None
        app.state.wearable_event_outbox_task = None
        start_internal_scheduler_tasks(app, tesla_service)
        if ENABLE_STARTUP_MAINTENANCE_TASK:
            app.state.startup_maintenance_task = asyncio.create_task(
                delayed_post_startup_initialization(app, tesla_service)
            )
        else:
            uvicorn_logger.info(
                "⏭️ Deferred startup maintenance disabled for fast platform readiness"
            )

    @app.on_event("shutdown")
    async def shutdown_event():
        startup_maintenance_task = getattr(app.state, "startup_maintenance_task", None)
        scheduler_tasks = list(getattr(app.state, "scheduler_tasks", {}).values())
        tasks = [task for task in [startup_maintenance_task, *scheduler_tasks] if task is not None]
        for task in tasks:
            task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                logger.warning("Timed out waiting for background tasks to cancel")

        await close_database()
        logger.info("👋 Ritual Backend API shutdown complete!")
