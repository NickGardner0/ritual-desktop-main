"""Explicit registry for scheduled/background sync processors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional


SyncProcessor = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]


@dataclass(frozen=True)
class SyncJobDefinition:
    name: str
    owner: str
    schedule: Optional[str]
    idempotency_key_template: str
    processor: SyncProcessor
    max_attempts: int = 3

    def idempotency_key(self, payload: Dict[str, Any]) -> str:
        try:
            return self.idempotency_key_template.format(**payload)
        except KeyError as exc:
            raise ValueError(f"Missing idempotency payload field: {exc.args[0]}") from exc


class SyncJobRegistry:
    def __init__(self) -> None:
        self._jobs: Dict[str, SyncJobDefinition] = {}
        self._schedules: Dict[str, str] = {}
        self._running_keys: set[str] = set()
        self._dead_letters: list[Dict[str, Any]] = []

    def register(self, definition: SyncJobDefinition) -> None:
        if definition.name in self._jobs:
            raise ValueError(f"Sync job is already registered: {definition.name}")
        if definition.schedule:
            existing = self._schedules.get(definition.schedule)
            if existing:
                raise ValueError(
                    f"Schedule {definition.schedule} is already owned by sync job {existing}"
                )
            self._schedules[definition.schedule] = definition.name
        self._jobs[definition.name] = definition

    def get(self, name: str) -> SyncJobDefinition:
        try:
            return self._jobs[name]
        except KeyError as exc:
            raise KeyError(f"Unknown sync job: {name}") from exc

    def list_jobs(self) -> list[SyncJobDefinition]:
        return list(self._jobs.values())

    async def run(self, name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        definition = self.get(name)
        key = definition.idempotency_key(payload)
        if key in self._running_keys:
            raise ValueError(f"Sync job with idempotency key is already running: {key}")

        self._running_keys.add(key)
        last_error: Optional[str] = None
        try:
            for attempt in range(1, definition.max_attempts + 1):
                try:
                    result = await definition.processor(payload)
                    return {
                        "job": definition.name,
                        "owner": definition.owner,
                        "idempotency_key": key,
                        "status": "success",
                        "attempts": attempt,
                        "result": result,
                    }
                except Exception as exc:
                    last_error = str(exc)

            dead_letter = {
                "job": definition.name,
                "owner": definition.owner,
                "idempotency_key": key,
                "payload": dict(payload),
                "error": last_error or "Unknown sync processor error",
                "attempts": definition.max_attempts,
            }
            self._dead_letters.append(dead_letter)
            return {
                "job": definition.name,
                "owner": definition.owner,
                "idempotency_key": key,
                "status": "failed",
                "attempts": definition.max_attempts,
                "error": dead_letter["error"],
                "dead_lettered": True,
            }
        finally:
            self._running_keys.discard(key)

    def list_dead_letters(self) -> list[Dict[str, Any]]:
        return [dict(item) for item in self._dead_letters]


sync_job_registry = SyncJobRegistry()
