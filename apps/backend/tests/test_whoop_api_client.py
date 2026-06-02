from __future__ import annotations

import asyncio
from datetime import datetime

import services.whoop_api_client as whoop_api_client_module
from services.whoop_api_client import WhoopApiClient
from services.whoop_service import WhoopService


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = str(self._payload)

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._payload


class FakeHttpClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[dict] = []

    async def request(self, method: str, url: str, **kwargs):
        self.calls.append({"method": method, "url": url, "kwargs": kwargs})
        return self.responses.pop(0)


def test_request_with_retry_retries_transient_status(monkeypatch):
    async def run_case():
        sleep_calls = []

        async def fake_sleep(delay):
            sleep_calls.append(delay)

        monkeypatch.setattr(whoop_api_client_module.asyncio, "sleep", fake_sleep)
        client = WhoopApiClient(api_base="https://whoop.example")
        fake_http = FakeHttpClient([
            FakeResponse(500),
            FakeResponse(200, {"ok": True}),
        ])

        response = await client.request_with_retry(fake_http, "GET", "https://whoop.example/test")

        assert response.status_code == 200
        assert len(fake_http.calls) == 2
        assert sleep_calls == [0.5]

    asyncio.run(run_case())


def test_fetch_paginated_records_follows_next_token():
    async def run_case():
        client = WhoopApiClient(api_base="https://whoop.example")
        fake_http = FakeHttpClient([
            FakeResponse(200, {"records": [{"id": "one"}], "next_token": "cursor"}),
            FakeResponse(200, {"records": [{"id": "two"}]}),
        ])

        data, success = await client._fetch_paginated_v1_records(
            client=fake_http,
            access_token="token",
            endpoint="/developer/v1/cycle",
            start_date=datetime(2026, 5, 1),
            end_date=datetime(2026, 5, 2),
            label="cycles",
        )

        assert success is True
        assert data == {"records": [{"id": "one"}, {"id": "two"}]}
        assert fake_http.calls[1]["kwargs"]["params"]["nextToken"] == "cursor"

    asyncio.run(run_case())


def test_fetch_enabled_data_respects_metric_switches():
    async def run_case():
        client = WhoopApiClient(api_base="https://whoop.example")
        calls = []

        async def fake_paginated(**kwargs):
            calls.append(kwargs["label"])
            return {"records": [{"id": kwargs["label"]}]}, True

        async def fake_sleep_for_cycles(**kwargs):
            assert kwargs["cycle_data"] == {"records": [{"id": "cycles"}]}
            return {"records": [{"id": "sleep_1"}, {"id": "sleep_2"}]}

        client._fetch_paginated_v1_records = fake_paginated
        client._fetch_sleep_for_cycles = fake_sleep_for_cycles

        result = await client.fetch_enabled_data(
            access_token="token",
            start_date=datetime(2026, 5, 1),
            end_date=datetime(2026, 5, 2),
            enabled_metrics={"recovery": False, "sleep": True, "workouts": False},
        )

        assert calls == ["cycles"]
        assert result.any_api_success is True
        assert result.synced_data == {"recovery": 0, "sleep": 2, "workouts": 0, "cycles": 1}

    asyncio.run(run_case())


def test_sleep_debug_fields_include_score_state_and_end_date():
    fields = WhoopApiClient._sleep_debug_fields({
        "id": "sleep-1",
        "cycle_id": "cycle-1",
        "start": "2026-05-24T03:00:00.000Z",
        "end": "2026-05-25T12:00:00.000Z",
        "score_state": "SCORED",
        "nap": False,
        "score": {
            "stage_summary": {
                "total_rem_sleep_time_milli": 60 * 60 * 1000,
                "total_slow_wave_sleep_time_milli": 90 * 60 * 1000,
                "total_light_sleep_time_milli": 270 * 60 * 1000,
            },
        },
    })

    assert fields["date"] == "2026-05-25"
    assert fields["score_state"] == "SCORED"
    assert fields["duration_hours"] == 7.0


def test_latest_sleep_metadata_uses_sleep_end_date_for_overview_attribution():
    metadata = WhoopService._latest_sleep_record_metadata({
        "records": [
            {
                "id": "sleep-old",
                "cycle_id": "cycle-old",
                "start": "2026-05-23T04:00:00.000Z",
                "end": "2026-05-23T12:00:00.000Z",
                "score_state": "SCORED",
            },
            {
                "id": "sleep-new",
                "cycle_id": "cycle-new",
                "start": "2026-05-24T03:00:00.000Z",
                "end": "2026-05-25T12:00:00.000Z",
                "score_state": "SCORED",
            },
        ],
    })

    assert metadata["latest_upstream_sleep_date"] == "2026-05-25"
    assert metadata["latest_upstream_sleep_id"] == "sleep-new"
    assert metadata["latest_upstream_sleep_cycle_id"] == "cycle-new"


def test_whoop_affected_metric_fact_dates_include_sleep_end_dates():
    dates = WhoopService._affected_metric_fact_dates(
        recovery_data={"records": [{"created_at": "2026-05-23T12:00:00.000Z"}]},
        sleep_data={
            "records": [
                {
                    "id": "sleep-1",
                    "cycle_id": "cycle-1",
                    "start": "2026-05-24T03:00:00.000Z",
                    "end": "2026-05-25T12:00:00.000Z",
                }
            ],
        },
        workout_data={"records": [{"start": "2026-05-26T18:00:00.000Z"}]},
        cycle_data={"records": [{"start": "2026-05-27T00:00:00.000Z"}]},
    )

    assert dates == ["2026-05-23", "2026-05-25", "2026-05-26", "2026-05-27"]
