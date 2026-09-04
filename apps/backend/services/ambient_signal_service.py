"""Signal generation for in-app ambient copilot flows."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select

from database.connection import get_db_session
from database.models import ActivityEventDB, BehaviorBaselineSnapshotDB, UserDB

DISTRACTION_DOMAINS = {
    "youtube.com",
    "www.youtube.com",
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
    "reddit.com",
    "www.reddit.com",
    "instagram.com",
    "www.instagram.com",
    "news.ycombinator.com",
}


@dataclass
class CopilotCandidate:
    user_id: str
    kind: str
    score: float
    confidence: float
    novelty_score: float
    actionability_score: float
    dedupe_key: str
    payload: Dict[str, Any]


def _to_utc_ms(value: datetime) -> int:
    return int(value.astimezone(timezone.utc).timestamp() * 1000)


def _normalize_domain(domain: Optional[str]) -> str:
    normalized = (domain or "").strip().lower()
    return normalized.removeprefix("www.")


class AmbientSignalService:
    """Score users for narrow deterministic copilot interventions."""

    async def evaluate_user(
        self,
        *,
        user_id: str,
        now_utc: Optional[datetime] = None,
        kinds: Optional[Iterable[str]] = None,
        dry_run: bool = True,
    ) -> List[CopilotCandidate]:
        del dry_run  # The signal service only evaluates; dispatch owns dry-run behavior.

        now_utc = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
        kinds_set = set(kinds or ["daily_narrative", "distraction_spiral"])

        async with get_db_session() as session:
            result = await session.execute(
                select(UserDB).where(UserDB.id == user_id)
            )
            user = result.scalars().first()

        if user is None:
            return []

        timezone_name = user.timezone or "America/New_York"
        local_now = now_utc.astimezone(self._resolve_zone(timezone_name))

        candidates: List[CopilotCandidate] = []
        if "daily_narrative" in kinds_set:
            candidate = self._maybe_build_daily_narrative_candidate(
                user_id=user_id,
                local_now=local_now,
                timezone_name=timezone_name,
            )
            if candidate:
                candidates.append(candidate)

        if "distraction_spiral" in kinds_set:
            candidate = await self._maybe_build_distraction_spiral_candidate(
                user_id=user_id,
                now_utc=now_utc,
                timezone_name=timezone_name,
            )
            if candidate:
                candidates.append(candidate)

        return candidates

    def _resolve_zone(self, timezone_name: str) -> ZoneInfo:
        try:
            return ZoneInfo(timezone_name)
        except Exception:
            return ZoneInfo("America/New_York")

    def _maybe_build_daily_narrative_candidate(
        self,
        *,
        user_id: str,
        local_now: datetime,
        timezone_name: str,
    ) -> Optional[CopilotCandidate]:
        if local_now.hour != 20 or not (25 <= local_now.minute <= 35):
            return None

        anchor_date = local_now.date().isoformat()
        return CopilotCandidate(
            user_id=user_id,
            kind="daily_narrative",
            score=0.92,
            confidence=0.95,
            novelty_score=0.70,
            actionability_score=0.80,
            dedupe_key=f"daily_narrative:{anchor_date}",
            payload={
                "anchor_date": anchor_date,
                "timezone": timezone_name,
                "trigger_window_start": local_now.replace(minute=25, second=0, microsecond=0).astimezone(timezone.utc).isoformat(),
                "trigger_window_end": local_now.replace(minute=35, second=0, microsecond=0).astimezone(timezone.utc).isoformat(),
            },
        )

    async def _maybe_build_distraction_spiral_candidate(
        self,
        *,
        user_id: str,
        now_utc: datetime,
        timezone_name: str,
    ) -> Optional[CopilotCandidate]:
        window_end = now_utc
        window_start = now_utc - timedelta(hours=1)

        current_rows = await self._fetch_activity_rows(
            user_id=user_id,
            start_ms=_to_utc_ms(window_start),
            end_ms=_to_utc_ms(window_end),
        )
        current_metrics = self._compute_distraction_metrics(
            current_rows,
            start_ms=_to_utc_ms(window_start),
            end_ms=_to_utc_ms(window_end),
        )

        distracting_minutes = float(current_metrics.get("distracting_minutes") or 0.0)
        context_switches = int(current_metrics.get("context_switches") or 0)
        if distracting_minutes <= 25 or context_switches <= 12:
            return None

        baseline = await self._compute_distraction_baseline(
            user_id=user_id,
            now_utc=now_utc,
            timezone_name=timezone_name,
        )
        baseline_minutes_raw = float(baseline.get("avg_distracting_minutes") or 0.0)
        baseline_minutes = max(baseline_minutes_raw, 10.0)
        if distracting_minutes <= baseline_minutes * 1.75:
            return None

        local_now = now_utc.astimezone(self._resolve_zone(timezone_name))
        top_domains = list(current_metrics.get("top_domains") or [])[:3]
        multiplier = round(distracting_minutes / max(baseline_minutes, 1.0), 2)
        return CopilotCandidate(
            user_id=user_id,
            kind="distraction_spiral",
            score=min(0.99, 0.65 + (multiplier / 5.0)),
            confidence=0.82,
            novelty_score=0.76,
            actionability_score=0.88,
            dedupe_key=f"distraction_spiral:{local_now.date().isoformat()}:{local_now.hour:02d}",
            payload={
                "window_minutes": 60,
                "distracting_minutes": round(distracting_minutes, 1),
                "baseline_minutes": round(baseline_minutes_raw, 1),
                "effective_baseline_minutes": round(baseline_minutes, 1),
                "top_domains": top_domains,
                "context_switches": context_switches,
                "recommended_action": "start_focus_block",
                "trigger_window_start": window_start.isoformat(),
                "trigger_window_end": window_end.isoformat(),
                "multiplier": multiplier,
            },
        )

    async def _fetch_activity_rows(
        self,
        *,
        user_id: str,
        start_ms: int,
        end_ms: int,
    ) -> List[ActivityEventDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(ActivityEventDB)
                .where(
                    and_(
                        ActivityEventDB.user_id == user_id,
                        ActivityEventDB.ts_end > start_ms,
                        ActivityEventDB.ts_start < end_ms,
                        ActivityEventDB.is_afk == 0,
                    )
                )
                .order_by(ActivityEventDB.ts_start.asc())
            )
            return list(result.scalars().all())

    def _compute_distraction_metrics(
        self,
        rows: List[ActivityEventDB],
        *,
        start_ms: int,
        end_ms: int,
    ) -> Dict[str, Any]:
        distracting_ms = 0
        domain_ms: Dict[str, int] = {}
        context_switches = 0
        previous_key: Optional[str] = None

        for row in rows:
            overlap_start = max(int(row.ts_start or 0), start_ms)
            overlap_end = min(int(row.ts_end or 0), end_ms)
            overlap_ms = max(0, overlap_end - overlap_start)
            if overlap_ms <= 0:
                continue

            current_key = _normalize_domain(getattr(row, "browser_domain", None)) or str(getattr(row, "app_bundle_id", "") or "")
            if previous_key and current_key and current_key != previous_key:
                context_switches += 1
            if current_key:
                previous_key = current_key

            domain = _normalize_domain(getattr(row, "browser_domain", None))
            if domain and (
                domain in DISTRACTION_DOMAINS
                or f"www.{domain}" in DISTRACTION_DOMAINS
            ):
                distracting_ms += overlap_ms
                domain_ms[domain] = domain_ms.get(domain, 0) + overlap_ms

        ranked_domains = [
            domain
            for domain, _ in sorted(domain_ms.items(), key=lambda item: item[1], reverse=True)
        ]

        return {
            "distracting_minutes": round(distracting_ms / (1000 * 60), 1),
            "context_switches": context_switches,
            "top_domains": ranked_domains,
        }

    async def _compute_distraction_baseline(
        self,
        *,
        user_id: str,
        now_utc: datetime,
        timezone_name: str,
    ) -> Dict[str, Any]:
        zone = self._resolve_zone(timezone_name)
        local_now = now_utc.astimezone(zone)
        window_samples: List[float] = []

        for offset in range(1, 15):
            prior_end_local = local_now - timedelta(days=offset)
            prior_start_local = prior_end_local - timedelta(hours=1)
            rows = await self._fetch_activity_rows(
                user_id=user_id,
                start_ms=_to_utc_ms(prior_start_local),
                end_ms=_to_utc_ms(prior_end_local),
            )
            metrics = self._compute_distraction_metrics(
                rows,
                start_ms=_to_utc_ms(prior_start_local),
                end_ms=_to_utc_ms(prior_end_local),
            )
            window_samples.append(float(metrics.get("distracting_minutes") or 0.0))

        average = round(sum(window_samples) / len(window_samples), 2) if window_samples else 0.0
        await self._record_baseline_snapshot(
            user_id=user_id,
            metric_key="distraction_minutes_last_hour",
            lookback_days=14,
            baseline_json={
                "avg_distracting_minutes": average,
                "samples": window_samples,
                "computed_at_utc": now_utc.isoformat(),
            },
        )
        return {
            "avg_distracting_minutes": average,
            "samples": window_samples,
        }

    async def _record_baseline_snapshot(
        self,
        *,
        user_id: str,
        metric_key: str,
        lookback_days: int,
        baseline_json: Dict[str, Any],
    ) -> None:
        async with get_db_session() as session:
            snapshot = BehaviorBaselineSnapshotDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                metric_key=metric_key,
                lookback_days=lookback_days,
                baseline_json=json.dumps(baseline_json),
                computed_at=datetime.utcnow(),
            )
            session.add(snapshot)
            await session.commit()


ambient_signal_service = AmbientSignalService()
