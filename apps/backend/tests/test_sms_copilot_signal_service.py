import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.sms_copilot_signal_service import SmsCopilotSignalService


class SmsCopilotSignalServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_daily_narrative_candidate_only_appears_inside_window(self):
        service = SmsCopilotSignalService()
        local_now = datetime(2026, 4, 22, 20, 30, tzinfo=timezone.utc)

        candidate = service._maybe_build_daily_narrative_candidate(
            user_id="user-1",
            local_now=local_now,
            timezone_name="UTC",
        )
        self.assertIsNotNone(candidate)
        self.assertEqual(candidate.kind, "daily_narrative")

        outside_window = service._maybe_build_daily_narrative_candidate(
            user_id="user-1",
            local_now=datetime(2026, 4, 22, 19, 30, tzinfo=timezone.utc),
            timezone_name="UTC",
        )
        self.assertIsNone(outside_window)

    async def test_distraction_spiral_candidate_respects_thresholds(self):
        service = SmsCopilotSignalService()

        with patch.object(service, "_fetch_activity_rows", AsyncMock(return_value=[])), patch.object(
            service,
            "_compute_distraction_metrics",
            return_value={
                "distracting_minutes": 47.0,
                "context_switches": 23,
                "top_domains": ["youtube.com", "x.com"],
            },
        ), patch.object(
            service,
            "_compute_distraction_baseline",
            AsyncMock(return_value={"avg_distracting_minutes": 18.0}),
        ):
            candidate = await service._maybe_build_distraction_spiral_candidate(
                user_id="user-1",
                now_utc=datetime(2026, 4, 22, 18, 0, tzinfo=timezone.utc),
                timezone_name="UTC",
            )

        self.assertIsNotNone(candidate)
        self.assertEqual(candidate.kind, "distraction_spiral")
        self.assertEqual(candidate.payload["top_domains"], ["youtube.com", "x.com"])

    async def test_distraction_spiral_candidate_skips_when_below_threshold(self):
        service = SmsCopilotSignalService()

        with patch.object(service, "_fetch_activity_rows", AsyncMock(return_value=[])), patch.object(
            service,
            "_compute_distraction_metrics",
            return_value={
                "distracting_minutes": 20.0,
                "context_switches": 23,
                "top_domains": ["youtube.com"],
            },
        ), patch.object(
            service,
            "_compute_distraction_baseline",
            AsyncMock(return_value={"avg_distracting_minutes": 18.0}),
        ):
            candidate = await service._maybe_build_distraction_spiral_candidate(
                user_id="user-1",
                now_utc=datetime(2026, 4, 22, 18, 0, tzinfo=timezone.utc),
                timezone_name="UTC",
            )

        self.assertIsNone(candidate)
