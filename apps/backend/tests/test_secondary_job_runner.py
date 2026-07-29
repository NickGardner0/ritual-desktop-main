"""Tests for bounded secondary fan-out job runner."""

from __future__ import annotations

import asyncio
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.secondary_job_runner import SecondaryJobRunner  # noqa: E402


class SecondaryJobRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_runner_retries_then_succeeds(self):
        runner = SecondaryJobRunner()
        attempts = {"n": 0}

        async def flaky():
            attempts["n"] += 1
            if attempts["n"] < 2:
                raise RuntimeError("transient")

        result = await runner.enqueue(
            job_class="analytics",
            name="retry-job",
            coro_factory=flaky,
            await_completion=True,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "success")
        self.assertEqual(result.attempts, 2)
        self.assertEqual(attempts["n"], 2)

    async def test_runner_dead_letters_after_max_retries(self):
        runner = SecondaryJobRunner()

        async def always_fail():
            raise RuntimeError("boom")

        result = await runner.enqueue(
            job_class="search",
            name="fail-job",
            coro_factory=always_fail,
            await_completion=True,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "failed")
        self.assertTrue(result.dead_lettered)
        letters = runner.list_dead_letters()
        self.assertEqual(len(letters), 1)
        self.assertEqual(letters[0]["job"], "fail-job")

    async def test_runner_skips_inflight_dedupe(self):
        runner = SecondaryJobRunner()
        started = asyncio.Event()
        release = asyncio.Event()
        calls = {"n": 0}

        async def slow():
            calls["n"] += 1
            started.set()
            await release.wait()

        task = asyncio.create_task(
            runner.enqueue(
                job_class="analytics",
                name="slow-job",
                dedupe_key="same-key",
                coro_factory=slow,
                await_completion=True,
            )
        )
        await started.wait()
        skipped = await runner.enqueue(
            job_class="analytics",
            name="slow-job-2",
            dedupe_key="same-key",
            coro_factory=slow,
            await_completion=True,
        )
        self.assertIsNotNone(skipped)
        self.assertEqual(skipped.status, "skipped_inflight")
        release.set()
        first = await task
        self.assertIsNotNone(first)
        self.assertEqual(first.status, "success")
        self.assertEqual(calls["n"], 1)

    async def test_notify_drop_on_full(self):
        runner = SecondaryJobRunner()
        for _ in range(8):
            await runner._semaphores["notify"].acquire()

        async def noop():
            return None

        result = await runner.enqueue(
            job_class="notify",
            name="drop-me",
            coro_factory=noop,
            await_completion=True,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.status, "dropped")
        self.assertEqual(result.error, "dropped_on_full")

        for _ in range(8):
            runner._semaphores["notify"].release()


if __name__ == "__main__":
    unittest.main()
