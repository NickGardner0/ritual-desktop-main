"""WHOOP wearable ingest operations."""

from .common import *
from .capabilities import RAW_PAYLOAD_TTL_DAYS, _default_source_priority_rank
from .outbox import build_wearable_outbox_event_for_event, build_wearable_outbox_event_for_sample

class WearableWhoopSyncMixin:
    async def ingest_whoop_data(
        self,
        *,
        user_id: str,
        provider_user_id: str,
        recovery_data: Optional[Dict[str, Any]],
        sleep_data: Optional[Dict[str, Any]],
        workout_data: Optional[Dict[str, Any]],
        cycle_data: Optional[Dict[str, Any]],
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[datetime] = None,
    ) -> Dict[str, int]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="whoop",
            auth_method="oauth",
            provider_user_id=provider_user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            status="active",
        )
        account_source = await self.upsert_source(
            user_id=user_id,
            provider="whoop",
            connection_id=connection.id,
            source_kind="account",
            external_source_id=provider_user_id,
            external_source_name="Whoop Account",
        )
        await self.store_raw_payload(
            user_id=user_id,
            provider="whoop",
            direction="oauth_pull",
            payload={
                "provider_user_id": provider_user_id,
                "recovery_data": recovery_data,
                "sleep_data": sleep_data,
                "workout_data": workout_data,
                "cycle_data": cycle_data,
            },
            connection_id=connection.id,
            external_id=provider_user_id,
        )
        counts = {"samples": 0, "events": 0}

        if recovery_data and recovery_data.get("records"):
            for record in recovery_data["records"]:
                score = record.get("score") or {}
                created_count = await self._ingest_whoop_recovery_record(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=account_source.id,
                    record=record,
                    score=score,
                )
                counts["samples"] += created_count

        if sleep_data and sleep_data.get("records"):
            for record in sleep_data["records"]:
                created = await self._ingest_whoop_sleep_record(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=account_source.id,
                    record=record,
                )
                counts["events"] += created

        if workout_data and workout_data.get("records"):
            for record in workout_data["records"]:
                created = await self._ingest_whoop_workout_record(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=account_source.id,
                    record=record,
                )
                counts["events"] += created

        await self.update_connection_sync_state(connection_id=connection.id)
        return counts

    async def _ingest_whoop_recovery_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        score: Dict[str, Any],
    ) -> int:
        created_count = 0
        recorded_at = None
        created_at = record.get("created_at")
        if created_at:
            recorded_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        attributed_date = created_at[:10] if created_at else None
        for provider_metric_type, unit in (
            ("recovery_score", "count"),
            ("hrv_rmssd", "ms"),
            ("resting_heart_rate", "bpm"),
            ("spo2_percentage", "percent"),
            ("skin_temp_celsius", "count"),
        ):
            value = {
                "recovery_score": score.get("recovery_score"),
                "hrv_rmssd": score.get("hrv_rmssd_milli"),
                "resting_heart_rate": score.get("resting_heart_rate"),
                "spo2_percentage": score.get("spo2_percentage"),
                "skin_temp_celsius": score.get("skin_temp_celsius"),
            }.get(provider_metric_type)
            if value in (None, ""):
                continue
            metric_type = self.normalization.canonicalize_metric_type("whoop", provider_metric_type)
            external_id = f"{record.get('cycle_id', '')}:{provider_metric_type}"
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="whoop",
                metric_type=metric_type,
                provider_metric_type=provider_metric_type,
                external_id=external_id,
                recorded_at=recorded_at,
                start_time=recorded_at,
                end_time=recorded_at,
                attributed_date=attributed_date,
                value=float(value),
                unit=unit,
                aggregation_kind="point",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"cycle_id": record.get("cycle_id"), "raw_payload": record}),
                raw_payload_id=None,
            )
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="whoop",
                sample_id=sample_id,
                created=created,
            )
            created_count += 1 if created else 0
        return created_count

    async def _ingest_whoop_sleep_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        start_raw = record.get("start")
        end_raw = record.get("end")
        if not start_raw or not end_raw:
            return 0
        start_time = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        score = record.get("score") or {}
        stage_summary = score.get("stage_summary") or {}
        total_sleep_minutes = (
            stage_summary.get("total_rem_sleep_time_milli", 0)
            + stage_summary.get("total_slow_wave_sleep_time_milli", 0)
            + stage_summary.get("total_light_sleep_time_milli", 0)
        ) / 60000.0
        sleep_external_id = (
            record.get("id")
            or record.get("cycle_id")
            or f"{start_raw}:{end_raw}"
        )
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="whoop",
            event_type="sleep_total",
            provider_event_type="sleep_session",
            external_id=str(sleep_external_id),
            start_time=start_time,
            end_time=end_time,
            attributed_date=end_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title="Whoop Sleep",
            summary_value=total_sleep_minutes,
            summary_unit="minutes",
            details={
                "sleep_efficiency": score.get("sleep_efficiency_percentage"),
                "sleep_performance": score.get("sleep_performance_percentage"),
                "cycle_id": record.get("cycle_id"),
                "stage_summary": stage_summary,
            },
            raw_payload_id=None,
        )
        await self._project_and_emit_event(
            user_id=user_id,
            provider="whoop",
            event_id=event_id,
            created=created,
        )
        return 1 if created else 0

    async def _ingest_whoop_workout_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        start_raw = record.get("start")
        end_raw = record.get("end")
        if not start_raw or not end_raw:
            return 0
        start_time = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        score = record.get("score") or {}
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="whoop",
            event_type="workout",
            provider_event_type=f"sport_{record.get('sport_id', 'unknown')}",
            external_id=record.get("id"),
            start_time=start_time,
            end_time=end_time,
            attributed_date=start_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title="Whoop Workout",
            summary_value=score.get("strain"),
            summary_unit="count",
            details={
                "distance_meter": score.get("distance_meter"),
                "kilojoule": score.get("kilojoule"),
                "average_heart_rate": score.get("average_heart_rate"),
                "max_heart_rate": score.get("max_heart_rate"),
            },
            raw_payload_id=None,
        )
        await self._project_and_emit_event(
            user_id=user_id,
            provider="whoop",
            event_id=event_id,
            created=created,
        )
        return 1 if created else 0
