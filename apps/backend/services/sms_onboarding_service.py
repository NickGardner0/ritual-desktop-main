"""Desktop onboarding welcome flow for Ritual SMS Copilot."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from database.connection import get_db_session
from database.models import SmsCopilotEventDB
from services.conversation_service import conversation_service
from services.sendblue_service import get_ritual_vcard_url
from services.sms_delivery_service import send_message, send_segments_and_persist

WELCOME_TEXT = (
    "Welcome to Ritual. The desktop app helps you track computer use, connect "
    "wearables, and turn your data into useful daily insights. You can also text me "
    "here over SMS/iMessage with things like \"worked out 45 min\", \"how was my "
    "sleep this week?\", or \"what distracted me today?\" and I’ll log it, reflect "
    "it back, and surface useful patterns."
)

VCARD_PROMPT = "Save this contact so you always know it's Ritual:"


class SmsOnboardingService:
    """Send the first outbound copilot message after desktop onboarding."""

    async def send_desktop_welcome(
        self,
        *,
        user_id: str,
        phone_number: str,
        full_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        del full_name  # The welcome copy is product-owned and not personalized for now.

        conversation = await conversation_service.find_or_create_sms_conversation(user_id)
        sent_messages = await send_segments_and_persist(
            conversation_id=conversation["id"],
            to_number=phone_number,
            segments=[WELCOME_TEXT],
            tool_payload_base={"sms_copilot_kind": "welcome_onboarding"},
        )
        if not sent_messages:
            return {
                "event_id": None,
                "sent": False,
                "conversation_id": conversation["id"],
            }

        event_id = await self._persist_event(
            user_id=user_id,
            conversation_id=conversation["id"],
            assistant_message_id=sent_messages[0]["id"],
        )

        vcard_url = get_ritual_vcard_url()
        if vcard_url:
            try:
                vcard_result = await send_message(
                    phone_number,
                    VCARD_PROMPT,
                    media_url=vcard_url,
                )
                if vcard_result.ok:
                    await conversation_service.add_internal_message(
                        conversation_id=conversation["id"],
                        role="assistant",
                        content=VCARD_PROMPT,
                        tool_payload={"sms_copilot_kind": "welcome_onboarding_vcard"},
                    )
            except Exception:
                # Best-effort follow-up only.
                pass

        return {
            "event_id": event_id,
            "sent": True,
            "conversation_id": conversation["id"],
        }

    async def _persist_event(
        self,
        *,
        user_id: str,
        conversation_id: str,
        assistant_message_id: str,
    ) -> str:
        now = datetime.utcnow()
        event = SmsCopilotEventDB(
            id=str(uuid.uuid4()),
            user_id=user_id,
            conversation_id=conversation_id,
            kind="welcome_onboarding",
            status="sent",
            score=1.0,
            confidence=1.0,
            novelty_score=1.0,
            actionability_score=1.0,
            dedupe_key="welcome_onboarding",
            headline="Welcome to Ritual SMS Copilot",
            body=WELCOME_TEXT,
            metrics_json=json.dumps({"welcome": True}),
            response_options_json=json.dumps([]),
            assistant_message_id=assistant_message_id,
            sent_at=now,
            created_at=now,
            updated_at=now,
        )
        async with get_db_session() as session:
            session.add(event)
            await session.commit()
        return event.id


sms_onboarding_service = SmsOnboardingService()
