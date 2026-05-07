"""Wearable provider connection and capability services."""

from .common import *
from .capabilities import (
    PROVIDER_CAPABILITIES,
    build_wearable_sync_plan,
    default_sync_mode_for_provider_metric,
)

class WearableConnectionService:
    def __init__(self):
        self.logger = logger

    async def get_or_create_connection(
        self,
        *,
        user_id: str,
        provider: str,
        auth_method: str,
        provider_user_id: Optional[str] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[datetime] = None,
        scopes: Optional[List[str]] = None,
        settings: Optional[Dict[str, Any]] = None,
        status: str = "active",
        reset_sync_state: bool = False,
    ) -> WearableConnectionDB:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == provider,
                )
            )
            connection = result.scalar_one_or_none()
            now = datetime.now(timezone.utc)
            if connection is None:
                connection = WearableConnectionDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    provider=provider,
                    auth_method=auth_method,
                    created_at=now,
                )
                session.add(connection)

            connection.auth_method = auth_method
            connection.provider_user_id = provider_user_id
            connection.status = status
            connection.access_token = token_crypto.encrypt(access_token) if access_token else connection.access_token
            connection.refresh_token = token_crypto.encrypt(refresh_token) if refresh_token else connection.refresh_token
            connection.token_expires_at = token_expires_at
            if scopes is not None:
                connection.scopes_json = json.dumps(scopes)
            if settings is not None:
                merged_settings: Dict[str, Any] = {}
                if connection.settings_json:
                    try:
                        merged_settings.update(json.loads(connection.settings_json))
                    except Exception:
                        merged_settings = {}
                merged_settings.update(settings)
                connection.settings_json = json.dumps(merged_settings)
            if reset_sync_state:
                connection.last_sync_at = None
                connection.last_successful_sync_at = None
                connection.last_error_json = None
            connection.updated_at = now

            await session.commit()
            await session.refresh(connection)
            return connection

    async def get_connection(self, user_id: str, provider: str) -> Optional[WearableConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == provider,
                )
            )
            return result.scalar_one_or_none()

    async def list_connections(self, user_id: str) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(WearableConnectionDB.user_id == user_id)
            )
            connections = result.scalars().all()

            counts_result = await session.execute(
                select(WearableSourceDB.connection_id, func.count(WearableSourceDB.id))
                .where(WearableSourceDB.user_id == user_id)
                .group_by(WearableSourceDB.connection_id)
            )
            source_counts = {row[0]: row[1] for row in counts_result.fetchall()}

            tracked_result = await session.execute(
                select(HabitDB.integration_source, HabitDB.metric_type)
                .where(HabitDB.user_id == user_id)
                .where(HabitDB.integration_source.isnot(None))
                .where(HabitDB.metric_type.isnot(None))
            )
            tracked_by_provider: Dict[str, List[str]] = {}
            for provider, metric_type in tracked_result.fetchall():
                tracked_by_provider.setdefault(provider, []).append(metric_type)

            event_latest_result = await session.execute(
                select(WearableEventDB.provider, func.max(WearableEventDB.attributed_date))
                .where(WearableEventDB.user_id == user_id)
                .where(WearableEventDB.deleted_at.is_(None))
                .where(WearableEventDB.attributed_date.is_not(None))
                .group_by(WearableEventDB.provider)
            )
            latest_event_dates = {row[0]: row[1] for row in event_latest_result.fetchall()}

            sample_latest_result = await session.execute(
                select(WearableSampleDB.provider, func.max(WearableSampleDB.attributed_date))
                .where(WearableSampleDB.user_id == user_id)
                .where(WearableSampleDB.deleted_at.is_(None))
                .where(WearableSampleDB.attributed_date.is_not(None))
                .group_by(WearableSampleDB.provider)
            )
            latest_sample_dates = {row[0]: row[1] for row in sample_latest_result.fetchall()}

            sleep_latest_result = await session.execute(
                select(WearableEventDB.provider, func.max(WearableEventDB.attributed_date))
                .where(WearableEventDB.user_id == user_id)
                .where(WearableEventDB.deleted_at.is_(None))
                .where(WearableEventDB.event_type == "sleep_total")
                .where(WearableEventDB.attributed_date.is_not(None))
                .group_by(WearableEventDB.provider)
            )
            latest_sleep_dates = {row[0]: row[1] for row in sleep_latest_result.fetchall()}
            provider_capabilities = {
                item["provider"]: item for item in await self.list_provider_capabilities()
            }

            items = []
            for connection in connections:
                settings: Dict[str, Any] = {}
                if connection.settings_json:
                    try:
                        settings = json.loads(connection.settings_json)
                    except Exception:
                        settings = {}

                latest_data_date = max(
                    [value for value in [latest_event_dates.get(connection.provider), latest_sample_dates.get(connection.provider)] if value],
                    default=None,
                )
                latest_sleep_date = latest_sleep_dates.get(connection.provider)
                latest_upstream_sleep_date = settings.get("latest_upstream_sleep_date")
                sync_hour = settings.get("sync_hour")
                if sync_hour is None and connection.provider == "whoop":
                    sync_hour = settings.get("whoop_sync_hour", 9)
                auto_sync_enabled = bool(settings.get("auto_sync_enabled", connection.provider != "apple_health"))
                auto_sync_mode = "device" if connection.provider == "apple_health" else "trigger"
                auto_sync_note = None
                if connection.provider == "apple_health":
                    auto_sync_note = (
                        "Apple Health uploads are driven by the iPhone companion app. "
                        "This saved schedule is reserved for device-managed sync windows."
                    )
                elif connection.provider == "garmin":
                    auto_sync_note = "Garmin data is primarily webhook-driven; scheduled sync refreshes the connected account."

                is_upstream_stale = False
                stale_message = None
                if connection.provider == "whoop" and latest_upstream_sleep_date:
                    stale_threshold = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
                    if latest_upstream_sleep_date < stale_threshold:
                        is_upstream_stale = True
                        stale_message = f"Whoop has not returned sleep after {latest_upstream_sleep_date} yet."

                explicit_preferences = settings.get("metric_preferences_v2", {})
                explicit_metrics = {
                    metric_type: preference
                    for metric_type, preference in explicit_preferences.items()
                    if isinstance(metric_type, str) and isinstance(preference, dict)
                }
                tracked_metrics = sorted(
                    set(tracked_by_provider.get(connection.provider, []))
                    | {
                        metric_type
                        for metric_type, preference in explicit_metrics.items()
                        if str(preference.get("sync_mode", "")).strip().lower() in {"daily_only", "granular"}
                    }
                )
                sync_plans = []
                for metric_type in tracked_metrics:
                    sync_mode = default_sync_mode_for_provider_metric(connection.provider, metric_type)
                    if metric_type in explicit_metrics:
                        sync_mode = (
                            str(
                                explicit_metrics[metric_type].get(
                                    "sync_mode",
                                    default_sync_mode_for_provider_metric(connection.provider, metric_type),
                                )
                            )
                            .strip()
                            .lower()
                            or default_sync_mode_for_provider_metric(connection.provider, metric_type)
                        )
                    sync_plans.append(
                        build_wearable_sync_plan(
                            provider=connection.provider,
                            metric_type=metric_type,
                            sync_mode=sync_mode,
                            projects_to_habit_logs=metric_type in set(tracked_by_provider.get(connection.provider, [])),
                        )
                    )
                capability = provider_capabilities.get(connection.provider)

                items.append(
                    {
                        "id": connection.id,
                        "provider": connection.provider,
                        "auth_method": connection.auth_method,
                        "status": connection.status,
                        "provider_user_id": connection.provider_user_id,
                        "last_sync_at": connection.last_sync_at.isoformat() if connection.last_sync_at else None,
                        "last_successful_sync_at": connection.last_successful_sync_at.isoformat()
                        if connection.last_successful_sync_at
                        else None,
                        "last_error_json": json.loads(connection.last_error_json)
                        if connection.last_error_json
                        else None,
                        "tracked_metrics": tracked_metrics,
                        "source_count": source_counts.get(connection.id, 0),
                        "auto_sync_enabled": auto_sync_enabled,
                        "sync_hour": sync_hour,
                        "auto_sync_mode": auto_sync_mode,
                        "auto_sync_note": auto_sync_note,
                        "latest_data_date": latest_data_date,
                        "latest_sleep_date": latest_sleep_date,
                        "latest_upstream_sleep_date": latest_upstream_sleep_date,
                        "is_upstream_stale": is_upstream_stale,
                        "stale_message": stale_message,
                        "capability": capability,
                        "sync_plans": sync_plans,
                    }
                )

            return items

    async def disconnect(self, user_id: str, provider: str) -> Optional[WearableConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == provider,
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

    async def list_provider_capabilities(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for definition in PROVIDER_CAPABILITIES.values():
            items.append(
                {
                    "provider": definition.provider,
                    "display_name": definition.display_name,
                    "auth_method": definition.auth_method,
                    "supports_sync": True,
                    "delivery_modes": list(definition.delivery_modes),
                    "supports_webhook": definition.supports_webhook,
                    "supports_import_fallback": definition.supports_import_fallback,
                    "supports_metric_selection": definition.supports_metric_selection,
                    "supports_backfill": definition.supports_backfill,
                    "supports_async_backfill": definition.supports_async_backfill,
                    "supports_live_sync_mode_selection": definition.supports_live_sync_mode_selection,
                    "max_historical_days": definition.max_historical_days,
                    "default_live_sync_mode": definition.default_live_sync_mode,
                    "supports_anchor_confirmed_ingest": definition.supports_anchor_confirmed_ingest,
                }
            )
        return items

