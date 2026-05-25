"""Whoop API fetch client.

Keeps provider HTTP pagination and endpoint-specific fetch behavior out of the
integration service. The service still owns OAuth persistence and downstream
storage orchestration.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WhoopFetchedData:
    recovery_data: Optional[Dict[str, Any]]
    sleep_data: Dict[str, Any]
    workout_data: Optional[Dict[str, Any]]
    cycle_data: Optional[Dict[str, Any]]
    synced_data: Dict[str, int]
    any_api_success: bool


class WhoopApiClient:
    def __init__(self, *, api_base: str) -> None:
        self.api_base = api_base

    async def request_with_retry(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        **kwargs,
    ) -> httpx.Response:
        max_attempts = int(os.getenv("WHOOP_API_MAX_RETRIES", "3"))
        base_delay = float(os.getenv("WHOOP_API_RETRY_BASE_DELAY", "0.5"))
        retryable_statuses = {408, 429, 500, 502, 503, 504}

        for attempt in range(1, max_attempts + 1):
            try:
                response = await client.request(method, url, **kwargs)
                if response.status_code in retryable_statuses and attempt < max_attempts:
                    delay = base_delay * (2 ** (attempt - 1))
                    logger.info(
                        "Whoop API transient error %s on %s; retrying in %.1fs (%s/%s)",
                        response.status_code,
                        url,
                        delay,
                        attempt,
                        max_attempts,
                    )
                    await asyncio.sleep(delay)
                    continue
                return response
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt >= max_attempts:
                    raise
                delay = base_delay * (2 ** (attempt - 1))
                logger.info(
                    "Whoop API request error (%s); retrying in %.1fs (%s/%s)",
                    exc,
                    delay,
                    attempt,
                    max_attempts,
                )
                await asyncio.sleep(delay)

        raise RuntimeError(f"Whoop API request failed after {max_attempts} attempts: {url}")

    async def _fetch_paginated_v1_records(
        self,
        *,
        client: httpx.AsyncClient,
        access_token: str,
        endpoint: str,
        start_date: datetime,
        end_date: datetime,
        label: str,
        unavailable_statuses: set[int] | None = None,
    ) -> tuple[Optional[Dict[str, Any]], bool]:
        all_records: list[dict[str, Any]] = []
        next_token = None
        any_success = False
        unavailable_statuses = unavailable_statuses or set()

        while True:
            params = {
                "start": start_date.isoformat() + "Z",
                "end": end_date.isoformat() + "Z",
                "limit": 25,
            }
            if next_token:
                params["nextToken"] = next_token

            response = await self.request_with_retry(
                client=client,
                method="GET",
                url=f"{self.api_base}{endpoint}",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )

            if response.is_success:
                any_success = True
                page = response.json()
                all_records.extend(page.get("records", []))
                next_token = page.get("next_token")
                if not next_token:
                    break
                continue

            if response.status_code == 401:
                logger.error("Whoop API returned 401 (unauthorized) for %s", label)
                break

            if response.status_code in unavailable_statuses:
                logger.info(
                    "Whoop %s endpoint unavailable for this account/config (status %s); skipping.",
                    label,
                    response.status_code,
                )
                break

            logger.warning("Error fetching Whoop %s: %s", label, response.status_code)
            break

        return ({"records": all_records} if all_records else None), any_success

    async def _fetch_sleep_for_cycles(
        self,
        *,
        client: httpx.AsyncClient,
        access_token: str,
        cycle_data: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        logger.info("Fetching Whoop sleep data using v2 cycle endpoint")
        sleep_data: Dict[str, Any] = {"records": []}

        if not cycle_data or not cycle_data.get("records"):
            logger.warning("No Whoop cycles found, skipping sleep data fetch")
            return sleep_data

        for cycle in cycle_data["records"]:
            cycle_id = cycle.get("id")
            if not cycle_id:
                continue

            try:
                response = await self.request_with_retry(
                    client=client,
                    method="GET",
                    url=f"{self.api_base}/developer/v2/cycle/{cycle_id}/sleep",
                    headers={"Authorization": f"Bearer {access_token}"},
                )

                if response.is_success:
                    sleep_record = response.json()
                    if sleep_record:
                        sleep_data["records"].append(sleep_record)
                else:
                    logger.warning("No Whoop sleep data for cycle %s: %s", cycle_id, response.status_code)
            except Exception as exc:
                logger.warning("Error fetching Whoop sleep for cycle %s: %s", cycle_id, exc)

        logger.info("Fetched %s Whoop sleep records from v2 API", len(sleep_data["records"]))
        for record in sleep_data.get("records", []):
            sleep_start = record.get("start", "N/A")
            sleep_end = record.get("end", "N/A")
            sleep_date = sleep_start[:10] if sleep_start != "N/A" else "N/A"
            stage_summary = record.get("score", {}).get("stage_summary", {})
            total_ms = (
                stage_summary.get("total_rem_sleep_time_milli", 0)
                + stage_summary.get("total_slow_wave_sleep_time_milli", 0)
                + stage_summary.get("total_light_sleep_time_milli", 0)
            )
            logger.info(
                "Whoop sleep: date=%s, start=%s, end=%s, duration=%sh",
                sleep_date,
                sleep_start,
                sleep_end,
                round(total_ms / 3600000, 2),
            )

        return sleep_data

    async def fetch_enabled_data(
        self,
        *,
        access_token: str,
        start_date: datetime,
        end_date: datetime,
        enabled_metrics: Dict[str, bool],
    ) -> WhoopFetchedData:
        synced_data = {
            "recovery": 0,
            "sleep": 0,
            "workouts": 0,
            "cycles": 0,
        }
        any_api_success = False

        async with httpx.AsyncClient(timeout=20.0) as client:
            recovery_data = None
            if enabled_metrics["recovery"]:
                recovery_data, success = await self._fetch_paginated_v1_records(
                    client=client,
                    access_token=access_token,
                    endpoint="/developer/v1/recovery",
                    start_date=start_date,
                    end_date=end_date,
                    label="recovery",
                    unavailable_statuses={403, 404},
                )
                any_api_success = any_api_success or success
                if recovery_data:
                    synced_data["recovery"] = len(recovery_data.get("records", []))
                    logger.info("Synced %s Whoop recovery records", synced_data["recovery"])
            else:
                logger.info("Skipping Whoop recovery fetch: no recovery habit mapping enabled.")

            cycle_data, success = await self._fetch_paginated_v1_records(
                client=client,
                access_token=access_token,
                endpoint="/developer/v1/cycle",
                start_date=start_date,
                end_date=end_date,
                label="cycles",
            )
            any_api_success = any_api_success or success
            if cycle_data:
                synced_data["cycles"] = len(cycle_data.get("records", []))
                logger.info("Synced %s Whoop cycle records", synced_data["cycles"])

            sleep_data = await self._fetch_sleep_for_cycles(
                client=client,
                access_token=access_token,
                cycle_data=cycle_data,
            )
            synced_data["sleep"] = len(sleep_data.get("records", []))

            workout_data = None
            if enabled_metrics["workouts"]:
                workout_data, success = await self._fetch_paginated_v1_records(
                    client=client,
                    access_token=access_token,
                    endpoint="/developer/v1/activity/workout",
                    start_date=start_date,
                    end_date=end_date,
                    label="workouts",
                    unavailable_statuses={403, 404},
                )
                any_api_success = any_api_success or success
                if workout_data:
                    synced_data["workouts"] = len(workout_data.get("records", []))
                    logger.info("Synced %s Whoop workout records", synced_data["workouts"])
            else:
                logger.info("Skipping Whoop workout fetch: no workout/strain habit mapping enabled.")

        return WhoopFetchedData(
            recovery_data=recovery_data,
            sleep_data=sleep_data,
            workout_data=workout_data,
            cycle_data=cycle_data,
            synced_data=synced_data,
            any_api_success=any_api_success,
        )
