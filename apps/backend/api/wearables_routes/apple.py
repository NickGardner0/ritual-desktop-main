"""Wearables apple routes."""

import base64
import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from sqlalchemy import select

from database.connection import get_db_session
from database.models import (
    HabitDB,
    HabitProjectionPolicyDB,
    WearableConnectionDB,
    WearableDeviceDB,
    WhoopIntegrationDB,
)
from schemas.wearables_apple import (
    AppleIngestRequest,
    AppleIngestRequestV2,
    AppleIngestResponse,
    AppleIngestResponseV2,
    AppleSyncTelemetryRequest,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceStatusResponse,
    SyncStatusResponse,
)
from schemas.wearables_unified import (
    WearableConnectionActionResponse,
    WearableConnectionsResponse,
    WearableDailyTotalsResponse,
    WearableIngestJobsResponse,
    WearableOutboxEventsResponse,
    WearableRawPayloadsResponse,
    WearableSeriesResponse,
    WearableSyncResponse,
    WearableTimelineResponse,
)
from services.wearable_provider_adapters import get_provider_adapter, list_provider_defs
from services.wearable_provider_sync_registry import sync_wearable_provider_account

from api.wearables_routes.deps import WearablesRouterDeps
from api.wearables_routes.models import ScheduledWearableSyncRequest, WearableSyncSettingsUpdateRequest
from api.wearables_helpers import (
    ALL_METRIC_TYPES as _ALL_METRIC_TYPES,
    METRIC_CATALOG as _METRIC_CATALOG,
    apple_owned_habit_metric_types as _apple_owned_habit_metric_types,
    build_tracked_metrics_contract as _build_tracked_metrics_contract,
    coerce_settings_payload as _coerce_settings_payload,
    connection_matches_sync_schedule as _connection_matches_sync_schedule,
    metric_category as _metric_category,
    metric_display_name as _metric_display_name,
    normalize_metric_preferences_v2 as _normalize_metric_preferences_v2,
    parse_csv_list as _parse_csv_list,
    parse_iso_datetime as _parse_iso_datetime,
    parse_metric_preferences_payload as _parse_metric_preferences_payload,
    require_internal_key as _require_internal_key,
    selected_metrics_from_preferences as _selected_metrics_from_preferences,
    serialize_connection as _serialize_connection,
    serialize_event as _serialize_event,
    serialize_ingest_job as _serialize_ingest_job,
    serialize_outbox_event as _serialize_outbox_event,
    serialize_raw_payload as _serialize_raw_payload,
    serialize_sample as _serialize_sample,
    serialize_sync_run as _serialize_sync_run,
)

logger = logging.getLogger(__name__)


def _apple_rejection_status(error_code: Optional[str]) -> int:
    return {
        "device_not_found": 404,
        "device_user_mismatch": 403,
        "invalid_signature": 401,
    }.get(error_code or "", 400)


def register_apple_routes(router: APIRouter, deps: WearablesRouterDeps) -> None:

    limiter = deps.limiter
    get_current_user = deps.get_current_user
    wearable_apple_ingest_service = deps.wearable_apple_ingest_service
    wearable_device_security_service = deps.wearable_device_security_service
    whoop_service = deps.whoop_service
    oura_service = deps.oura_service
    garmin_service = deps.garmin_service
    wearable_connection_service = deps.wearable_connection_service
    wearable_projection_service = deps.wearable_projection_service
    wearable_query_service = deps.wearable_query_service
    wearable_sync_service = deps.wearable_sync_service
    wearable_event_outbox_service = deps.wearable_event_outbox_service
    wearable_ingest_job_service = deps.wearable_ingest_job_service
    wearable_maintenance_service = deps.wearable_maintenance_service
    provider_sync_services = deps.provider_sync_services
    _mark_activation_completed = deps.mark_activation_completed

    # ── Health data export (Markdown / JSON / CSV) ─────────────────────
    @router.get("/api/wearables/apple/export")
    async def export_apple_health(
        start_date: str,  # YYYY-MM-DD
        end_date: str,    # YYYY-MM-DD
        format: str = "markdown",  # markdown | json | csv
        metric_types: Optional[str] = None,  # comma-separated, or all if omitted
        current_user=Depends(get_current_user),
    ):
        """Export Apple Health data in Markdown, JSON, or CSV format."""
        from datetime import timedelta
        from fastapi.responses import PlainTextResponse, JSONResponse

        # Parse dates
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)  # inclusive end
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")

        if (end_dt - start_dt).days > 366:
            raise HTTPException(status_code=400, detail="Date range cannot exceed 1 year")

        type_filter = [t.strip() for t in metric_types.split(",")] if metric_types else None

        # Fetch all samples in range
        samples = await wearable_query_service.get_samples(
            user_id=current_user["id"],
            provider="apple_health",
            start_time=start_dt,
            end_time=end_dt,
            include_deleted=False,
            limit=50000,
        )

        # Optional metric type filter
        if type_filter:
            samples = [s for s in samples if s.metric_type in type_filter]

        # Group by attributed_date (YYYY-MM-DD)
        from collections import defaultdict
        by_date: dict[str, list] = defaultdict(list)
        for s in samples:
            day = s.attributed_date or (s.start_time.strftime("%Y-%m-%d") if s.start_time else start_date)
            by_date[day].append(s)

        if format == "json":
            export_data = {}
            for day in sorted(by_date.keys()):
                export_data[day] = [_serialize_sample(s) for s in by_date[day]]
            return JSONResponse(content={"dates": export_data, "total_samples": len(samples)})

        elif format == "csv":
            import csv, io
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["Date", "Category", "Metric", "Value", "Unit", "Start", "End"])
            for day in sorted(by_date.keys()):
                for s in by_date[day]:
                    writer.writerow([
                        day,
                        _metric_category(s.metric_type),
                        s.metric_type,
                        s.value,
                        s.unit,
                        s.start_time.isoformat() if s.start_time else "",
                        s.end_time.isoformat() if s.end_time else "",
                    ])
            return PlainTextResponse(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=ritual-health-{start_date}-to-{end_date}.csv"},
            )

        else:  # markdown (default)
            lines: list[str] = []
            for day in sorted(by_date.keys()):
                day_samples = by_date[day]
                lines.append(f"# Health {day}")
                lines.append("")

                # Group by category
                categorized: dict[str, list] = defaultdict(list)
                for s in day_samples:
                    categorized[_metric_category(s.metric_type)].append(s)

                for category in ["Activity", "Heart", "Sleep", "Respiratory",
                                 "Body Measurements", "Nutrition", "Vitals",
                                 "Mobility", "Workouts", "Mindfulness", "Other"]:
                    items = categorized.get(category, [])
                    if not items:
                        continue
                    lines.append(f"## {category}")
                    lines.append("")
                    for s in items:
                        display = _metric_display_name(s.metric_type)
                        val = int(s.value) if s.value == int(s.value) else f"{s.value:.2f}"
                        lines.append(f"- **{display}**: {val} {s.unit}")
                    lines.append("")

                lines.append("---")
                lines.append("")

            content = "\n".join(lines).rstrip()
            return PlainTextResponse(
                content=content,
                media_type="text/markdown",
                headers={"Content-Disposition": f"attachment; filename=ritual-health-{start_date}-to-{end_date}.md"},
            )

    @router.post("/api/wearables/apple/register_device", response_model=DeviceRegisterResponse)
    async def register_apple_device(
        request: DeviceRegisterRequest,
        current_user = Depends(get_current_user)
    ):
        """
        Register a new iOS device for Apple Health sync.
        
        Returns a device_id and device_secret that should be:
        - device_id: Stored for future API calls
        - device_secret: Stored securely in iOS Keychain for request signing
        
        The device_secret is used to sign all ingest requests to prevent tampering.
        """
        try:
            logger.info(f"📱 Registering device '{request.device_name}' for user {current_user['id']}")
            
            device_id, device_secret = await wearable_device_security_service.register_device(
                user_id=current_user["id"],
                device_name=request.device_name,
                platform=request.platform
            )
            await _mark_activation_completed(
                current_user["id"],
                "apple_health",
                {
                    "source": "apple_device_registration",
                    "platform": request.platform,
                },
            )
            
            return DeviceRegisterResponse(
                device_id=device_id,
                device_secret=device_secret,
                registered_at=datetime.utcnow().isoformat() + "Z"
            )
            
        except Exception as e:
            logger.error(f"❌ Device registration error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/wearables/apple/devices")
    async def list_apple_devices(current_user = Depends(get_current_user)):
        """
        List all registered devices for the current user.
        """
        try:
            devices = await wearable_device_security_service.list_devices(current_user["id"], provider="apple_health")
            
            return {
                "devices": [
                    DeviceStatusResponse(
                        device_id=d.id,
                        device_name=d.device_name,
                        platform=d.platform,
                        registered_at=d.registered_at.isoformat() + "Z",
                        last_sync_at=d.last_sync_at.isoformat() + "Z" if d.last_sync_at else None,
                        is_active=d.is_active
                    )
                    for d in devices
                ]
            }
            
        except Exception as e:
            logger.error(f"❌ List devices error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.delete("/api/wearables/apple/devices/{device_id}")
    async def deactivate_apple_device(
        device_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        Deactivate a device (soft delete).
        The device will no longer be able to sync data.
        """
        try:
            success = await wearable_device_security_service.deactivate_device(device_id, current_user["id"])
            
            if not success:
                raise HTTPException(status_code=404, detail="Device not found")
            
            return {"success": True, "message": "Device deactivated"}
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Deactivate device error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/wearables/apple/metric_catalog")
    async def get_metric_catalog(current_user=Depends(get_current_user)):
        """Return the full catalog of available Apple Health metric types."""
        return {"categories": _METRIC_CATALOG}

    @router.get("/api/wearables/apple/metric_preferences")
    async def get_metric_preferences(current_user=Depends(get_current_user)):
        """Get the user's explicitly selected metric types for syncing."""
        from database.connection import get_db_session
        from database.models import HabitDB, HabitProjectionPolicyDB, WearableConnectionDB
        from sqlalchemy import select

        async with get_db_session() as session:
            conn_stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(conn_stmt)
            conn = result.scalar_one_or_none()

            settings = _coerce_settings_payload(conn.settings_json if conn else None)
            preferences = _normalize_metric_preferences_v2(settings, _ALL_METRIC_TYPES)
            habit_stmt = (
                select(HabitDB, HabitProjectionPolicyDB)
                .join(HabitProjectionPolicyDB, HabitProjectionPolicyDB.habit_id == HabitDB.id, isouter=True)
                .where(
                    HabitDB.user_id == current_user["id"],
                    HabitDB.metric_type.isnot(None),
                )
            )
            habit_result = await session.execute(habit_stmt)
            habit_types = _apple_owned_habit_metric_types(habit_result.all(), _ALL_METRIC_TYPES)
            effective_contract = _build_tracked_metrics_contract(preferences, habit_types)
            effective_preferences = {
                metric_type: {"sync_mode": payload["sync_mode"]}
                for metric_type, payload in effective_contract.items()
            }
            return {
                "preferences": preferences,
                "effective_preferences": effective_preferences,
                "selected_metrics": _selected_metrics_from_preferences(preferences),
                "effective_selected_metrics": _selected_metrics_from_preferences(effective_preferences),
            }

    @router.put("/api/wearables/apple/metric_preferences")
    async def put_metric_preferences(
        body: dict,
        current_user=Depends(get_current_user),
    ):
        """Update Apple Health metric sync preferences."""
        from database.connection import get_db_session
        from database.models import HabitDB, HabitProjectionPolicyDB, WearableConnectionDB
        from sqlalchemy import select

        try:
            preferences = _parse_metric_preferences_payload(body, _ALL_METRIC_TYPES)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        selected_metrics = _selected_metrics_from_preferences(preferences)

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn:
                raise HTTPException(status_code=404, detail="No Apple Health connection found")

            settings = _coerce_settings_payload(conn.settings_json)
            settings["metric_preferences_v2"] = preferences
            settings["metric_preferences"] = selected_metrics
            conn.settings_json = json.dumps(settings)

            habit_stmt = (
                select(HabitDB, HabitProjectionPolicyDB)
                .join(HabitProjectionPolicyDB, HabitProjectionPolicyDB.habit_id == HabitDB.id, isouter=True)
                .where(
                    HabitDB.user_id == current_user["id"],
                    HabitDB.metric_type.isnot(None),
                )
            )
            habit_result = await session.execute(habit_stmt)
            habit_types = _apple_owned_habit_metric_types(habit_result.all(), _ALL_METRIC_TYPES)
            await session.commit()

        effective_contract = _build_tracked_metrics_contract(preferences, habit_types)
        effective_preferences = {
            metric_type: {"sync_mode": payload["sync_mode"]}
            for metric_type, payload in effective_contract.items()
        }

        return {
            "preferences": preferences,
            "effective_preferences": effective_preferences,
            "selected_metrics": selected_metrics,
            "effective_selected_metrics": _selected_metrics_from_preferences(effective_preferences),
            "created_habits": [],
        }

    # ── Export Schedule ──────────────────────────────────────────────────
    @router.get("/api/wearables/apple/export_schedule")
    async def get_export_schedule(current_user=Depends(get_current_user)):
        """Get the user's scheduled export configuration."""
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn or not conn.settings_json:
                return {"schedule": None}

            settings = json.loads(conn.settings_json) if isinstance(conn.settings_json, str) else conn.settings_json
            return {"schedule": settings.get("export_schedule", None)}

    @router.put("/api/wearables/apple/export_schedule")
    async def put_export_schedule(
        body: dict,
        current_user=Depends(get_current_user),
    ):
        """
        Update export schedule. Body:
        {
          "schedule": {
            "enabled": bool,
            "frequency": "daily" | "weekly",
            "format": "markdown" | "json" | "csv",
            "time": "HH:MM",           // 24h local time
            "day_of_week": 0-6 | null,  // 0=Mon, only for weekly
            "folder_path": str | null,  // last used save path (desktop only)
            "include_all_metrics": bool,
            "metric_types": string[] | null
          }
        }
        """
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        schedule = body.get("schedule")
        if schedule is not None:
            if not isinstance(schedule, dict):
                raise HTTPException(status_code=400, detail="schedule must be an object")
            # Validate required fields
            if "enabled" not in schedule:
                schedule["enabled"] = False
            if schedule.get("frequency") not in (None, "daily", "weekly"):
                raise HTTPException(status_code=400, detail="frequency must be 'daily' or 'weekly'")
            if schedule.get("format") not in (None, "markdown", "json", "csv"):
                raise HTTPException(status_code=400, detail="format must be 'markdown', 'json', or 'csv'")

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn:
                raise HTTPException(status_code=404, detail="No Apple Health connection found")

            settings = {}
            if conn.settings_json:
                try:
                    settings = json.loads(conn.settings_json)
                except Exception:
                    settings = {}

            settings["export_schedule"] = schedule
            conn.settings_json = json.dumps(settings)
            await session.commit()

        return {"schedule": schedule}

    # ── Export History ────────────────────────────────────────────────────
    @router.get("/api/wearables/apple/export_history")
    async def get_export_history(
        limit: int = 50,
        current_user=Depends(get_current_user),
    ):
        """Get recent export history entries."""
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn or not conn.settings_json:
                return {"history": []}

            settings = json.loads(conn.settings_json) if isinstance(conn.settings_json, str) else conn.settings_json
            history = settings.get("export_history", [])
            # Return most recent first, capped
            return {"history": history[-limit:][::-1]}

    @router.post("/api/wearables/apple/export_history")
    async def add_export_history(
        body: dict,
        current_user=Depends(get_current_user),
    ):
        """
        Record an export history entry. Body:
        {
          "entry": {
            "id": str,             // UUID
            "timestamp": str,      // ISO datetime
            "start_date": str,     // YYYY-MM-DD
            "end_date": str,       // YYYY-MM-DD
            "format": str,
            "status": "success" | "failed",
            "sample_count": int,
            "file_size_bytes": int | null,
            "file_path": str | null,
            "error": str | null,
            "triggered_by": "manual" | "scheduled"
          }
        }
        """
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        entry = body.get("entry")
        if not entry or not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="entry must be an object")

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn:
                raise HTTPException(status_code=404, detail="No Apple Health connection found")

            settings = {}
            if conn.settings_json:
                try:
                    settings = json.loads(conn.settings_json)
                except Exception:
                    settings = {}

            history = settings.get("export_history", [])
            history.append(entry)
            # Cap at 100 entries
            if len(history) > 100:
                history = history[-100:]
            settings["export_history"] = history
            conn.settings_json = json.dumps(settings)
            await session.commit()

        return {"entry": entry}

    @router.get("/api/wearables/apple/tracked_metrics")
    async def get_apple_tracked_metrics(current_user=Depends(get_current_user)):
        """
        Get the list of metric types to sync = union of habit-derived + explicit preferences.
        The iOS companion app uses this to know which HealthKit metrics to sync.
        """
        try:
            from database.connection import get_db_session
            from database.models import HabitDB, HabitProjectionPolicyDB, WearableConnectionDB
            from sqlalchemy import select

            async with get_db_session() as session:
                # 1) Habit-derived metric types
                stmt = (
                    select(HabitDB, HabitProjectionPolicyDB)
                    .join(HabitProjectionPolicyDB, HabitProjectionPolicyDB.habit_id == HabitDB.id, isouter=True)
                    .where(
                        HabitDB.user_id == current_user["id"],
                        HabitDB.metric_type.isnot(None)
                    )
                )
                result = await session.execute(stmt)
                habit_policy_rows = result.all()
                habits = [habit for habit, _policy in habit_policy_rows]

                habit_types = _apple_owned_habit_metric_types(habit_policy_rows, _ALL_METRIC_TYPES)
                habits_list = [
                    {
                        "id": h.id,
                        "name": h.name,
                        "metric_type": h.metric_type,
                        "unit_type": h.unit_type
                    }
                    for h in habits
                    if h.metric_type in habit_types
                ]

                # 2) Explicit metric preferences from connection settings
                conn_stmt = select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == current_user["id"],
                    WearableConnectionDB.provider == "apple_health",
                )
                conn_result = await session.execute(conn_stmt)
                conn = conn_result.scalar_one_or_none()

                settings = _coerce_settings_payload(conn.settings_json if conn else None)
                preferences = _normalize_metric_preferences_v2(settings, _ALL_METRIC_TYPES)
                pref_types = set(_selected_metrics_from_preferences(preferences))

                metrics = _build_tracked_metrics_contract(preferences, habit_types)
                all_types = sorted(metrics.keys())
                capability = next(
                    (item for item in list_provider_defs() if item["provider"] == "apple_health"),
                    None,
                )

                return {
                    "metric_types": all_types,
                    "metrics": metrics,
                    "habits": habits_list,
                    "preferences": preferences,
                    "provider_capability": capability,
                }

        except Exception as e:
            logger.error(f"❌ Get tracked metrics error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/habits/{habit_id}/projection-policy")
    async def get_habit_projection_policy(
        habit_id: str,
        current_user=Depends(get_current_user),
    ):
        policy = await wearable_projection_service.get_projection_policy(
            user_id=current_user["id"],
            habit_id=habit_id,
        )
        if policy is None:
            raise HTTPException(status_code=404, detail="Habit not found")
        return policy

    @router.put("/api/habits/{habit_id}/projection-policy")
    async def put_habit_projection_policy(
        habit_id: str,
        body: dict,
        current_user=Depends(get_current_user),
    ):
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="request body must be an object")

        projection_source_priority = body.get("projection_source_priority", [])
        if not isinstance(projection_source_priority, list):
            raise HTTPException(status_code=400, detail="projection_source_priority must be an array")

        policy = await wearable_projection_service.update_projection_policy(
            user_id=current_user["id"],
            habit_id=habit_id,
            projection_source_priority=projection_source_priority,
            canonical_metric_type=body.get("canonical_metric_type"),
        )
        if policy is None:
            raise HTTPException(status_code=404, detail="Habit not found")
        return policy
    
    
    @router.post("/api/wearables/apple/ingest", response_model=AppleIngestResponse)
    @limiter.limit("30/minute")  # Rate limit ingest requests
    async def ingest_apple_health_metrics(
        request: Request,
        ingest_request: AppleIngestRequest,
        current_user = Depends(get_current_user)
    ):
        """
        Ingest normalized metrics from Apple Health.
        
        This endpoint:
        1. Validates the request signature (HMAC-SHA256)
        2. Checks for duplicate client_event_id (idempotency)
        3. Stores each metric individually
        4. Returns per-item results (partial success allowed)
        
        Request signing:
        - Signature = base64(HMAC-SHA256(device_secret, canonical_string))
        - Canonical string = device_id + "\\n" + client_event_id + "\\n" + captured_at + "\\n" + sha256(metrics_json)
        
        Example request:
        ```json
        {
            "device_id": "abc-123",
            "client_event_id": "uuid-here",
            "captured_at": "2024-01-15T10:30:00Z",
            "metrics": [
                {
                    "source": "apple_health",
                    "metric_type": "steps",
                    "start_time": "2024-01-15T00:00:00Z",
                    "end_time": "2024-01-15T23:59:59Z",
                    "value": 8500,
                    "unit": "count"
                }
            ],
            "schema_version": 1,
            "signature": "base64-hmac-signature"
        }
        ```
        """
        try:
            logger.info(f"📊 Ingesting {len(ingest_request.metrics)} metrics from device {ingest_request.device_id}")
            
            ingest_result = await wearable_apple_ingest_service.process_ingest_request(
                user_id=current_user["id"],
                request=ingest_request
            )

            response = AppleIngestResponse(
                success=ingest_result.success,
                outcome=ingest_result.outcome,
                error_code=ingest_result.error_code,
                results=ingest_result.results,
                server_time=datetime.utcnow().isoformat() + "Z",
                next_poll_seconds=60 if ingest_result.success else 300,
            )
            if ingest_result.outcome == "rejected":
                return JSONResponse(
                    status_code=_apple_rejection_status(ingest_result.error_code),
                    content=response.model_dump(),
                )

            if ingest_result.outcome == "accepted":
                await _mark_activation_completed(
                    current_user["id"],
                    "apple_health",
                    {"source": "apple_ingest_v1"},
                )

            return response
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Ingest error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # Import V2 schemas
    from schemas.wearables_apple import (
        AppleIngestRequestV2,
        AppleIngestResponseV2,
        AppleSyncTelemetryRequest,
        DeleteResult,
        SyncStatusResponse,
    )
    
    
    @router.post("/api/wearables/apple/ingest/v2", response_model=AppleIngestResponseV2)
    @limiter.limit("60/minute")  # Higher rate limit for incremental sync
    async def ingest_apple_health_metrics_v2(
        request: Request,
        ingest_request: AppleIngestRequestV2,
        current_user = Depends(get_current_user)
    ):
        """
        V2 Ingest endpoint with incremental sync support.
        
        Supports:
        - added: New metrics since last sync
        - deleted: HealthKit UUIDs of deleted samples
        - modified: Updated metrics (same external_id, new values)
        
        Returns confirmation of operations and anchor state.
        """
        try:
            total_ops = len(ingest_request.added) + len(ingest_request.deleted) + len(ingest_request.modified)
            logger.info(f"📊 V2 Ingest: {len(ingest_request.added)} added, {len(ingest_request.deleted)} deleted, {len(ingest_request.modified)} modified")
            
            ingest_result = await wearable_apple_ingest_service.process_ingest_request_v2(
                user_id=current_user["id"],
                request=ingest_request
            )

            response = AppleIngestResponseV2(
                success=ingest_result.success,
                outcome=ingest_result.outcome,
                error_code=ingest_result.error_code,
                added_results=ingest_result.added_results,
                deleted_results=ingest_result.deleted_results,
                modified_results=ingest_result.modified_results,
                server_time=datetime.utcnow().isoformat() + "Z",
                next_poll_seconds=60 if ingest_result.success else 300,
                confirmed_anchors=(
                    ingest_request.anchors
                    if ingest_result.outcome in {"accepted", "duplicate"}
                    else None
                ),
            )
            if ingest_result.outcome == "rejected":
                return JSONResponse(
                    status_code=_apple_rejection_status(ingest_result.error_code),
                    content=response.model_dump(),
                )

            if ingest_result.outcome == "accepted":
                await _mark_activation_completed(
                    current_user["id"],
                    "apple_health",
                    {"source": "apple_ingest_v2"},
                )

            return response
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ V2 Ingest error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/api/wearables/apple/telemetry")
    @limiter.limit("120/minute")
    async def submit_apple_sync_telemetry(
        request: Request,
        telemetry_request: AppleSyncTelemetryRequest,
        current_user=Depends(get_current_user),
    ):
        """
        Accept mobile-side Apple Health sync diagnostics.

        These events are intentionally stored in application logs and mirrored to
        the device's last_seen_at timestamp instead of requiring a migration. The
        payload lets us distinguish "iOS never tried", "HealthKit query returned
        zero", "upload queued", and "backend rejected upload" in production logs.
        """
        try:
            from database.connection import get_db_session
            from database.models import WearableDeviceDB
            from sqlalchemy import select

            if telemetry_request.device_id:
                async with get_db_session() as session:
                    result = await session.execute(
                        select(WearableDeviceDB).where(
                            WearableDeviceDB.id == telemetry_request.device_id,
                            WearableDeviceDB.user_id == current_user["id"],
                        )
                    )
                    device = result.scalar_one_or_none()
                    if device:
                        device.last_seen_at = datetime.utcnow()
                        if telemetry_request.sdk_version:
                            device.sdk_version = telemetry_request.sdk_version
                        await session.commit()

            for event in telemetry_request.events:
                logger.info(
                    "📱 Apple Health telemetry: user=%s device=%s event=%s metric=%s success=%s records=%s duration_ms=%s queue_pending=%s error=%s",
                    current_user["id"],
                    telemetry_request.device_id,
                    event.event_type,
                    event.metric_type,
                    event.success,
                    event.record_count,
                    event.duration_ms,
                    event.queue_pending_count,
                    event.error_message,
                )

            return {
                "accepted": len(telemetry_request.events),
                "server_time": datetime.utcnow().isoformat() + "Z",
            }
        except Exception as e:
            logger.error(f"❌ Apple telemetry error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/wearables/apple/devices/{device_id}/status", response_model=SyncStatusResponse)
    async def get_device_sync_status(
        device_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        Get sync status for a specific device.
        Used by desktop app to display sync health.
        """
        try:
            status = await wearable_device_security_service.get_device_sync_status(
                device_id=device_id,
                user_id=current_user["id"]
            )
            
            if not status:
                raise HTTPException(status_code=404, detail="Device not found")
            
            return SyncStatusResponse(**status)
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Get sync status error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/wearables/apple/sync-status")
    async def get_all_devices_sync_status(current_user = Depends(get_current_user)):
        """
        Get sync status for all user's Apple Health devices.
        Used by desktop app settings to show connection health.
        """
        try:
            devices = await wearable_device_security_service.list_devices(current_user["id"], provider="apple_health")
            
            statuses = []
            for device in devices:
                status = await wearable_device_security_service.get_device_sync_status(
                    device_id=device.id,
                    user_id=current_user["id"]
                )
                if status:
                    statuses.append(status)
            
            return {
                "devices": statuses,
                "count": len(statuses)
            }
            
        except Exception as e:
            logger.error(f"❌ Get all sync status error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
