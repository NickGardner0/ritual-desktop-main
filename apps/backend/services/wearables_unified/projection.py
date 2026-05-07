"""Wearable to habit-log projection services."""

from .common import *
from .normalization import WearableNormalizationService

class WearableProjectionService:
    LEGACY_METRIC_EQUIVALENTS: Dict[str, set[str]] = {
        "sleep_total": {"sleep_total", "sleep_session", "sleep_duration", "sleep", "in_bed"},
        "sleep_light": {"sleep_light", "sleep_core"},
        "heart_rate": {"heart_rate", "hr"},
        "resting_heart_rate": {"resting_heart_rate", "resting_hr"},
        "walking_heart_rate": {"walking_heart_rate", "walking_hr"},
        "hrv": {"hrv", "hrv_rmssd"},
        "strain_score": {"strain_score", "strain"},
        "oxygen_saturation": {"oxygen_saturation", "spo2_percentage"},
        "temperature_delta": {"temperature_delta", "skin_temp_celsius"},
    }

    def __init__(self, normalization: WearableNormalizationService):
        self.normalization = normalization

    def _candidate_metric_types(self, metric_type: str) -> set[str]:
        normalized_metric = (metric_type or "").strip().lower()
        if not normalized_metric:
            return set()
        return set(self.LEGACY_METRIC_EQUIVALENTS.get(normalized_metric, {normalized_metric}))

    def _habit_matches_metric_type(self, habit: HabitDB, metric_type: str) -> bool:
        normalized_metric = (metric_type or "").strip().lower()
        habit_metric = (habit.metric_type or "").strip().lower()

        if habit_metric:
            return habit_metric in self._candidate_metric_types(normalized_metric)

        habit_name = (habit.name or "").strip().lower()
        if normalized_metric == "sleep_total":
            return "sleep" in habit_name
        if normalized_metric.startswith("sleep_"):
            metric_hint = normalized_metric.replace("sleep_", "").replace("_", " ")
            return "sleep" in habit_name and metric_hint in habit_name
        if normalized_metric == "workout":
            return "workout" in habit_name or "exercise" in habit_name
        if normalized_metric in {"heart_rate", "hr"}:
            return "heart rate" in habit_name
        if normalized_metric == "steps":
            return "step" in habit_name or "walk" in habit_name
        return False

    def _canonical_metric_type(self, metric_type: Optional[str]) -> Optional[str]:
        normalized_metric = (metric_type or "").strip().lower()
        if not normalized_metric:
            return None
        for canonical_metric, aliases in self.LEGACY_METRIC_EQUIVALENTS.items():
            if normalized_metric == canonical_metric or normalized_metric in aliases:
                return canonical_metric
        return normalized_metric

    def _default_canonical_metric_type_for_habit(self, habit: HabitDB) -> Optional[str]:
        habit_metric = self._canonical_metric_type(getattr(habit, "metric_type", None))
        if habit_metric:
            return habit_metric

        habit_name = (habit.name or "").strip().lower()
        if "sleep" in habit_name:
            return "sleep_total"
        if "workout" in habit_name or "exercise" in habit_name:
            return "workout"
        if "heart rate" in habit_name:
            return "heart_rate"
        if "step" in habit_name or "walk" in habit_name:
            return "steps"
        return None

    def _normalize_projection_source_priority(
        self,
        values: Optional[Iterable[str]],
        *,
        default: Optional[Iterable[str]] = None,
    ) -> List[str]:
        normalized: List[str] = []
        for value in values or []:
            item = str(value or "").strip().lower()
            if item and item not in normalized:
                normalized.append(item)
        if normalized:
            return normalized
        return [
            item
            for item in (str(entry or "").strip().lower() for entry in (default or []))
            if item
        ]

    def _default_projection_source_priority_for_habit(self, habit: HabitDB) -> List[str]:
        canonical_metric_type = self._default_canonical_metric_type_for_habit(habit)
        integration_source = (getattr(habit, "integration_source", None) or "manual").strip().lower()

        if canonical_metric_type == "sleep_total" and integration_source == "whoop":
            return ["whoop", "apple_health"]
        if canonical_metric_type == "workout" and integration_source == "manual":
            return ["manual"]
        if integration_source:
            return [integration_source]
        return ["manual"]

    def _decode_projection_source_priority(
        self,
        projection_source_priority_json: Optional[str],
    ) -> List[str]:
        if not projection_source_priority_json:
            return []
        try:
            raw_value = json.loads(projection_source_priority_json)
        except Exception:
            return []
        if not isinstance(raw_value, list):
            return []
        return [value for value in raw_value if isinstance(value, str)]

    def _serialize_projection_policy(
        self,
        habit: HabitDB,
        policy: Optional[HabitProjectionPolicyDB] = None,
    ) -> Dict[str, Any]:
        default_canonical_metric_type = self._default_canonical_metric_type_for_habit(habit)
        default_priority = self._default_projection_source_priority_for_habit(habit)
        projection_source_priority = self._normalize_projection_source_priority(
            self._decode_projection_source_priority(
                policy.projection_source_priority_json if policy else None
            ),
            default=default_priority,
        )
        return {
            "habit_id": habit.id,
            "canonical_metric_type": (
                (policy.canonical_metric_type if policy else None) or default_canonical_metric_type
            ),
            "projection_source_priority": projection_source_priority,
        }

    async def _get_or_create_projection_policy(
        self,
        session: Any,
        *,
        habit: HabitDB,
    ) -> HabitProjectionPolicyDB:
        result = await session.execute(
            select(HabitProjectionPolicyDB).where(HabitProjectionPolicyDB.habit_id == habit.id)
        )
        policy = result.scalar_one_or_none()
        default_canonical_metric_type = self._default_canonical_metric_type_for_habit(habit)
        default_priority = self._default_projection_source_priority_for_habit(habit)

        if policy is None:
            policy = HabitProjectionPolicyDB(
                id=str(uuid.uuid4()),
                user_id=habit.user_id,
                habit_id=habit.id,
                canonical_metric_type=default_canonical_metric_type,
                projection_source_priority_json=json.dumps(default_priority),
            )
            session.add(policy)
            await session.flush()
            return policy

        updated = False
        if not policy.canonical_metric_type and default_canonical_metric_type:
            policy.canonical_metric_type = default_canonical_metric_type
            updated = True

        normalized_priority = self._normalize_projection_source_priority(
            self._decode_projection_source_priority(policy.projection_source_priority_json),
            default=default_priority,
        )
        normalized_priority_json = json.dumps(normalized_priority)
        if policy.projection_source_priority_json != normalized_priority_json:
            policy.projection_source_priority_json = normalized_priority_json
            updated = True

        if updated:
            await session.flush()
        return policy

    async def get_projection_policy(
        self,
        *,
        user_id: str,
        habit_id: str,
    ) -> Optional[Dict[str, Any]]:
        async with get_db_session() as session:
            habit = await session.get(HabitDB, habit_id)
            if habit is None or habit.user_id != user_id:
                return None
            policy = await self._get_or_create_projection_policy(session, habit=habit)
            await session.commit()
            return self._serialize_projection_policy(habit, policy)

    async def update_projection_policy(
        self,
        *,
        user_id: str,
        habit_id: str,
        projection_source_priority: Optional[Iterable[str]],
        canonical_metric_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        async with get_db_session() as session:
            habit = await session.get(HabitDB, habit_id)
            if habit is None or habit.user_id != user_id:
                return None

            policy = await self._get_or_create_projection_policy(session, habit=habit)
            default_priority = self._default_projection_source_priority_for_habit(habit)
            normalized_priority = self._normalize_projection_source_priority(
                projection_source_priority,
                default=default_priority,
            )
            policy.projection_source_priority_json = json.dumps(normalized_priority)
            policy.canonical_metric_type = (
                self._canonical_metric_type(canonical_metric_type)
                or policy.canonical_metric_type
                or self._default_canonical_metric_type_for_habit(habit)
            )
            await session.commit()
            await session.refresh(policy)
            return self._serialize_projection_policy(habit, policy)

    async def _habit_accepts_projection(
        self,
        session: Any,
        *,
        habit: HabitDB,
        provider: str,
        metric_type: str,
    ) -> bool:
        if not self._habit_matches_metric_type(habit, metric_type):
            return False

        policy = await self._get_or_create_projection_policy(session, habit=habit)
        serialized_policy = self._serialize_projection_policy(habit, policy)
        canonical_metric_type = self._canonical_metric_type(metric_type)
        if (
            serialized_policy["canonical_metric_type"]
            and canonical_metric_type
            and serialized_policy["canonical_metric_type"] != canonical_metric_type
        ):
            return False

        projection_source_priority = serialized_policy["projection_source_priority"]
        return bool(projection_source_priority) and provider.strip().lower() == projection_source_priority[0]

    async def project_sample(
        self,
        *,
        user_id: str,
        provider: str,
        sample: WearableSampleDB,
    ) -> None:
        if sample.should_project_to_habit_logs in {False, 0}:
            return
        date_value = sample.attributed_date
        if not date_value:
            reference_dt = sample.start_time or sample.recorded_at or sample.end_time
            if reference_dt is None:
                return
            date_value = reference_dt.strftime("%Y-%m-%d")

        duration, amount = self.normalization.log_values(sample.metric_type, sample.unit, sample.value)
        await self._upsert_habit_logs(
            user_id=user_id,
            provider=provider,
            metric_type=sample.metric_type,
            date_value=date_value,
            completed_at=(sample.end_time or sample.recorded_at or sample.start_time),
            duration=duration,
            amount=amount,
            origin_kind="sample",
            origin_id=sample.id,
            note=f"Auto-synced from {provider}",
        )

    async def project_event(
        self,
        *,
        user_id: str,
        provider: str,
        event: WearableEventDB,
    ) -> None:
        date_value = event.attributed_date or event.start_time.strftime("%Y-%m-%d")
        duration_seconds = int((event.end_time - event.start_time).total_seconds())
        amount = event.summary_value
        if event.summary_value is not None and event.summary_unit:
            normalized_duration, normalized_amount = self.normalization.log_values(
                event.event_type,
                event.summary_unit,
                float(event.summary_value),
            )
            if normalized_duration is not None:
                duration_seconds = normalized_duration
                amount = None
            elif normalized_amount is not None:
                amount = normalized_amount
        await self._upsert_habit_logs(
            user_id=user_id,
            provider=provider,
            metric_type=event.event_type,
            date_value=date_value,
            completed_at=event.end_time,
            duration=duration_seconds,
            amount=amount,
            origin_kind="event",
            origin_id=event.id,
            note=f"Auto-synced from {provider}",
        )

    async def delete_projection(self, origin_kind: str, origin_id: str) -> int:
        async with get_db_session() as session:
            result = await session.execute(
                select(HabitLogDB).where(
                    HabitLogDB.origin_record_kind == origin_kind,
                    HabitLogDB.origin_record_id == origin_id,
                )
            )
            logs = list(result.scalars().all())
            deleted = len(logs)
            for log in logs:
                await session.delete(log)
            await session.commit()
            return deleted

    async def backfill_projections(
        self,
        *,
        user_id: str,
        provider: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, int]:
        def in_range(date_value: Optional[str]) -> bool:
            if not date_value:
                return False
            if start_date and date_value < start_date:
                return False
            if end_date and date_value > end_date:
                return False
            return True

        async with get_db_session() as session:
            sample_query = select(WearableSampleDB).where(WearableSampleDB.user_id == user_id)
            event_query = select(WearableEventDB).where(WearableEventDB.user_id == user_id)

            if provider:
                sample_query = sample_query.where(WearableSampleDB.provider == provider)
                event_query = event_query.where(WearableEventDB.provider == provider)

            sample_query = sample_query.where(WearableSampleDB.deleted_at.is_(None))
            event_query = event_query.where(WearableEventDB.deleted_at.is_(None))

            samples_result = await session.execute(sample_query)
            events_result = await session.execute(event_query)
            samples = list(samples_result.scalars().all())
            events = list(events_result.scalars().all())

        projected_samples = 0
        projected_events = 0

        for sample in samples:
            date_value = sample.attributed_date or (
                sample.start_time or sample.recorded_at or sample.end_time
            ).strftime("%Y-%m-%d")
            if not in_range(date_value):
                continue
            await self.project_sample(user_id=user_id, provider=sample.provider, sample=sample)
            projected_samples += 1

        for event in events:
            date_value = event.attributed_date or event.start_time.strftime("%Y-%m-%d")
            if not in_range(date_value):
                continue
            await self.project_event(user_id=user_id, provider=event.provider, event=event)
            projected_events += 1

        return {
            "projected_samples": projected_samples,
            "projected_events": projected_events,
            "total": projected_samples + projected_events,
        }

    async def _upsert_habit_logs(
        self,
        *,
        user_id: str,
        provider: str,
        metric_type: str,
        date_value: str,
        completed_at: Optional[datetime],
        duration: Optional[int],
        amount: Optional[float],
        origin_kind: str,
        origin_id: str,
        note: str,
    ) -> None:
        async with get_db_session() as session:
            tinybird_payloads: List[Dict[str, Any]] = []
            habits_result = await session.execute(
                select(HabitDB).where(HabitDB.user_id == user_id)
            )
            habits: List[HabitDB] = []
            for habit in habits_result.scalars().all():
                if await self._habit_accepts_projection(
                    session,
                    habit=habit,
                    provider=provider,
                    metric_type=metric_type,
                ):
                    habits.append(habit)
            if not habits:
                return

            for habit in habits:
                existing_result = await session.execute(
                    select(HabitLogDB).where(
                        HabitLogDB.habit_id == habit.id,
                        HabitLogDB.origin_record_kind == origin_kind,
                        HabitLogDB.origin_record_id == origin_id,
                    )
                )
                existing = existing_result.scalar_one_or_none()
                if existing is None and metric_type.startswith("sleep_"):
                    legacy_result = await session.execute(
                        select(HabitLogDB).where(
                            HabitLogDB.habit_id == habit.id,
                            HabitLogDB.date == date_value,
                            HabitLogDB.origin_record_kind.is_(None),
                            HabitLogDB.origin_record_id.is_(None),
                        ).order_by(HabitLogDB.completed_at.desc())
                    )
                    existing = legacy_result.scalar_one_or_none()
                completed_at_str = completed_at.isoformat() if completed_at else None
                if existing is None:
                    existing = HabitLogDB(
                        id=str(uuid.uuid4()),
                        habit_id=habit.id,
                        habit_name=habit.name,
                        date=date_value,
                        status="completed",
                        source=provider,
                        notes=note,
                        origin_record_kind=origin_kind,
                        origin_record_id=origin_id,
                    )
                    session.add(existing)

                existing.date = date_value
                existing.completed_at = completed_at_str
                existing.duration = duration
                existing.amount = amount
                existing.notes = note
                existing.source = provider
                existing.origin_record_kind = origin_kind
                existing.origin_record_id = origin_id
                tinybird_payloads.append(
                    {
                        "id": existing.id,
                        "habit_id": existing.habit_id,
                        "habit_name": existing.habit_name,
                        "user_id": user_id,
                        "date": existing.date,
                        "duration": existing.duration,
                        "amount": existing.amount,
                        "unit": habit.unit_type or "",
                        "status": existing.status,
                        "notes": existing.notes,
                        "source": provider,
                        "integration_source": habit.integration_source or provider,
                        "metric_type": habit.metric_type,
                        "metadata": existing.log_metadata,
                        "completed_at": existing.completed_at or existing.date,
                    }
                )

            await session.commit()

            try:
                from services.tinybird_service import TinybirdService

                tinybird = TinybirdService()
            except Exception:
                tinybird = None

            if tinybird is not None and tinybird_payloads:
                try:
                    result = await tinybird.ingest_habit_logs_batch(tinybird_payloads)
                    if not result.get("success"):
                        logger.warning(
                            "Tinybird sync failed for projected wearable logs: %s",
                            result.get("errors") or result.get("error"),
                        )
                except Exception as exc:
                    logger.warning("Tinybird sync failed for projected wearable logs: %s", exc)

