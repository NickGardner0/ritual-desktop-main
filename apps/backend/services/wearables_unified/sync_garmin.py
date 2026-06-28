"""Garmin wearable ingest operations."""

from .common import *
from .capabilities import RAW_PAYLOAD_TTL_DAYS, _default_source_priority_rank
from .outbox import build_wearable_outbox_event_for_event, build_wearable_outbox_event_for_sample

class WearableGarminSyncMixin:
    async def ingest_garmin_payload(
        self,
        *,
        user_id: str,
        provider_user_id: str,
        payload: Dict[str, Any],
        access_token: Optional[str],
        refresh_token: Optional[str],
        token_expires_at: Optional[datetime],
    ) -> Dict[str, Any]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="garmin",
            auth_method="oauth",
            provider_user_id=provider_user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="garmin",
            connection_id=connection.id,
            source_kind="account",
            external_source_id=provider_user_id,
            external_source_name="Garmin Account",
        )
        raw_payload = await self.store_raw_payload(
            user_id=user_id,
            provider="garmin",
            direction="webhook",
            payload=payload,
            connection_id=connection.id,
            external_id=provider_user_id,
        )

        counts = {"samples": 0, "events": 0}
        affected_dates = self._garmin_affected_dates(payload)
        for record in self._extract_collection(payload, "dailySummaries", "summaries", "daily_summary", "daily_summaries"):
            sample_count, event_count = await self._ingest_garmin_daily_summary_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
                raw_payload_id=raw_payload.id,
            )
            counts["samples"] += sample_count
            counts["events"] += event_count

        for record in self._extract_collection(payload, "activities", "activityDetails", "activity_details"):
            counts["events"] += await self._ingest_garmin_activity_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
                raw_payload_id=raw_payload.id,
            )

        projected_records = counts["samples"] + counts["events"]
        post_ingest = await self.post_ingest_service.run_for_provider_dates(
            user_id=user_id,
            provider="garmin",
            affected_dates=affected_dates,
            projected_records=projected_records,
        )
        if post_ingest.success:
            await self.update_connection_sync_state(connection_id=connection.id)
        else:
            await self.update_connection_sync_state(
                connection_id=connection.id,
                error={
                    "message": "Garmin post-ingest failed",
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

    def _garmin_affected_dates(self, payload: Dict[str, Any]) -> List[str]:
        dates: List[str] = []
        for record in self._extract_collection(payload, "dailySummaries", "summaries", "daily_summary", "daily_summaries"):
            date_value = self._extract_date_value(record)
            if date_value:
                dates.append(str(date_value)[:10])
            sleep_end = self._get_first(record, "sleepEndTimestampGMT", "sleepEndTimeGmt", "sleepEnd")
            if sleep_end:
                dates.append(str(sleep_end)[:10])
        for record in self._extract_collection(payload, "activities", "activityDetails", "activity_details"):
            start_raw = self._get_first(record, "activityStartTimeGMT", "startTimeGMT", "startTimeLocal", "startTime")
            if start_raw:
                dates.append(str(start_raw)[:10])
        return sorted({date for date in dates if len(date) >= 10})

    async def _ingest_garmin_daily_summary_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        raw_payload_id: Optional[str],
    ) -> Tuple[int, int]:
        sample_count = 0
        event_count = 0
        date_value = self._extract_date_value(record)
        if not date_value:
            return (0, 0)
        record_dt = datetime.fromisoformat(f"{date_value}T12:00:00+00:00")
        field_map = [
            ("steps", self._get_first(record, "steps"), "count"),
            ("distance", self._get_first(record, "distanceInMeters", "distance", "totalDistanceMeters"), "meters"),
            ("active_energy", self._get_first(record, "activeKilocalories", "activeCalories", "calories", "active_energy"), "kcal"),
            ("resting_heart_rate", self._get_first(record, "restingHeartRateInBeatsPerMinute", "restingHeartRate", "resting_heart_rate"), "bpm"),
            ("stress", self._get_first(record, "averageStressLevel", "stressLevel", "stress"), "count"),
            ("body_battery", self._get_first(record, "bodyBatteryMostRecentValue", "bodyBattery", "bodyBatteryHighestValue"), "count"),
        ]
        base_external_id = str(self._get_first(record, "summaryId", "calendarDate", "wellnessStartTimeGmt", "startTimeInSeconds", default=date_value))
        for provider_metric_type, value, unit in field_map:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="garmin",
                metric_type=self.normalization.canonicalize_metric_type("garmin", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{base_external_id}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=date_value,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=raw_payload_id,
            )
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="garmin",
                sample_id=sample_id,
                created=created,
            )
            sample_count += 1 if created else 0

        sleep_start = self._get_first(record, "sleepStartTimestampGMT", "sleepStartTimeGmt", "sleepStart")
        sleep_end = self._get_first(record, "sleepEndTimestampGMT", "sleepEndTimeGmt", "sleepEnd")
        if sleep_start and sleep_end:
            start_time = self._parse_dt(sleep_start)
            end_time = self._parse_dt(sleep_end)
            event_id, created = await self._upsert_event(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="garmin",
                event_type="sleep_total",
                provider_event_type="sleep_session",
                external_id=f"{base_external_id}:sleep",
                start_time=start_time,
                end_time=end_time,
                attributed_date=date_value,
                timezone="UTC",
                title="Garmin Sleep",
                summary_value=(end_time - start_time).total_seconds() / 60.0,
                summary_unit="minutes",
                details=record,
                raw_payload_id=raw_payload_id,
            )
            await self._project_and_emit_event(
                user_id=user_id,
                provider="garmin",
                event_id=event_id,
                created=created,
            )
            event_count += 1 if created else 0
        return (sample_count, event_count)

    async def _ingest_garmin_activity_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        raw_payload_id: Optional[str],
    ) -> int:
        start_raw = self._get_first(record, "activityStartTimeGMT", "startTimeGMT", "startTimeLocal", "startTime")
        end_raw = self._get_first(record, "activityEndTimeGMT", "endTimeGMT", "endTimeLocal", "endTime")
        if not start_raw or not end_raw:
            return 0
        start_time = self._parse_dt(start_raw)
        end_time = self._parse_dt(end_raw)
        external_id = str(self._get_first(record, "activityId", "summaryId", "activityUUID", default=f"activity:{start_raw}"))
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="garmin",
            event_type="workout",
            provider_event_type=str(self._get_first(record, "activityType", "activityName", default="garmin_activity")),
            external_id=external_id,
            start_time=start_time,
            end_time=end_time,
            attributed_date=start_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title=str(self._get_first(record, "activityName", "activityType", default="Garmin Activity")),
            summary_value=float(self._get_first(record, "activeKilocalories", "calories", default=0) or 0),
            summary_unit="kcal",
            details=record,
            raw_payload_id=raw_payload_id,
        )
        await self._project_and_emit_event(
            user_id=user_id,
            provider="garmin",
            event_id=event_id,
            created=created,
        )
        return 1 if created else 0
