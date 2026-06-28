from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.wearables import create_wearables_router  # noqa: E402


class _Limiter:
    def limit(self, *_args, **_kwargs):
        def decorator(fn):
            return fn

        return decorator


def _get_current_user():
    return {"id": "user_test"}


class WearablesRouterRouteTests(unittest.TestCase):
    def test_wearables_route_table_stays_publicly_stable(self):
        router = create_wearables_router(limiter=_Limiter(), get_current_user=_get_current_user)
        route_table = sorted(
            (
                ",".join(sorted(getattr(route, "methods", set()) or set())),
                getattr(route, "path", ""),
            )
            for route in router.routes
        )

        self.assertEqual(
            route_table,
            [
                ("DELETE", "/api/wearables/apple/devices/{device_id}"),
                ("GET", "/api/habits/{habit_id}/projection-policy"),
                ("GET", "/api/wearables/apple/devices"),
                ("GET", "/api/wearables/apple/devices/{device_id}/status"),
                ("GET", "/api/wearables/apple/export"),
                ("GET", "/api/wearables/apple/export_history"),
                ("GET", "/api/wearables/apple/export_schedule"),
                ("GET", "/api/wearables/apple/metric_catalog"),
                ("GET", "/api/wearables/apple/metric_preferences"),
                ("GET", "/api/wearables/apple/sync-status"),
                ("GET", "/api/wearables/apple/tracked_metrics"),
                ("GET", "/api/wearables/connections"),
                ("GET", "/api/wearables/daily-totals"),
                ("GET", "/api/wearables/events"),
                ("GET", "/api/wearables/metrics"),
                ("GET", "/api/wearables/oauth/{provider}/callback"),
                ("GET", "/api/wearables/outbox-events"),
                ("GET", "/api/wearables/outbox-events/{event_id}"),
                ("GET", "/api/wearables/providers"),
                ("GET", "/api/wearables/raw-payloads"),
                ("GET", "/api/wearables/raw-payloads/errors"),
                ("GET", "/api/wearables/samples"),
                ("GET", "/api/wearables/series"),
                ("GET", "/api/wearables/sync-jobs"),
                ("GET", "/api/wearables/sync-jobs/{job_id}"),
                ("GET", "/api/wearables/sync-runs"),
                ("GET", "/api/wearables/timeline"),
                ("POST", "/api/wearables/apple/export_history"),
                ("POST", "/api/wearables/apple/ingest"),
                ("POST", "/api/wearables/apple/ingest/v2"),
                ("POST", "/api/wearables/apple/register_device"),
                ("POST", "/api/wearables/apple/telemetry"),
                ("POST", "/api/wearables/connections/{provider}/authorize"),
                ("POST", "/api/wearables/connections/{provider}/disconnect"),
                ("POST", "/api/wearables/connections/{provider}/sync"),
                ("POST", "/api/wearables/connections/{provider}/sync-all"),
                ("POST", "/api/wearables/internal/maintenance/run"),
                ("POST", "/api/wearables/raw-payloads/{payload_id}/replay"),
                ("POST", "/api/wearables/webhooks/garmin"),
                ("POST", "/api/wearables/{provider}/backfill"),
                ("PUT", "/api/habits/{habit_id}/projection-policy"),
                ("PUT", "/api/wearables/apple/export_schedule"),
                ("PUT", "/api/wearables/apple/metric_preferences"),
                ("PUT", "/api/wearables/connections/{provider}/sync-settings"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
