"""
Proactive SMS trigger endpoint.

Legacy authenticated delivery surface. Internal scheduling is owned by FastAPI;
any stale external call enters the same durable occurrence fence.

Auth: requires x-internal-secret header matching INTERNAL_SMS_CHAT_SECRET.

Usage:
  - POST /api/sms/proactive/trigger  {"trigger_type": "eod_recap"}
      → runs a single trigger type at its default hour
  - POST /api/sms/proactive/trigger  {"trigger_type": "all"}
      → runs ALL trigger types, each at its default hour
      → designed to be called once per hour by a cron
"""

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

INTERNAL_SMS_CHAT_SECRET = os.getenv("INTERNAL_SMS_CHAT_SECRET", "")


class ProactiveTriggerRequest(BaseModel):
    trigger_type: str = "eod_recap"
    target_hour: Optional[int] = None  # None = use default for trigger type


router = APIRouter()


@router.post("/api/sms/proactive/trigger")
async def proactive_trigger(request: Request, body: ProactiveTriggerRequest):
    """
    Trigger a proactive SMS sweep.

    Finds all users eligible for the given trigger type at the target
    hour in their local timezone, generates content via the TS
    orchestrator, and sends via SendBlue.

    Use trigger_type="all" to run all trigger types (for hourly cron).
    """
    # Verify internal auth
    secret = request.headers.get("x-internal-secret", "")
    if not INTERNAL_SMS_CHAT_SECRET or secret != INTERNAL_SMS_CHAT_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    from background_tasks import run_proactive_sms_scheduler_job

    execution = await run_proactive_sms_scheduler_job(
        trigger_type=body.trigger_type,
        target_hour=body.target_hour,
    )
    logger.info("Proactive sweep occurrence result: %s", execution)
    if body.trigger_type == "all":
        return {
            "status": "ok",
            "occurrence_status": execution.status,
            "scheduled_for": execution.scheduled_for,
            "mode": "all",
            "sweeps": execution.result or [],
        }
    return {
        "status": "ok",
        "occurrence_status": execution.status,
        "scheduled_for": execution.scheduled_for,
        **(execution.result or {}),
    }
