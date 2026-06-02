from __future__ import annotations

import asyncio

import pytest

from services.wearable_provider_service_pipeline import (
    ProviderResultTransformer,
    run_service_backed_provider_sync,
)
from services.wearable_provider_pipeline import ProviderFetchResult, SyncRequest


def test_service_backed_pipeline_counts_legacy_provider_result():
    async def run_case():
        async def sync():
            return {"data": {"sleep": 2, "recovery": 1}}

        result = await run_service_backed_provider_sync(
            provider="whoop",
            user_id="user_1",
            sync=sync,
            count_items=lambda payload: int(payload["data"]["sleep"]) + int(payload["data"]["recovery"]),
        )

        assert result.ingest.status == "success"
        assert result.ingest.items_seen == 3
        assert result.ingest.items_written == 3
        assert result.data == {"data": {"sleep": 2, "recovery": 1}}

    asyncio.run(run_case())


def test_service_backed_pipeline_can_retry_when_enabled():
    async def run_case():
        calls = 0

        async def sync():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("temporary outage")
            return {"data": {"samples": 4}}

        result = await run_service_backed_provider_sync(
            provider="oura",
            user_id="user_1",
            sync=sync,
            count_items=lambda payload: int(payload["data"]["samples"]),
            max_attempts=2,
        )

        assert result.ingest.status == "success"
        assert result.ingest.attempts == 2
        assert result.ingest.items_seen == 4
        assert result.data == {"data": {"samples": 4}}

    asyncio.run(run_case())


def test_service_backed_pipeline_defaults_to_single_attempt_for_legacy_side_effects():
    async def run_case():
        calls = 0

        async def sync():
            nonlocal calls
            calls += 1
            raise RuntimeError("provider unavailable")

        result = await run_service_backed_provider_sync(
            provider="garmin",
            user_id="user_1",
            sync=sync,
            count_items=lambda payload: 1 if payload else 0,
        )

        assert calls == 1
        assert result.ingest.status == "failed"
        assert result.ingest.error == "provider unavailable"

    asyncio.run(run_case())


def test_transformer_requires_dict_provider_results():
    transformer = ProviderResultTransformer(count_items=lambda payload: int(payload["count"]))
    batch = transformer.transform(
        SyncRequest(provider="whoop", user_id="user_1"),
        ProviderFetchResult(raw_payloads=[{"result": {"count": 7}}]),
    )

    assert batch.items_seen == 7
    assert batch.raw_payloads == [{"result": {"count": 7}}]


def test_transformer_surfaces_bad_provider_result_shape():
    transformer = ProviderResultTransformer(count_items=lambda payload: int(payload["count"]))

    with pytest.raises(KeyError):
        transformer.transform(
            SyncRequest(provider="whoop", user_id="user_1"),
            ProviderFetchResult(raw_payloads=[{"result": {"unexpected": 7}}]),
        )
