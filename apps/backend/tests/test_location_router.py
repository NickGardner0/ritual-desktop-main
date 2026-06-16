"""Integration-style test for api.location router.

Builds an isolated FastAPI app with the router wired in and a stub
get_current_user dependency, then asserts endpoint contract behavior.
"""

import sys
import types
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch


# Stub database.connection to avoid pulling sqlite+aiolibsql in unit tests
_fake_db_module = types.ModuleType("database.connection")


@asynccontextmanager
async def _unused_db_session():
    yield None


_fake_db_module.get_db_session = _unused_db_session
_previous_connection_module = sys.modules.get("database.connection")
sys.modules["database.connection"] = _fake_db_module


from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

try:
    from api.location import create_location_router  # noqa: E402
    from services.location.ingest import IngestResult  # noqa: E402
finally:
    if _previous_connection_module is None:
        sys.modules.pop("database.connection", None)
    else:
        sys.modules["database.connection"] = _previous_connection_module


async def _fake_current_user():
    return {"id": "user-test", "email": "test@example.com"}


def _build_app():
    app = FastAPI()
    router = create_location_router(get_current_user=_fake_current_user)
    app.include_router(router)
    return app


class LocationRouterTests(unittest.TestCase):
    """Endpoint contract: shape, auth, validation, batch size."""

    def setUp(self):
        self.app = _build_app()
        self.client = TestClient(self.app)

    def test_empty_batch_returns_zero_counts(self):
        response = self.client.post(
            "/api/user/location-pings",
            json={"pings": []},
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(
            response.json(),
            {
                "accepted": 0,
                "rejected": 0,
                "duplicates": 0,
                "accepted_ids": [],
                "duplicate_ids": [],
                "rejected_ids": [],
            },
        )

    def test_valid_batch_calls_ingest(self):
        # The factory does `from services.location.ingest import ingest_location_pings`
        # at call time, so patch the module attribute, then rebuild the app
        # so the factory captures the patched version.
        with patch(
            "services.location.ingest.ingest_location_pings",
            AsyncMock(
                return_value=IngestResult(
                    accepted=2,
                    rejected=0,
                    duplicates=0,
                    accepted_ids=("e1", "e2"),
                )
            ),
        ):
            app = _build_app()
            client = TestClient(app)
            response = client.post(
                "/api/user/location-pings",
                json={
                    "pings": [
                        {
                            "lat": 40.0,
                            "lon": -74.0,
                            "source": "ios_scls",
                            "client_ts": 1_700_000_000_000,
                            "client_event_id": "e1",
                        },
                        {
                            "lat": 40.1,
                            "lon": -74.1,
                            "source": "ios_scls",
                            "client_ts": 1_700_000_001_000,
                            "client_event_id": "e2",
                        },
                    ]
                },
            )
        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertEqual(body["accepted"], 2)
        self.assertEqual(body["duplicates"], 0)
        self.assertEqual(body["rejected"], 0)
        self.assertEqual(body["accepted_ids"], ["e1", "e2"])

    def test_invalid_lat_returns_422(self):
        response = self.client.post(
            "/api/user/location-pings",
            json={
                "pings": [
                    {
                        "lat": 999.0,  # invalid
                        "lon": -74.0,
                        "source": "ios_scls",
                        "client_ts": 1_700_000_000_000,
                        "client_event_id": "e1",
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_unknown_source_returns_422(self):
        response = self.client.post(
            "/api/user/location-pings",
            json={
                "pings": [
                    {
                        "lat": 40.0,
                        "lon": -74.0,
                        "source": "bogus",
                        "client_ts": 1_700_000_000_000,
                        "client_event_id": "e1",
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_oversized_batch_returns_400(self):
        pings = [
            {
                "lat": 40.0,
                "lon": -74.0,
                "source": "ios_scls",
                "client_ts": 1_700_000_000_000 + i,
                "client_event_id": f"e{i}",
            }
            for i in range(501)
        ]
        response = self.client.post(
            "/api/user/location-pings",
            json={"pings": pings},
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
