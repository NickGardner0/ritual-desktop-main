"""Internal SMS copilot debug/evaluation endpoints."""

from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query

from schemas.sms_copilot import (
    SmsCopilotEvaluateRequest,
    SmsLogConfirmationRequest,
)

logger = logging.getLogger(__name__)


def create_sms_copilot_router() -> APIRouter:
    router = APIRouter(tags=["sms-copilot"])

    def _dump_model(model):
        if hasattr(model, "model_dump"):
            return model.model_dump()
        return model.dict()

    def _require_internal_key(internal_key: Optional[str]) -> None:
        expected = os.getenv("INTERNAL_API_KEY")
        if not expected:
            raise HTTPException(status_code=503, detail="INTERNAL_API_KEY not configured")
        if internal_key != expected:
            raise HTTPException(status_code=403, detail="Invalid internal API key")

    @router.post("/api/internal/sms-copilot/evaluate")
    async def evaluate_sms_copilot(
        body: SmsCopilotEvaluateRequest,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)

        from services.sms_copilot_dispatch_service import sms_copilot_dispatch_service
        from services.sms_copilot_signal_service import sms_copilot_signal_service

        candidates = await sms_copilot_signal_service.evaluate_user(
            user_id=body.user_id,
            now_utc=body.now_utc,
            kinds=body.kinds or None,
            dry_run=body.dry_run,
        )
        dispatched = []
        if not body.dry_run:
            for candidate in candidates:
                dispatched.append(await sms_copilot_dispatch_service.dispatch_candidate(candidate))

        return {
            "success": True,
            "candidates": [
                {
                    "kind": candidate.kind,
                    "score": candidate.score,
                    "confidence": candidate.confidence,
                    "novelty_score": candidate.novelty_score,
                    "actionability_score": candidate.actionability_score,
                    "dedupe_key": candidate.dedupe_key,
                    "payload": candidate.payload,
                }
                for candidate in candidates
            ],
            "dispatched": [_dump_model(event) for event in dispatched],
        }

    @router.get("/api/internal/sms-copilot/events")
    async def get_sms_copilot_events(
        user_id: str,
        limit: int = Query(20, ge=1, le=50),
        kind: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)

        from services.sms_copilot_dispatch_service import sms_copilot_dispatch_service

        events = await sms_copilot_dispatch_service.list_events(
            user_id=user_id,
            limit=limit,
            kind=kind,
            status=status,
        )
        return {
            "success": True,
            "events": [_dump_model(event) for event in events],
        }

    @router.post("/api/internal/sms-copilot/log-confirmation")
    async def build_sms_log_confirmation(
        body: SmsLogConfirmationRequest,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)

        from services.sms_log_enrichment_service import sms_log_enrichment_service

        confirmation = await sms_log_enrichment_service.build_confirmation(
            user_id=body.user_id,
            habit_id=body.habit_id,
            amount=body.amount,
            note=body.note,
            logged_at=body.logged_at,
        )
        return {"success": True, **confirmation}

    return router
