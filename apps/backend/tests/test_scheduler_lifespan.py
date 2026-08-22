from __future__ import annotations

import asyncio
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import lifespan
from services.scheduler_service import scheduler_runtime


class SchedulerLifespanTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        scheduler_runtime.reset()

    async def test_scheduler_start_is_independent_of_startup_maintenance(self):
        app = FastAPI()
        with (
            patch.object(lifespan, "ENABLE_INTERNAL_SCHEDULER", True),
            patch.object(lifespan, "ENABLE_STARTUP_MAINTENANCE_TASK", False),
        ):
            lifespan.start_internal_scheduler_tasks(app, SimpleNamespace())
        self.assertEqual(len(app.state.scheduler_tasks), 8)
        self.assertEqual(sum(state.registered for state in scheduler_runtime.states.values()), 13)
        self.assertEqual(
            scheduler_runtime.readiness_snapshot(app.state.scheduler_tasks)["status"],
            "ready",
        )
        for task in app.state.scheduler_tasks.values():
            task.cancel()
        await asyncio.gather(*app.state.scheduler_tasks.values(), return_exceptions=True)

    async def test_disabled_scheduler_creates_no_loop(self):
        app = FastAPI()
        with patch.object(lifespan, "ENABLE_INTERNAL_SCHEDULER", False):
            lifespan.start_internal_scheduler_tasks(app, SimpleNamespace())
        self.assertEqual(app.state.scheduler_tasks, {})
        self.assertEqual(scheduler_runtime.readiness_snapshot({})["status"], "disabled")


if __name__ == "__main__":
    unittest.main()
