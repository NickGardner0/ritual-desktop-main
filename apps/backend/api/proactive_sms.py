"""
Proactive SMS trigger endpoint.

Called by an external scheduler (Trigger.dev, Railway cron, etc.)
to sweep for users eligible for proactive messages and send them.

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

    # Import here to avoid circular imports at module load time
    from services.proactive_sms_service import run_proactive_sweep, run_hourly_proactive_sweep

    if body.trigger_type == "all":
        results = await run_hourly_proactive_sweep()
        logger.info("Hourly proactive sweep results: %s", results)
        return {
            "status": "ok",
            "mode": "all",
            "sweeps": results,
        }

    result = await run_proactive_sweep(
        trigger_type=body.trigger_type,
        target_hour=body.target_hour,
    )

    logger.info("Proactive sweep result: %s", result)

    return {
        "status": "ok",
        **result,
    }
