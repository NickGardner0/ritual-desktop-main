from __future__ import annotations

import asyncio
from datetime import datetime

import services.whoop_api_client as whoop_api_client_module
from services.whoop_api_client import WhoopApiClient


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
