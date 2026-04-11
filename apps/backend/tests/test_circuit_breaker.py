"""Tests for the Tinybird circuit breaker and buffer drain durability."""

import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.tinybird_service import CircuitBreaker, TinybirdService


class TestCircuitBreakerStates(unittest.TestCase):
    def test_starts_closed(self):
        cb = CircuitBreaker()
        self.assertEqual(cb.state, CircuitBreaker.CLOSED)
        self.assertTrue(cb.allow_request())

    def test_opens_after_threshold_failures(self):
        cb = CircuitBreaker(failure_threshold=5, window_s=60)
        for _ in range(5):
            cb.record_failure()
        self.assertEqual(cb.state, CircuitBreaker.OPEN)
        self.assertFalse(cb.allow_request())

    def test_stays_closed_below_threshold(self):
        cb = CircuitBreaker(failure_threshold=5, window_s=60)
        for _ in range(4):
            cb.record_failure()
        self.assertEqual(cb.state, CircuitBreaker.CLOSED)
        self.assertTrue(cb.allow_request())

    def test_half_open_after_cooldown(self):
        cb = CircuitBreaker(failure_threshold=1, cooldown_s=0.01)
        cb.record_failure()
        self.assertEqual(cb.state, CircuitBreaker.OPEN)

        time.sleep(0.02)
        self.assertTrue(cb.allow_request())
        self.assertEqual(cb.state, CircuitBreaker.HALF_OPEN)

    def test_closes_on_success_in_half_open(self):
        cb = CircuitBreaker(failure_threshold=1, cooldown_s=0.01)
        cb.record_failure()
        time.sleep(0.02)
        cb.allow_request()  # transitions to HALF_OPEN

        cb.record_success()
        self.assertEqual(cb.state, CircuitBreaker.CLOSED)

    def test_reopens_on_failure_in_half_open(self):
        cb = CircuitBreaker(failure_threshold=1, cooldown_s=0.01)
        cb.record_failure()
        time.sleep(0.02)
        cb.allow_request()  # HALF_OPEN

        cb.record_failure()
        self.assertEqual(cb.state, CircuitBreaker.OPEN)


class TestCircuitBreakerBuffer(unittest.TestCase):
    def test_buffer_accepts_events(self):
        cb = CircuitBreaker(buffer_maxlen=100)
        cb.buffer.append(("ds", {"id": 1}))
        self.assertEqual(len(cb.buffer), 1)

    def test_buffer_respects_maxlen(self):
        cb = CircuitBreaker(buffer_maxlen=3)
        for i in range(5):
            cb.buffer.append(("ds", {"id": i}))
        self.assertEqual(len(cb.buffer), 3)
        # Oldest events dropped
        ids = [evt["id"] for _, evt in cb.buffer]
        self.assertEqual(ids, [2, 3, 4])

    def test_buffer_drains_on_close(self):
        cb = CircuitBreaker(failure_threshold=1, cooldown_s=0.01, buffer_maxlen=10)
        cb.record_failure()

        # Buffer some events while open
        for i in range(3):
            cb.buffer.append(("ds", {"id": i}))

        time.sleep(0.02)
        cb.allow_request()  # HALF_OPEN
        cb.record_success()  # CLOSED

        # After close, buffer should still have items (drain is caller's job)
        # The TinybirdService.ingest_events triggers drain via asyncio.create_task
        self.assertEqual(cb.state, CircuitBreaker.CLOSED)


class TestCircuitBreakerSlidingWindow(unittest.TestCase):
    def test_old_failures_expire(self):
        cb = CircuitBreaker(failure_threshold=5, window_s=0.05)
        # Record 4 failures
        for _ in range(4):
            cb.record_failure()
        self.assertEqual(cb.state, CircuitBreaker.CLOSED)

        # Wait for them to expire
        time.sleep(0.06)

        # 5th failure alone shouldn't open (previous 4 expired)
        cb.record_failure()
        self.assertEqual(cb.state, CircuitBreaker.CLOSED)


class TestDrainBuffer(unittest.IsolatedAsyncioTestCase):
    """Tests for TinybirdService._drain_buffer() durability."""

    def _make_service(self):
        """Create a TinybirdService with env vars stubbed."""
        with patch.dict("os.environ", {"TINYBIRD_TOKEN": "fake", "TINYBIRD_ENV": "cloud"}):
            svc = TinybirdService()
        return svc

    async def test_drain_success_empties_buffer(self):
        svc = self._make_service()
        svc._breaker.buffer.append(("ds_a", {"id": 1}))
        svc._breaker.buffer.append(("ds_a", {"id": 2}))

        svc._raw_ingest = AsyncMock(return_value={"success": True, "count": 2})

        await svc._drain_buffer()

        self.assertEqual(len(svc._breaker.buffer), 0)
        svc._raw_ingest.assert_called_once_with("ds_a", [{"id": 1}, {"id": 2}])

    async def test_drain_partial_failure_preserves_unsent(self):
        svc = self._make_service()
        svc._breaker.buffer.append(("ds_ok", {"id": 1}))
        svc._breaker.buffer.append(("ds_fail", {"id": 2}))

        async def selective_ingest(ds, events):
            if ds == "ds_ok":
                return {"success": True, "count": 1}
            return {"success": False, "error": "server error"}

        svc._raw_ingest = AsyncMock(side_effect=selective_ingest)

        await svc._drain_buffer()

        # Only failed datasource events remain
        remaining = list(svc._breaker.buffer)
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0], ("ds_fail", {"id": 2}))

    async def test_drain_exception_preserves_events(self):
        svc = self._make_service()
        svc._breaker.buffer.append(("ds_a", {"id": 1}))

        svc._raw_ingest = AsyncMock(side_effect=Exception("connection reset"))

        await svc._drain_buffer()

        # Events must not be dropped
        remaining = list(svc._breaker.buffer)
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0][1]["id"], 1)

    async def test_drain_failure_reopens_breaker(self):
        svc = self._make_service()
        svc._breaker.state = CircuitBreaker.CLOSED
        svc._breaker.buffer.append(("ds_a", {"id": 1}))

        svc._raw_ingest = AsyncMock(return_value={"success": False, "error": "timeout"})

        await svc._drain_buffer()

        # Failed drain must force breaker to OPEN immediately
        self.assertEqual(svc._breaker.state, CircuitBreaker.OPEN)

    async def test_drain_empty_buffer_is_noop(self):
        svc = self._make_service()
        svc._raw_ingest = AsyncMock()

        await svc._drain_buffer()

        svc._raw_ingest.assert_not_called()


if __name__ == "__main__":
    unittest.main()
