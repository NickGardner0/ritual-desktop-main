"""Shared wearable post-ingest operations.

This is the first canonical post-ingest boundary for wearable providers. Provider
sync code may fetch/transform/persist canonical samples and events, but fact
rebuilds and connection success metadata should be owned here.
"""

from .common import *

from typing import Literal


WearablePostIngestStatus = Literal["success", "retryable_failed"]


@dataclass(frozen=True)
class WearablePostIngestResult:
    provider: str
    user_id: str
    affected_dates: List[str]
    status: WearablePostIngestStatus = "success"
    projected_records: int = 0
    metric_facts: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.status == "success" and self.error is None

    def __post_init__(self) -> None:
        if self.error is not None and self.status == "success":
            object.__setattr__(self, "status", "retryable_failed")

    def as_dict(self) -> Dict[str, Any]:
        return {
            "provider": self.provider,
            "user_id": self.user_id,
            "affected_dates": self.affected_dates,
            "status": self.status,
            "projected_records": self.projected_records,
            "metric_facts": self.metric_facts,
            "error": self.error,
            "success": self.success,
        }


class WearablePostIngestService:
    async def run_for_provider_dates(
        self,
        *,
        user_id: str,
        provider: str,
        affected_dates: Iterable[Optional[str]],
        projected_records: int = 0,
    ) -> WearablePostIngestResult:
        dates = sorted({str(date)[:10] for date in affected_dates if date})
        if not dates:
            return WearablePostIngestResult(
                provider=provider,
                user_id=user_id,
                affected_dates=[],
                projected_records=projected_records,
                metric_facts={"success": True, "reason": "no_affected_dates"},
            )

        try:
            from services.metric_facts_service import metric_fact_service

            metric_facts = await metric_fact_service.rebuild_facts(
                user_id=user_id,
                start_date=min(dates),
                end_date=max(dates),
                apply=True,
            )
            logger.info(
                "✅ Rebuilt wearable metric facts for provider=%s user=%s dates=%s..%s",
                provider,
                user_id,
                min(dates),
                max(dates),
            )
            return WearablePostIngestResult(
                provider=provider,
                user_id=user_id,
                affected_dates=dates,
                projected_records=projected_records,
                metric_facts=metric_facts,
            )
        except Exception as exc:
            error = str(exc)
            logger.warning(
                "⚠️ Wearable post-ingest failed for provider=%s user=%s dates=%s..%s: %s",
                provider,
                user_id,
                min(dates),
                max(dates),
                error,
            )
            return WearablePostIngestResult(
                provider=provider,
                user_id=user_id,
                affected_dates=dates,
                status="retryable_failed",
                projected_records=projected_records,
                error=error,
            )
