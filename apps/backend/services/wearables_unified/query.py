"""Wearable timeline, series, and aggregate query services."""

from .common import *
from .capabilities import PROVIDER_PRIORITY_RANKS, SOURCE_KIND_PRIORITY_RANKS

class WearableQueryService:
    METRIC_TYPE_ALIASES = {
        "sleep": "sleep_total",
        "sleep_session": "sleep_total",
        "sleep_duration": "sleep_total",
        "in_bed": "sleep_total",
    }
    CUMULATIVE_METRICS = {
        "steps",
        "active_energy",
        "basal_energy",
        "distance",
        "flights_climbed",
        "exercise_time",
        "stand_time",
        "dietary_energy",
        "dietary_protein",
        "dietary_carbs",
        "dietary_fat",
        "dietary_fiber",
        "dietary_sugar",
        "dietary_water",
        "dietary_caffeine",
        "sleep_total",
        "sleep_awake",
        "sleep_rem",
        "sleep_deep",
        "sleep_light",
        "workout",
        "mindful_minutes",
    }
    MIN_METRICS = {"resting_heart_rate"}

    def __init__(self, projection_service: Optional[Any] = None):
        self.projection_service = projection_service

    @classmethod
    def _canonical_metric_type(cls, metric_type: Optional[str]) -> Optional[str]:
        normalized = str(metric_type or "").strip().lower()
        if not normalized:
            return None
        return cls.METRIC_TYPE_ALIASES.get(normalized, normalized)

    @classmethod
    def _normalize_metric_filter(cls, metric_types: Optional[List[str]]) -> List[str]:
        normalized: List[str] = []
        for metric_type in metric_types or []:
            canonical = cls._canonical_metric_type(metric_type)
            if canonical and canonical not in normalized:
                normalized.append(canonical)
        return normalized

    @staticmethod
    def _isoformat(value: Optional[datetime]) -> Optional[str]:
        return value.isoformat() if value else None

    @staticmethod
    def _safe_json_loads(value: Optional[str]) -> Optional[Dict[str, Any]]:
        if not value:
            return None
        try:
            parsed = json.loads(value)
        except Exception:
            return {"raw": value}
        return parsed if isinstance(parsed, dict) else {"value": parsed}

    @classmethod
    def _source_device_name_from_sample(cls, sample: WearableSampleDB) -> Optional[str]:
        attributes = cls._safe_json_loads(sample.attributes_json)
        if isinstance(attributes, dict):
            return attributes.get("source_device_name")
        return None

    @classmethod
    def _source_device_name_from_event(cls, event: WearableEventDB) -> Optional[str]:
        details = cls._safe_json_loads(event.details_json)
        if isinstance(details, dict):
            return details.get("source_device_name")
        return None

    @staticmethod
    def _parse_habit_log_completed_at(log: HabitLogDB) -> str:
        if log.completed_at:
            return log.completed_at
        return f"{log.date}T00:00:00"

    @classmethod
    def _timeline_sort_key(cls, item: Dict[str, Any]) -> Tuple[str, str]:
        return (item.get("timestamp") or "", item.get("id") or "")

    @classmethod
    def _aggregate_metric_values(cls, metric_type: str, values: List[float]) -> Tuple[Optional[float], Optional[str]]:
        if not values:
            return None, None
        if metric_type in cls.MIN_METRICS:
            return min(values), "daily_min"
        if metric_type in cls.CUMULATIVE_METRICS:
            return sum(values), "daily_total"
        return (sum(values) / len(values)), "daily_average"

    @classmethod
    def _select_rows_for_daily_totals(
        cls,
        metric_type: str,
        rows: List[Any],
    ) -> List[Any]:
        if not rows:
            return []
        daily_rows = [
            row for row in rows
            if str(getattr(row, "rollup_level", "") or "").strip().lower() == "daily"
            or str(getattr(row, "aggregation_kind", "") or "").strip().lower() in {"daily", "daily_aggregate"}
        ]
        non_daily_rows = [row for row in rows if row not in daily_rows]
        if metric_type in cls.CUMULATIVE_METRICS:
            return non_daily_rows or daily_rows
        return daily_rows or non_daily_rows

    @staticmethod
    def _serialize_source(source: Optional[WearableSourceDB]) -> Optional[Dict[str, Any]]:
        if source is None:
            return None
        metadata = None
        if source.metadata_json:
            try:
                metadata = json.loads(source.metadata_json)
            except Exception:
                metadata = {"raw": source.metadata_json}
        return {
            "id": source.id,
            "provider": source.provider,
            "source_kind": source.source_kind,
            "device_name": source.device_name,
            "device_model": source.device_model,
            "device_type": source.device_type,
            "platform": source.platform,
            "priority_rank": source.priority_rank,
            "source_bundle_id": source.source_bundle_id,
            "metadata": metadata,
        }

    async def _source_map(
        self,
        session: Any,
        *,
        user_id: str,
        source_ids: Iterable[Optional[str]],
    ) -> Dict[str, WearableSourceDB]:
        ids = sorted({source_id for source_id in source_ids if source_id})
        if not ids:
            return {}
        result = await session.execute(
            select(WearableSourceDB).where(
                WearableSourceDB.user_id == user_id,
                WearableSourceDB.id.in_(ids),
            )
        )
        return {source.id: source for source in result.scalars().all()}

    @staticmethod
    def _row_source_priority(row: Any, source_map: Dict[str, WearableSourceDB]) -> Tuple[int, int]:
        source = source_map.get(getattr(row, "source_id", None))
        source_rank = source.priority_rank if source is not None else SOURCE_KIND_PRIORITY_RANKS["unknown"]
        provider_rank = PROVIDER_PRIORITY_RANKS.get(getattr(row, "provider", None), 999)
        return source_rank, provider_rank

    def _best_ranked_rows(
        self,
        rows: List[Any],
        source_map: Dict[str, WearableSourceDB],
    ) -> Tuple[List[Any], Optional[WearableSourceDB]]:
        if not rows:
            return [], None
        ranked_rows = sorted(rows, key=lambda row: self._row_source_priority(row, source_map))
        best_rank = self._row_source_priority(ranked_rows[0], source_map)
        selected = [row for row in ranked_rows if self._row_source_priority(row, source_map) == best_rank]
        selected_source = source_map.get(getattr(selected[0], "source_id", None))
        return selected, selected_source

    @classmethod
    def _select_provider_rows(
        cls,
        grouped_rows: Dict[str, List[Any]],
        preferred_provider: Optional[str],
        source_map: Optional[Dict[str, WearableSourceDB]] = None,
    ) -> Tuple[List[Any], Optional[str], Optional[Dict[str, Any]]]:
        source_map = source_map or {}
        if preferred_provider and preferred_provider in grouped_rows:
            ranked_rows = sorted(
                grouped_rows[preferred_provider],
                key=lambda row: (
                    source_map.get(getattr(row, "source_id", None)).priority_rank
                    if source_map.get(getattr(row, "source_id", None))
                    else SOURCE_KIND_PRIORITY_RANKS["unknown"],
                    PROVIDER_PRIORITY_RANKS.get(preferred_provider, 999),
                ),
            )
            if not ranked_rows:
                return [], preferred_provider, None
            best_rank = (
                source_map.get(getattr(ranked_rows[0], "source_id", None)).priority_rank
                if source_map.get(getattr(ranked_rows[0], "source_id", None))
                else SOURCE_KIND_PRIORITY_RANKS["unknown"]
            )
            selected = [
                row
                for row in ranked_rows
                if (
                    source_map.get(getattr(row, "source_id", None)).priority_rank
                    if source_map.get(getattr(row, "source_id", None))
                    else SOURCE_KIND_PRIORITY_RANKS["unknown"]
                )
                == best_rank
            ]
            selected_source = source_map.get(getattr(selected[0], "source_id", None)) if selected else None
            return selected, preferred_provider, cls._serialize_source(selected_source)
        if len(grouped_rows) == 1:
            provider = next(iter(grouped_rows.keys()))
            service = cls()
            selected, selected_source = service._best_ranked_rows(grouped_rows[provider], source_map)
            return selected, provider, service._serialize_source(selected_source)

        provider_candidates: List[Tuple[Tuple[int, int], str, List[Any], Optional[WearableSourceDB]]] = []
        service = cls()
        for provider, rows in grouped_rows.items():
            ranked_rows, selected_source = service._best_ranked_rows(rows, source_map)
            if not ranked_rows:
                continue
            rank = service._row_source_priority(ranked_rows[0], source_map)
            provider_candidates.append((rank, provider, ranked_rows, selected_source))

        if not provider_candidates:
            return [], None, None
        provider_candidates.sort(key=lambda item: item[0])
        _rank, provider, rows, selected_source = provider_candidates[0]
        return rows, provider, service._serialize_source(selected_source)

    async def _preferred_provider_by_metric(
        self,
        session: Any,
        *,
        user_id: str,
    ) -> Dict[str, str]:
        result = await session.execute(
            select(HabitDB, HabitProjectionPolicyDB)
            .join(HabitProjectionPolicyDB, HabitProjectionPolicyDB.habit_id == HabitDB.id, isouter=True)
            .where(HabitDB.user_id == user_id)
        )
        preferred_by_metric: Dict[str, str] = {}
        for habit, policy in result.all():
            projection_service = self.projection_service
            if projection_service is None:
                from .singletons import wearable_projection_service

                projection_service = wearable_projection_service
            serialized = projection_service._serialize_projection_policy(habit, policy)
            metric_type = serialized.get("canonical_metric_type")
            priority = serialized.get("projection_source_priority") or []
            if metric_type and priority and metric_type not in preferred_by_metric:
                preferred_by_metric[metric_type] = priority[0]
        return preferred_by_metric

    async def get_samples(
        self,
        *,
        user_id: str,
        provider: Optional[str] = None,
        metric_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        include_deleted: bool = False,
        limit: int = 100,
    ) -> List[WearableSampleDB]:
        async with get_db_session() as session:
            query = select(WearableSampleDB).where(WearableSampleDB.user_id == user_id)
            if provider:
                query = query.where(WearableSampleDB.provider == provider)
            if metric_type:
                query = query.where(WearableSampleDB.metric_type == metric_type)
            if start_time:
                query = query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time) >= start_time)
            if end_time:
                query = query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.end_time) <= end_time)
            if not include_deleted:
                query = query.where(WearableSampleDB.deleted_at.is_(None))
            query = query.order_by(WearableSampleDB.recorded_at.desc(), WearableSampleDB.start_time.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_events(
        self,
        *,
        user_id: str,
        provider: Optional[str] = None,
        event_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        include_deleted: bool = False,
        limit: int = 100,
    ) -> List[WearableEventDB]:
        async with get_db_session() as session:
            event_type = self._canonical_metric_type(event_type) or event_type
            query = select(WearableEventDB).where(WearableEventDB.user_id == user_id)
            if provider:
                query = query.where(WearableEventDB.provider == provider)
            if event_type:
                query = query.where(WearableEventDB.event_type == event_type)
            if start_time:
                query = query.where(WearableEventDB.start_time >= start_time)
            if end_time:
                query = query.where(WearableEventDB.end_time <= end_time)
            if not include_deleted:
                query = query.where(WearableEventDB.deleted_at.is_(None))
            query = query.order_by(WearableEventDB.start_time.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_timeline(
        self,
        *,
        user_id: str,
        providers: Optional[List[str]] = None,
        metric_types: Optional[List[str]] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        include_manual_logs: bool = True,
        include_deleted: bool = False,
        limit: int = 200,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        async with get_db_session() as session:
            query_limit = max(limit * 2, 200)
            provider_filter = [item for item in (providers or []) if item]
            metric_filter = self._normalize_metric_filter(metric_types)

            sample_query = select(WearableSampleDB).where(WearableSampleDB.user_id == user_id)
            if provider_filter:
                sample_query = sample_query.where(WearableSampleDB.provider.in_(provider_filter))
            if metric_filter:
                sample_query = sample_query.where(WearableSampleDB.metric_type.in_(metric_filter))
            if start_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time) >= start_time)
            if end_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.end_time) <= end_time)
            if not include_deleted:
                sample_query = sample_query.where(WearableSampleDB.deleted_at.is_(None))
            sample_query = sample_query.order_by(
                func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time).desc(),
                WearableSampleDB.id.desc(),
            ).limit(query_limit)
            samples = list((await session.execute(sample_query)).scalars().all())

            event_query = select(WearableEventDB).where(WearableEventDB.user_id == user_id)
            if provider_filter:
                event_query = event_query.where(WearableEventDB.provider.in_(provider_filter))
            if metric_filter:
                event_query = event_query.where(WearableEventDB.event_type.in_(metric_filter))
            if start_time:
                event_query = event_query.where(WearableEventDB.start_time >= start_time)
            if end_time:
                event_query = event_query.where(WearableEventDB.end_time <= end_time)
            if not include_deleted:
                event_query = event_query.where(WearableEventDB.deleted_at.is_(None))
            event_query = event_query.order_by(WearableEventDB.start_time.desc(), WearableEventDB.id.desc()).limit(query_limit)
            events = list((await session.execute(event_query)).scalars().all())
            source_map = await self._source_map(
                session,
                user_id=user_id,
                source_ids=[sample.source_id for sample in samples] + [event.source_id for event in events],
            )

            items: List[Dict[str, Any]] = []

            for sample in samples:
                timestamp = self._isoformat(sample.recorded_at or sample.start_time or sample.end_time)
                if not timestamp:
                    continue
                items.append(
                    {
                        "id": sample.id,
                        "kind": "wearable_sample",
                        "provider": sample.provider,
                        "metric_type": sample.metric_type,
                        "title": sample.metric_type.replace("_", " ").title(),
                        "timestamp": timestamp,
                        "start_time": self._isoformat(sample.start_time),
                        "end_time": self._isoformat(sample.end_time),
                        "attributed_date": sample.attributed_date,
                        "value": sample.value,
                        "unit": sample.unit,
                        "aggregation_kind": sample.aggregation_kind,
                        "rollup_level": sample.rollup_level,
                        "rollup_window_minutes": sample.rollup_window_minutes,
                        "source_device_name": (
                            source_map.get(sample.source_id).device_name
                            if sample.source_id and source_map.get(sample.source_id)
                            else self._source_device_name_from_sample(sample)
                        ),
                    }
                )

            for event in events:
                timestamp = self._isoformat(event.start_time)
                if not timestamp:
                    continue
                items.append(
                    {
                        "id": event.id,
                        "kind": "wearable_event",
                        "provider": event.provider,
                        "metric_type": event.event_type,
                        "event_type": event.event_type,
                        "title": event.title or event.event_type.replace("_", " ").title(),
                        "timestamp": timestamp,
                        "start_time": self._isoformat(event.start_time),
                        "end_time": self._isoformat(event.end_time),
                        "attributed_date": event.attributed_date,
                        "value": event.summary_value,
                        "unit": event.summary_unit,
                        "aggregation_kind": "interval",
                        "source_device_name": (
                            source_map.get(event.source_id).device_name
                            if event.source_id and source_map.get(event.source_id)
                            else self._source_device_name_from_event(event)
                        ),
                    }
                )

            if include_manual_logs:
                log_query = select(HabitLogDB).join(HabitDB, HabitDB.id == HabitLogDB.habit_id).where(
                    HabitDB.user_id == user_id,
                    HabitLogDB.origin_record_kind.is_(None),
                )
                if start_time:
                    log_query = log_query.where(HabitLogDB.date >= start_time.strftime("%Y-%m-%d"))
                if end_time:
                    log_query = log_query.where(HabitLogDB.date <= end_time.strftime("%Y-%m-%d"))
                if metric_filter:
                    log_query = log_query.where(HabitDB.metric_type.in_(metric_filter))
                log_query = log_query.order_by(HabitLogDB.completed_at.desc(), HabitLogDB.id.desc()).limit(query_limit)
                logs = list((await session.execute(log_query)).scalars().all())
                for log in logs:
                    items.append(
                        {
                            "id": log.id,
                            "kind": "habit_log",
                            "habit_id": log.habit_id,
                            "habit_name": log.habit_name,
                            "title": log.habit_name,
                            "timestamp": self._parse_habit_log_completed_at(log),
                            "start_time": log.completed_at,
                            "end_time": log.completed_at,
                            "attributed_date": log.date,
                            "value": log.amount,
                            "unit": None,
                            "status": log.status,
                            "notes": log.notes,
                        }
                    )

            items.sort(key=self._timeline_sort_key, reverse=True)
            next_cursor = None
            if len(items) > limit:
                trailing_item = items[limit]
                next_cursor = f"{trailing_item['timestamp']}|{trailing_item['id']}"
            return items[:limit], next_cursor

    async def get_series(
        self,
        *,
        user_id: str,
        metric_type: str,
        provider: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        resolution: str = "raw",
        limit: int = 2000,
    ) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            metric_type = self._canonical_metric_type(metric_type) or metric_type
            preferred_provider_by_metric = await self._preferred_provider_by_metric(session, user_id=user_id)
            selected_provider = provider or preferred_provider_by_metric.get(metric_type)

            if resolution == "daily":
                totals = await self.get_daily_totals(
                    user_id=user_id,
                    metric_types=[metric_type],
                    providers=[selected_provider] if selected_provider else None,
                    start_date=(start_time or datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d"),
                    end_date=(end_time or datetime.now(timezone.utc)).strftime("%Y-%m-%d"),
                )
                points: List[Dict[str, Any]] = []
                for item in totals:
                    metric_payload = item["metrics"].get(metric_type)
                    if not metric_payload:
                        continue
                    points.append(
                        {
                            "timestamp": item["date"],
                            "start_time": item["date"],
                            "end_time": item["date"],
                            "value": metric_payload["value"],
                            "unit": metric_payload.get("unit"),
                            "provider": metric_payload.get("provider"),
                            "metric_type": metric_type,
                            "aggregation_kind": metric_payload.get("aggregation"),
                            "rollup_level": "daily",
                            "rollup_window_minutes": 1440,
                            "attributed_date": item["date"],
                            "source_device_name": None,
                            "selected_source": metric_payload.get("selected_source"),
                        }
                    )
                return points

            sample_query = select(WearableSampleDB).where(
                WearableSampleDB.user_id == user_id,
                WearableSampleDB.metric_type == metric_type,
            )
            if selected_provider:
                sample_query = sample_query.where(WearableSampleDB.provider == selected_provider)
            if start_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time) >= start_time)
            if end_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.end_time) <= end_time)
            sample_query = sample_query.where(WearableSampleDB.deleted_at.is_(None))
            resolution_candidates = {
                "raw": ["raw", "bucket_15m", "bucket_1h", "daily"],
                "15m": ["bucket_15m", "bucket_1h", "daily"],
                "1h": ["bucket_1h", "daily"],
            }.get(resolution, ["raw", "bucket_15m", "bucket_1h", "daily"])

            samples: List[WearableSampleDB] = []
            resolved_resolution = resolution
            for rollup_level in resolution_candidates:
                candidate_query = sample_query.where(WearableSampleDB.rollup_level == rollup_level)
                candidate_query = candidate_query.order_by(
                    func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time).asc(),
                    WearableSampleDB.id.asc(),
                ).limit(limit)
                candidate_rows = list((await session.execute(candidate_query)).scalars().all())
                if candidate_rows:
                    samples = candidate_rows
                    resolved_resolution = rollup_level if rollup_level != "raw" else "raw"
                    break

            if samples:
                source_map = await self._source_map(
                    session,
                    user_id=user_id,
                    source_ids=[sample.source_id for sample in samples],
                )
                grouped_by_provider: Dict[str, List[WearableSampleDB]] = {}
                for sample in samples:
                    grouped_by_provider.setdefault(sample.provider, []).append(sample)
                selected_rows, selected_provider, selected_source = self._select_provider_rows(
                    grouped_by_provider,
                    selected_provider,
                    source_map,
                )
                return [
                    {
                        "timestamp": self._isoformat(sample.recorded_at or sample.start_time or sample.end_time),
                        "start_time": self._isoformat(sample.start_time),
                        "end_time": self._isoformat(sample.end_time),
                        "value": sample.value,
                        "unit": sample.unit,
                        "provider": selected_provider or sample.provider,
                        "metric_type": sample.metric_type,
                        "aggregation_kind": sample.aggregation_kind,
                        "rollup_level": sample.rollup_level,
                        "rollup_window_minutes": sample.rollup_window_minutes,
                        "attributed_date": sample.attributed_date,
                        "source_device_name": (
                            source_map.get(sample.source_id).device_name
                            if sample.source_id and source_map.get(sample.source_id)
                            else self._source_device_name_from_sample(sample)
                        ),
                        "selected_source": selected_source,
                    }
                    for sample in selected_rows
                    if sample.recorded_at or sample.start_time or sample.end_time
                ]

            event_query = select(WearableEventDB).where(
                WearableEventDB.user_id == user_id,
                WearableEventDB.event_type == metric_type,
                WearableEventDB.deleted_at.is_(None),
            )
            if selected_provider:
                event_query = event_query.where(WearableEventDB.provider == selected_provider)
            if start_time:
                event_query = event_query.where(WearableEventDB.start_time >= start_time)
            if end_time:
                event_query = event_query.where(WearableEventDB.end_time <= end_time)
            event_query = event_query.order_by(WearableEventDB.start_time.asc(), WearableEventDB.id.asc()).limit(limit)
            events = list((await session.execute(event_query)).scalars().all())
            source_map = await self._source_map(
                session,
                user_id=user_id,
                source_ids=[event.source_id for event in events],
            )
            grouped_by_provider: Dict[str, List[WearableEventDB]] = {}
            for event in events:
                grouped_by_provider.setdefault(event.provider, []).append(event)
            selected_rows, selected_provider, selected_source = self._select_provider_rows(
                grouped_by_provider,
                selected_provider,
                source_map,
            )
            return [
                {
                    "timestamp": self._isoformat(event.start_time),
                    "start_time": self._isoformat(event.start_time),
                    "end_time": self._isoformat(event.end_time),
                    "value": float(event.summary_value or 0.0),
                    "unit": event.summary_unit,
                    "provider": selected_provider or event.provider,
                    "metric_type": event.event_type,
                    "aggregation_kind": "interval",
                    "rollup_level": "raw",
                    "rollup_window_minutes": None,
                    "attributed_date": event.attributed_date,
                    "source_device_name": (
                        source_map.get(event.source_id).device_name
                        if event.source_id and source_map.get(event.source_id)
                        else self._source_device_name_from_event(event)
                    ),
                    "selected_source": selected_source,
                }
                for event in selected_rows
            ]

    @staticmethod
    def _choose_preferred_provider_rows(
        rows_by_provider: Dict[str, List[Any]],
        preferred_provider: Optional[str],
    ) -> Tuple[List[Any], Optional[str]]:
        if not rows_by_provider:
            return [], None
        if preferred_provider and preferred_provider in rows_by_provider:
            return rows_by_provider[preferred_provider], preferred_provider
        provider = sorted(rows_by_provider.keys())[0]
        return rows_by_provider[provider], provider

    @staticmethod
    def _row_value(row: Any, key: str, default: Any = None) -> Any:
        mapping = getattr(row, "_mapping", None)
        if mapping is not None and key in mapping:
            return mapping[key]
        return getattr(row, key, default)

    @classmethod
    def _aggregate_preaggregated_rows(
        cls,
        metric_type: str,
        rows: List[Any],
    ) -> Tuple[Optional[float], Optional[str], Optional[str]]:
        if not rows:
            return None, None, None

        daily_rows = [
            row for row in rows
            if str(cls._row_value(row, "rollup_level", "") or "").strip().lower() == "daily"
            or str(cls._row_value(row, "aggregation_kind", "") or "").strip().lower() in {"daily", "daily_aggregate"}
        ]
        non_daily_rows = [row for row in rows if row not in daily_rows]
        selected_rows = (non_daily_rows or daily_rows) if metric_type in cls.CUMULATIVE_METRICS else (daily_rows or non_daily_rows)
        if not selected_rows:
            return None, None, None

        unit = next((cls._row_value(row, "unit", None) for row in selected_rows if cls._row_value(row, "unit", None)), None)
        if metric_type in cls.MIN_METRICS:
            values = [float(cls._row_value(row, "min_value", 0.0) or 0.0) for row in selected_rows]
            return (min(values), "daily_min", unit) if values else (None, None, unit)
        if metric_type in cls.CUMULATIVE_METRICS:
            return (
                sum(float(cls._row_value(row, "sum_value", 0.0) or 0.0) for row in selected_rows),
                "daily_total",
                unit,
            )

        weighted_sum = 0.0
        weight = 0
        for row in selected_rows:
            count = int(cls._row_value(row, "value_count", 0) or 0)
            if count <= 0:
                continue
            weighted_sum += float(cls._row_value(row, "avg_value", 0.0) or 0.0) * count
            weight += count
        if weight <= 0:
            return None, None, unit
        return weighted_sum / weight, "daily_average", unit

    async def _get_daily_totals_aggregated(
        self,
        *,
        user_id: str,
        metric_types: Optional[List[str]] = None,
        providers: Optional[List[str]] = None,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            preferred_provider_by_metric = await self._preferred_provider_by_metric(session, user_id=user_id)
            provider_filter = [item for item in (providers or []) if item]
            metric_filter = self._normalize_metric_filter(metric_types)

            sample_query = (
                select(
                    WearableSampleDB.attributed_date.label("date_value"),
                    WearableSampleDB.metric_type.label("metric_type"),
                    WearableSampleDB.provider.label("provider"),
                    WearableSampleDB.unit.label("unit"),
                    WearableSampleDB.rollup_level.label("rollup_level"),
                    WearableSampleDB.aggregation_kind.label("aggregation_kind"),
                    func.sum(WearableSampleDB.value).label("sum_value"),
                    func.avg(WearableSampleDB.value).label("avg_value"),
                    func.min(WearableSampleDB.value).label("min_value"),
                    func.count(WearableSampleDB.id).label("value_count"),
                )
                .where(
                    WearableSampleDB.user_id == user_id,
                    WearableSampleDB.deleted_at.is_(None),
                    WearableSampleDB.attributed_date.is_not(None),
                    WearableSampleDB.attributed_date >= start_date,
                    WearableSampleDB.attributed_date <= end_date,
                )
                .group_by(
                    WearableSampleDB.attributed_date,
                    WearableSampleDB.metric_type,
                    WearableSampleDB.provider,
                    WearableSampleDB.unit,
                    WearableSampleDB.rollup_level,
                    WearableSampleDB.aggregation_kind,
                )
            )
            if provider_filter:
                sample_query = sample_query.where(WearableSampleDB.provider.in_(provider_filter))
            if metric_filter:
                sample_query = sample_query.where(WearableSampleDB.metric_type.in_(metric_filter))
            sample_rows = list((await session.execute(sample_query)).all())

            event_query = (
                select(
                    WearableEventDB.attributed_date.label("date_value"),
                    WearableEventDB.event_type.label("metric_type"),
                    WearableEventDB.provider.label("provider"),
                    WearableEventDB.summary_unit.label("unit"),
                    func.sum(WearableEventDB.summary_value).label("sum_value"),
                    func.avg(WearableEventDB.summary_value).label("avg_value"),
                    func.min(WearableEventDB.summary_value).label("min_value"),
                    func.count(WearableEventDB.id).label("value_count"),
                )
                .where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.deleted_at.is_(None),
                    WearableEventDB.attributed_date.is_not(None),
                    WearableEventDB.summary_value.is_not(None),
                    WearableEventDB.attributed_date >= start_date,
                    WearableEventDB.attributed_date <= end_date,
                )
                .group_by(
                    WearableEventDB.attributed_date,
                    WearableEventDB.event_type,
                    WearableEventDB.provider,
                    WearableEventDB.summary_unit,
                )
            )
            if provider_filter:
                event_query = event_query.where(WearableEventDB.provider.in_(provider_filter))
            if metric_filter:
                event_query = event_query.where(WearableEventDB.event_type.in_(metric_filter))
            event_rows = list((await session.execute(event_query)).all())

        grouped_samples: Dict[Tuple[str, str, str], List[Any]] = {}
        for row in sample_rows:
            grouped_samples.setdefault((row.date_value or "", row.metric_type, row.provider), []).append(row)

        grouped_events: Dict[Tuple[str, str, str], List[Any]] = {}
        for row in event_rows:
            grouped_events.setdefault((row.date_value or "", row.metric_type, row.provider), []).append(row)

        metric_keys = set((date_value, metric_type) for date_value, metric_type, _provider in grouped_samples.keys())
        metric_keys.update((date_value, metric_type) for date_value, metric_type, _provider in grouped_events.keys())

        per_day: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for date_value, metric_type in sorted(metric_keys):
            if not date_value:
                continue
            providers_for_samples = {
                provider_name: rows
                for (sample_date, sample_metric, provider_name), rows in grouped_samples.items()
                if sample_date == date_value and sample_metric == metric_type
            }
            providers_for_events = {
                provider_name: rows
                for (event_date, event_metric, provider_name), rows in grouped_events.items()
                if event_date == date_value and event_metric == metric_type
            }

            preferred_provider = preferred_provider_by_metric.get(metric_type)
            if provider_filter and len(provider_filter) == 1:
                preferred_provider = provider_filter[0]

            selected_sample_rows, selected_sample_provider = self._choose_preferred_provider_rows(
                providers_for_samples,
                preferred_provider,
            )
            selected_event_rows, selected_event_provider = self._choose_preferred_provider_rows(
                providers_for_events,
                preferred_provider,
            )

            value, aggregation_label, unit = self._aggregate_preaggregated_rows(metric_type, selected_sample_rows)
            provider_name = selected_sample_provider
            if value is None:
                value, aggregation_label, unit = self._aggregate_preaggregated_rows(metric_type, selected_event_rows)
                provider_name = selected_event_provider
            if value is None:
                continue

            per_day.setdefault(date_value, {})[metric_type] = {
                "value": value,
                "unit": unit,
                "aggregation": aggregation_label,
                "provider": provider_name,
                "selected_source": None,
            }

        return [
            {"date": date_value, "metrics": metrics}
            for date_value, metrics in sorted(per_day.items(), key=lambda item: item[0])
        ]

    async def get_daily_totals(
        self,
        *,
        user_id: str,
        metric_types: Optional[List[str]] = None,
        providers: Optional[List[str]] = None,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        range_days = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days + 1
        if range_days > WEARABLE_DAILY_TOTALS_OBJECT_LOAD_MAX_DAYS:
            return await self._get_daily_totals_aggregated(
                user_id=user_id,
                metric_types=metric_types,
                providers=providers,
                start_date=start_date,
                end_date=end_date,
            )

        async with get_db_session() as session:
            preferred_provider_by_metric = await self._preferred_provider_by_metric(session, user_id=user_id)
            provider_filter = [item for item in (providers or []) if item]
            metric_filter = self._normalize_metric_filter(metric_types)

            sample_query = select(WearableSampleDB).where(
                WearableSampleDB.user_id == user_id,
                WearableSampleDB.deleted_at.is_(None),
                WearableSampleDB.attributed_date.is_not(None),
                WearableSampleDB.attributed_date >= start_date,
                WearableSampleDB.attributed_date <= end_date,
            )
            if provider_filter:
                sample_query = sample_query.where(WearableSampleDB.provider.in_(provider_filter))
            if metric_filter:
                sample_query = sample_query.where(WearableSampleDB.metric_type.in_(metric_filter))
            samples = list((await session.execute(sample_query)).scalars().all())

            event_query = select(WearableEventDB).where(
                WearableEventDB.user_id == user_id,
                WearableEventDB.deleted_at.is_(None),
                WearableEventDB.attributed_date.is_not(None),
                WearableEventDB.attributed_date >= start_date,
                WearableEventDB.attributed_date <= end_date,
            )
            if provider_filter:
                event_query = event_query.where(WearableEventDB.provider.in_(provider_filter))
            if metric_filter:
                event_query = event_query.where(WearableEventDB.event_type.in_(metric_filter))
            events = list((await session.execute(event_query)).scalars().all())
            source_map = await self._source_map(
                session,
                user_id=user_id,
                source_ids=[sample.source_id for sample in samples] + [event.source_id for event in events],
            )

            grouped_samples: Dict[Tuple[str, str, str], List[WearableSampleDB]] = {}
            for sample in samples:
                key = (sample.attributed_date or "", sample.metric_type, sample.provider)
                grouped_samples.setdefault(key, []).append(sample)

            grouped_events: Dict[Tuple[str, str, str], List[WearableEventDB]] = {}
            for event in events:
                key = (event.attributed_date or "", event.event_type, event.provider)
                grouped_events.setdefault(key, []).append(event)

            metric_keys = set((date_value, metric_type) for date_value, metric_type, _provider in grouped_samples.keys())
            metric_keys.update((date_value, metric_type) for date_value, metric_type, _provider in grouped_events.keys())

            per_day: Dict[str, Dict[str, Dict[str, Any]]] = {}

            for date_value, metric_type in sorted(metric_keys):
                providers_for_samples: Dict[str, List[WearableSampleDB]] = {
                    provider_name: rows
                    for (sample_date, sample_metric, provider_name), rows in grouped_samples.items()
                    if sample_date == date_value and sample_metric == metric_type
                }
                providers_for_events: Dict[str, List[WearableEventDB]] = {
                    provider_name: rows
                    for (event_date, event_metric, provider_name), rows in grouped_events.items()
                    if event_date == date_value and event_metric == metric_type
                }

                preferred_provider = preferred_provider_by_metric.get(metric_type)
                if provider_filter and len(provider_filter) == 1:
                    preferred_provider = provider_filter[0]

                selected_sample_rows, selected_sample_provider, selected_sample_source = self._select_provider_rows(
                    providers_for_samples,
                    preferred_provider,
                    source_map,
                )
                selected_event_rows, selected_event_provider, selected_event_source = self._select_provider_rows(
                    providers_for_events,
                    preferred_provider,
                    source_map,
                )

                chosen_values: List[float] = []
                unit: Optional[str] = None
                provider_name: Optional[str] = None

                preferred_sample_rows = self._select_rows_for_daily_totals(metric_type, selected_sample_rows)

                if preferred_sample_rows:
                    chosen_values = [float(row.value) for row in preferred_sample_rows]
                    unit = preferred_sample_rows[0].unit
                    provider_name = selected_sample_provider
                elif selected_event_rows:
                    chosen_values = [float(row.summary_value or 0.0) for row in selected_event_rows if row.summary_value is not None]
                    unit = selected_event_rows[0].summary_unit
                    provider_name = selected_event_provider

                aggregated_value, aggregation_label = self._aggregate_metric_values(metric_type, chosen_values)
                if aggregated_value is None:
                    continue

                per_day.setdefault(date_value, {})[metric_type] = {
                    "value": aggregated_value,
                    "unit": unit,
                    "aggregation": aggregation_label,
                    "provider": provider_name,
                    "selected_source": selected_sample_source or selected_event_source,
                }

            return [
                {"date": date_value, "metrics": metrics}
                for date_value, metrics in sorted(per_day.items(), key=lambda item: item[0])
            ]

    async def get_sync_runs(self, *, user_id: str, provider: Optional[str] = None, limit: int = 50) -> List[WearableSyncRunDB]:
        async with get_db_session() as session:
            query = (
                select(WearableSyncRunDB)
                .join(WearableConnectionDB, WearableConnectionDB.id == WearableSyncRunDB.connection_id, isouter=True)
                .where(
                    (WearableConnectionDB.user_id == user_id)
                    | ((WearableConnectionDB.id.is_(None)) & (WearableSyncRunDB.provider == "apple_health"))
                )
            )
            if provider:
                query = query.where(WearableSyncRunDB.provider == provider)
            query = query.order_by(WearableSyncRunDB.started_at.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())
