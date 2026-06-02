"""Oura wearable ingest operations."""

from .common import *
from .capabilities import RAW_PAYLOAD_TTL_DAYS, _default_source_priority_rank
from .outbox import build_wearable_outbox_event_for_event, build_wearable_outbox_event_for_sample

class WearableOuraSyncMixin:
    async def ingest_oura_data(
        self,
        *,
        user_id: str,
        provider_user_id: str,
        personal_info: Optional[Dict[str, Any]],
        access_token: Optional[str],
        refresh_token: Optional[str],
        token_expires_at: Optional[datetime],
        daily_sleep_records: List[Dict[str, Any]],
        sleep_records: List[Dict[str, Any]],
        daily_readiness_records: List[Dict[str, Any]],
        daily_activity_records: List[Dict[str, Any]],
        workout_records: List[Dict[str, Any]],
        heartrate_records: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="oura",
            auth_method="oauth",
            provider_user_id=provider_user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            settings={"personal_info": personal_info or {}},
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="oura",
            connection_id=connection.id,
            source_kind="account",
            external_source_id=provider_user_id,
            external_source_name=(personal_info or {}).get("email") or "Oura Account",
            device_name=(personal_info or {}).get("device_model"),
        )
        await self.store_raw_payload(
            user_id=user_id,
            provider="oura",
            direction="oauth_pull",
            payload={
                "provider_user_id": provider_user_id,
                "personal_info": personal_info,
                "daily_sleep_records": daily_sleep_records,
                "sleep_records": sleep_records,
                "daily_readiness_records": daily_readiness_records,
                "daily_activity_records": daily_activity_records,
                "workout_records": workout_records,
                "heartrate_records": heartrate_records,
            },
            connection_id=connection.id,
            external_id=provider_user_id,
        )

        counts = {"samples": 0, "events": 0}
        affected_dates = self._oura_affected_dates(
            daily_sleep_records=daily_sleep_records,
            sleep_records=sleep_records,
            daily_readiness_records=daily_readiness_records,
            daily_activity_records=daily_activity_records,
            workout_records=workout_records,
            heartrate_records=heartrate_records,
        )
        sleep_daily_by_day = {
            str(record.get("day")): record
            for record in daily_sleep_records
            if record.get("day")
        }

        for record in daily_activity_records:
            counts["samples"] += await self._ingest_oura_daily_activity_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in daily_readiness_records:
            counts["samples"] += await self._ingest_oura_daily_readiness_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in sleep_records:
            counts["events"] += await self._ingest_oura_sleep_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
                daily_sleep_record=sleep_daily_by_day.get(str(record.get("day"))),
            )

        for record in daily_sleep_records:
            counts["samples"] += await self._ingest_oura_daily_sleep_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in workout_records:
            counts["events"] += await self._ingest_oura_workout_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in heartrate_records:
            counts["samples"] += await self._ingest_oura_heartrate_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        projected_records = counts["samples"] + counts["events"]
        post_ingest = await self.post_ingest_service.run_for_provider_dates(
            user_id=user_id,
            provider="oura",
            affected_dates=affected_dates,
            projected_records=projected_records,
        )
        if post_ingest.success:
            await self.update_connection_sync_state(connection_id=connection.id)
        else:
            await self.update_connection_sync_state(
                connection_id=connection.id,
                error={
                    "message": "Oura post-ingest failed",
                    "detail": post_ingest.error,
                    "affected_dates": post_ingest.affected_dates,
                },
            )
        return {
            **counts,
            "post_ingest": post_ingest.as_dict(),
            "post_ingest_success": post_ingest.success,
            "metric_facts": post_ingest.metric_facts,
            "metric_facts_error": post_ingest.error,
        }

    def _oura_affected_dates(
        self,
        *,
        daily_sleep_records: List[Dict[str, Any]],
        sleep_records: List[Dict[str, Any]],
        daily_readiness_records: List[Dict[str, Any]],
        daily_activity_records: List[Dict[str, Any]],
        workout_records: List[Dict[str, Any]],
        heartrate_records: List[Dict[str, Any]],
    ) -> List[str]:
        dates: List[str] = []
        for record in daily_sleep_records:
            self._append_date_prefix(dates, record.get("day") or record.get("summary_date"))
        for record in sleep_records:
            self._append_date_prefix(
                dates,
                record.get("day")
                or record.get("summary_date")
                or record.get("bedtime_end")
                or record.get("end_datetime")
                or record.get("end_time")
                or record.get("bedtime_start")
                or record.get("start_datetime")
                or record.get("start_time"),
            )
        for record in daily_readiness_records:
            self._append_date_prefix(dates, record.get("day") or record.get("summary_date"))
        for record in daily_activity_records:
            self._append_date_prefix(dates, record.get("day") or record.get("summary_date"))
        for record in workout_records:
            self._append_date_prefix(
                dates,
                record.get("start_datetime") or record.get("start_time"),
            )
        for record in heartrate_records:
            self._append_date_prefix(
                dates,
                record.get("timestamp") or record.get("datetime"),
            )
        return sorted(set(dates))

    @staticmethod
    def _append_date_prefix(dates: List[str], value: Any) -> None:
        if not value:
            return
        text = str(value)
        if len(text) >= 10:
            dates.append(text[:10])

    async def _ingest_oura_daily_activity_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        created_count = 0
        day = str(record.get("day") or record.get("summary_date") or "")
        if not day:
            return 0
        record_dt = datetime.fromisoformat(f"{day}T12:00:00+00:00")
        fields = [
            ("steps", record.get("steps"), "count"),
            ("active_energy", record.get("active_calories") or record.get("cal_active"), "kcal"),
            ("distance", record.get("equivalent_walking_distance"), "meters"),
            ("activity_score", record.get("score"), "count"),
        ]
        for provider_metric_type, value, unit in fields:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=day,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=created,
            )
            created_count += 1 if created else 0
        return created_count

    async def _ingest_oura_daily_readiness_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        created_count = 0
        day = str(record.get("day") or record.get("summary_date") or "")
        if not day:
            return 0
        record_dt = datetime.fromisoformat(f"{day}T12:00:00+00:00")
        fields = [
            ("readiness_score", record.get("score"), "count"),
            ("temperature_deviation", record.get("temperature_deviation"), "celsius"),
        ]
        for provider_metric_type, value, unit in fields:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=day,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=created,
            )
            created_count += 1 if created else 0
        return created_count

    async def _ingest_oura_daily_sleep_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        created_count = 0
        day = str(record.get("day") or "")
        if not day:
            return 0
        record_dt = datetime.fromisoformat(f"{day}T12:00:00+00:00")
        fields = [
            ("sleep_score", record.get("score"), "count"),
            ("sleep_deep", self._duration_to_minutes(record.get("deep_sleep_duration")), "minutes"),
            ("sleep_rem", self._duration_to_minutes(record.get("rem_sleep_duration")), "minutes"),
            ("sleep_light", self._duration_to_minutes(record.get("light_sleep_duration")), "minutes"),
        ]
        for provider_metric_type, value, unit in fields:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=day,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=created,
            )
            created_count += 1 if created else 0
        return created_count

    async def _ingest_oura_sleep_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        daily_sleep_record: Optional[Dict[str, Any]],
    ) -> int:
        start_raw = record.get("bedtime_start") or record.get("start_datetime") or record.get("start_time")
        end_raw = record.get("bedtime_end") or record.get("end_datetime") or record.get("end_time")
        day = str(record.get("day") or record.get("summary_date") or "")
        if not start_raw or not end_raw:
            return 0
        start_time = self._parse_dt(start_raw)
        end_time = self._parse_dt(end_raw)
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="oura",
            event_type="sleep_total",
            provider_event_type="sleep_session",
            external_id=str(record.get("id") or f"{day}:{start_raw}"),
            start_time=start_time,
            end_time=end_time,
            attributed_date=day or end_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title="Oura Sleep",
            summary_value=self._duration_to_minutes(record.get("total_sleep_duration")),
            summary_unit="minutes",
            details={
                "average_hrv": record.get("average_hrv"),
                "average_heart_rate": record.get("average_heart_rate"),
                "lowest_heart_rate": record.get("lowest_heart_rate"),
                "daily_sleep": daily_sleep_record,
                "raw_payload": record,
            },
            raw_payload_id=None,
        )
        await self._project_and_emit_event(
            user_id=user_id,
            provider="oura",
            event_id=event_id,
            created=created,
        )

        sample_fields = [
            ("average_hrv", record.get("average_hrv"), "ms"),
            ("lowest_heart_rate", record.get("lowest_heart_rate"), "bpm"),
        ]
        for provider_metric_type, value, unit in sample_fields:
            if value in (None, ""):
                continue
            sample_id, sample_created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=end_time,
                start_time=end_time,
                end_time=end_time,
                attributed_date=day or end_time.strftime("%Y-%m-%d"),
                value=float(value),
                unit=unit,
                aggregation_kind="point",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=sample_created,
            )
        return 1 if created else 0

    async def _ingest_oura_workout_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        start_raw = record.get("start_datetime") or record.get("start_time")
        end_raw = record.get("end_datetime") or record.get("end_time")
        if not start_raw or not end_raw:
            return 0
        start_time = self._parse_dt(start_raw)
        end_time = self._parse_dt(end_raw)
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="oura",
            event_type="workout",
            provider_event_type=str(record.get("sport_name") or record.get("type") or "workout"),
            external_id=str(record.get("id") or f"workout:{start_raw}"),
            start_time=start_time,
            end_time=end_time,
            attributed_date=start_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title=str(record.get("sport_name") or "Oura Workout"),
            summary_value=float(record.get("calories") or 0) if record.get("calories") is not None else None,
            summary_unit="kcal" if record.get("calories") is not None else None,
            details=record,
            raw_payload_id=None,
        )
        await self._project_and_emit_event(
            user_id=user_id,
            provider="oura",
            event_id=event_id,
            created=created,
        )
        return 1 if created else 0

    async def _ingest_oura_heartrate_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        bpm = record.get("bpm") or record.get("heart_rate")
        timestamp = record.get("timestamp") or record.get("datetime")
        if bpm in (None, "") or not timestamp:
            return 0
        recorded_at = self._parse_dt(timestamp)
        sample_id, created = await self._upsert_sample(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="oura",
            metric_type="heart_rate",
            provider_metric_type="heartrate",
            external_id=str(record.get("id") or f"heartrate:{timestamp}"),
            recorded_at=recorded_at,
            start_time=recorded_at,
            end_time=recorded_at,
            attributed_date=recorded_at.strftime("%Y-%m-%d"),
            value=float(bpm),
            unit="bpm",
            aggregation_kind="point",
            confidence=None,
            timezone="UTC",
            attributes_json=json.dumps({"raw_payload": record}),
            raw_payload_id=None,
        )
        await self._project_and_emit_sample(
            user_id=user_id,
            provider="oura",
            sample_id=sample_id,
            created=created,
        )
        return 1 if created else 0
