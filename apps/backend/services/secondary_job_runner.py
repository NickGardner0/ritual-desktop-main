"""Bounded in-process secondary fan-out for analytics/search/notify work.

Process-local only: jobs are lost on restart (same class of limitation as
``asyncio.create_task``). Primary HTTP writes must never depend on this runner
for correctness.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Deque, Dict, List, Literal, Optional, Set

logger = logging.getLogger(__name__)

JobClass = Literal["analytics", "search", "notify"]
CoroFactory = Callable[[], Awaitable[Any]]

_CLASS_LIMITS: Dict[JobClass, int] = {
    "analytics": 4,
    "search": 4,
    "notify": 8,
}

_CLASS_RETRIES: Dict[JobClass, int] = {
    "analytics": 3,
    "search": 3,
    "notify": 1,
}

_DEAD_LETTER_CAP = 200
_BASE_BACKOFF_SECS = 0.05


@dataclass
class SecondaryJobResult:
    name: str
    job_class: JobClass
    status: str  # success | failed | dropped | skipped_inflight
    attempts: int = 0
    error: Optional[str] = None
    dead_lettered: bool = False


class SecondaryJobRunner:
    """Semaphore-bounded fan-out with retries, dead letters, and in-flight dedupe."""

    def __init__(self) -> None:
        self._semaphores: Dict[JobClass, asyncio.Semaphore] = {
            name: asyncio.Semaphore(limit) for name, limit in _CLASS_LIMITS.items()
        }
        self._inflight: Set[str] = set()
        self._dead_letters: Deque[Dict[str, Any]] = deque(maxlen=_DEAD_LETTER_CAP)
        self._lock = asyncio.Lock()

    def list_dead_letters(self) -> List[Dict[str, Any]]:
        return list(self._dead_letters)

    def clear_dead_letters(self) -> None:
        self._dead_letters.clear()

    async def enqueue(
        self,
        *,
        job_class: JobClass,
        name: str,
        coro_factory: CoroFactory,
        dedupe_key: Optional[str] = None,
        await_completion: bool = False,
    ) -> Optional[SecondaryJobResult]:
        """Schedule a secondary job.

        By default schedules a background task and returns None immediately so
        the primary write path never blocks. Pass ``await_completion=True`` for tests.
        """
        key = dedupe_key or name

        async with self._lock:
            if key in self._inflight:
                logger.debug("Secondary job already in-flight, skipping: %s", key)
                result = SecondaryJobResult(
                    name=name,
                    job_class=job_class,
                    status="skipped_inflight",
                )
                return result if await_completion else None
            self._inflight.add(key)

        if await_completion:
            try:
                return await self._run_job(
                    job_class=job_class,
                    name=name,
                    coro_factory=coro_factory,
                    dedupe_key=key,
                )
            finally:
                async with self._lock:
                    self._inflight.discard(key)

        async def _background() -> None:
            try:
                await self._run_job(
                    job_class=job_class,
                    name=name,
                    coro_factory=coro_factory,
                    dedupe_key=key,
                )
            finally:
                async with self._lock:
                    self._inflight.discard(key)

        asyncio.create_task(_background())
        return None

    async def _try_acquire(self, semaphore: asyncio.Semaphore, *, drop_on_full: bool) -> bool:
        if not drop_on_full:
            await semaphore.acquire()
            return True
        try:
            await asyncio.wait_for(semaphore.acquire(), timeout=0)
            return True
        except asyncio.TimeoutError:
            return False

    async def _run_job(
        self,
        *,
        job_class: JobClass,
        name: str,
        coro_factory: CoroFactory,
        dedupe_key: str,
    ) -> SecondaryJobResult:
        semaphore = self._semaphores[job_class]
        max_attempts = _CLASS_RETRIES[job_class]
        drop_on_full = job_class == "notify"

        acquired = await self._try_acquire(semaphore, drop_on_full=drop_on_full)
        if not acquired:
            logger.warning("Secondary notify queue full; dropping job %s", name)
            dead = {
                "job": name,
                "job_class": job_class,
                "dedupe_key": dedupe_key,
                "error": "dropped_on_full",
                "attempts": 0,
            }
            self._dead_letters.append(dead)
            return SecondaryJobResult(
                name=name,
                job_class=job_class,
                status="dropped",
                attempts=0,
                error="dropped_on_full",
                dead_lettered=True,
            )

        last_error: Optional[str] = None
        try:
            for attempt in range(1, max_attempts + 1):
                try:
                    await coro_factory()
                    return SecondaryJobResult(
                        name=name,
                        job_class=job_class,
                        status="success",
                        attempts=attempt,
                    )
                except Exception as exc:  # noqa: BLE001
                    last_error = str(exc)
                    logger.error(
                        "Secondary job '%s' attempt %s/%s failed: %s",
                        name,
                        attempt,
                        max_attempts,
                        exc,
                    )
                    if attempt < max_attempts:
                        await asyncio.sleep(_BASE_BACKOFF_SECS * (2 ** (attempt - 1)))

            dead = {
                "job": name,
                "job_class": job_class,
                "dedupe_key": dedupe_key,
                "error": last_error or "unknown",
                "attempts": max_attempts,
            }
            self._dead_letters.append(dead)
            return SecondaryJobResult(
                name=name,
                job_class=job_class,
                status="failed",
                attempts=max_attempts,
                error=last_error,
                dead_lettered=True,
            )
        finally:
            semaphore.release()


secondary_job_runner = SecondaryJobRunner()
