import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import services.workflow_service as workflow_service_module

workflow_service = workflow_service_module.workflow_service

REPO_ROOT = Path(__file__).resolve().parents[3]
DASHBOARD_DIR = REPO_ROOT / "apps" / "dashboard"
INTEGRATION_TOKEN = "ritual-integration-token"
INTEGRATION_USER_ID = "user-123"


def _find_free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return int(sock.getsockname()[1])


class _FakeBackendHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _record_request(self) -> tuple[str, dict[str, list[str]]]:
        parsed = urlparse(self.path)
        headers = {key.lower(): value for key, value in self.headers.items()}
        query = parse_qs(parsed.query)
        self.__class__.requests.append(
            {
                "method": self.command,
                "path": parsed.path,
                "query": query,
                "headers": headers,
            }
        )
        return parsed.path, query

    def _write_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path, query = self._record_request()

        if path == "/api/calendar/scheduled-blocks":
            return self._write_json(
                [
                    {
                        "title": "Deep Work",
                        "day": query.get("start_date", ["2026-04-29"])[0],
                        "start_minutes": 540,
                        "end_minutes": 660,
                    },
                    {
                        "title": "Workout",
                        "day": query.get("start_date", ["2026-04-29"])[0],
                        "start_minutes": 720,
                        "end_minutes": 780,
                    },
                ]
            )

        if path == "/api/analytics/streaks":
            return self._write_json(
                {
                    "success": True,
                    "streaks": [
                        {
                            "habit_name": "Walk",
                            "current_streak": 5,
                        }
                    ],
                }
            )

        if path == "/api/v1/biometrics/heart-rate/day-summary":
            day = query.get("day", ["2026-04-29"])[0]
            return self._write_json(
                {
                    "day": day,
                    "average_bpm": 58,
                    "min_bpm": 50,
                    "max_bpm": 76,
                    "total_samples": 1440,
                    "source_breakdown": [],
                }
            )

        if path == "/api/analytics/stats":
            start = query.get("start_date", ["2026-04-23"])[0]
            end = query.get("end_date", ["2026-04-29"])[0]
            return self._write_json(
                {
                    "success": True,
                    "date_range": {
                        "start": start,
                        "end": end,
                        "days": 7,
                    },
                    "habits": [
                        {
                            "id": "habit-1",
                            "name": "Sleep Duration",
                            "category": "recovery",
                            "unit": "hours",
                            "total": 56,
                            "average": 8,
                            "min": 7.5,
                            "max": 8.5,
                            "days_with_data": 7,
                            "total_entries": 7,
                        }
                    ],
                }
            )

        if path == "/api/analytics/daily-breakdown":
            return self._write_json(
                {
                    "success": True,
                    "data": [
                        {
                            "date": "2026-04-29",
                            "value": 8,
                        }
                    ],
                }
            )

        if path == "/api/watcher/stats/daily":
            return self._write_json(
                {
                    "data": [
                        {
                            "day": "2026-04-29",
                            "active_hours": 6.2,
                            "events_count": 120,
                            "apps_count": 12,
                        }
                    ]
                }
            )

        if path == "/api/watcher/stats/top-apps":
            return self._write_json(
                {
                    "data": [
                        {
                            "app_bundle_id": "com.openai.codex",
                            "app_name": "Codex",
                            "hours": 2.1,
                            "total_events": 18,
                        }
                    ]
                }
            )

        if path == "/api/watcher/stats/top-domains":
            return self._write_json(
                {
                    "data": [
                        {
                            "domain": "github.com",
                            "hours": 1.4,
                            "total_events": 9,
                        }
                    ]
                }
            )

        self._write_json({"error": f"Unhandled path: {path}"}, status=404)


class WorkflowExecutorRoundTripTests(unittest.IsolatedAsyncioTestCase):
    fake_server: ThreadingHTTPServer | None = None
    fake_server_thread: Thread | None = None
    next_process: subprocess.Popen[str] | None = None
    next_log_file: Any = None
    fake_backend_port: int | None = None
    next_port: int | None = None

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None or shutil.which("npm") is None:
            raise unittest.SkipTest("Node.js and npm are required for workflow executor round-trip tests.")
        if not ((DASHBOARD_DIR / "node_modules").exists() or (REPO_ROOT / "node_modules").exists()):
            raise unittest.SkipTest("Dashboard dependencies are not installed.")

        cls.fake_backend_port = _find_free_port()
        cls.next_port = _find_free_port()

        cls.fake_server = ThreadingHTTPServer(("127.0.0.1", cls.fake_backend_port), _FakeBackendHandler)
        cls.fake_server_thread = Thread(target=cls.fake_server.serve_forever, daemon=True)
        cls.fake_server_thread.start()

        build_env = os.environ.copy()
        build_env.setdefault("NEXT_TELEMETRY_DISABLED", "1")
        subprocess.run(
            ["npm", "run", "build:chat-runtime"],
            cwd=DASHBOARD_DIR,
            env=build_env,
            check=True,
        )

        next_env = os.environ.copy()
        next_env.update(
            {
                "INTERNAL_BACKEND_TOKEN": INTEGRATION_TOKEN,
                "PYTHON_API_URL": f"http://127.0.0.1:{cls.fake_backend_port}",
                "NEXT_PUBLIC_PYTHON_API_URL": f"http://127.0.0.1:{cls.fake_backend_port}",
                "NEXT_TELEMETRY_DISABLED": "1",
                "OPENAI_API_KEY": "",
                "RITUAL_WORKFLOW_EXECUTOR_DISABLE_OPENAI": "1",
                "PORT": str(cls.next_port),
            }
        )

        next_binary = DASHBOARD_DIR / "node_modules" / ".bin" / "next"
        if not next_binary.exists():
            next_binary = REPO_ROOT / "node_modules" / ".bin" / "next"
        if not next_binary.exists():
            raise unittest.SkipTest("Next.js binary is not available in dashboard dependencies.")

        cls.next_log_file = tempfile.NamedTemporaryFile(mode="w+", delete=False)
        cls.next_process = subprocess.Popen(
            [str(next_binary), "dev", "--webpack", "-p", str(cls.next_port)],
            cwd=DASHBOARD_DIR,
            env=next_env,
            stdout=cls.next_log_file,
            stderr=subprocess.STDOUT,
            text=True,
        )

        cls._wait_for_next_server_ready()

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.next_process is not None:
            cls.next_process.terminate()
            try:
                cls.next_process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                cls.next_process.kill()
                cls.next_process.wait(timeout=15)
        if cls.next_log_file is not None:
            log_name = cls.next_log_file.name
            cls.next_log_file.close()
            try:
                os.unlink(log_name)
            except OSError:
                pass
        if cls.fake_server is not None:
            cls.fake_server.shutdown()
            cls.fake_server.server_close()
        if cls.fake_server_thread is not None:
            cls.fake_server_thread.join(timeout=5)

    @classmethod
    def _read_next_logs(cls) -> str:
        if cls.next_log_file is None:
            return ""
        cls.next_log_file.flush()
        with open(cls.next_log_file.name, "r", encoding="utf-8") as handle:
            return handle.read()

    @classmethod
    def _wait_for_next_server_ready(cls, timeout_seconds: float = 120.0) -> None:
        assert cls.next_port is not None
        assert cls.next_process is not None
        deadline = time.time() + timeout_seconds
        url = f"http://127.0.0.1:{cls.next_port}/api/internal/workflows/execute"

        while time.time() < deadline:
            if cls.next_process.poll() is not None:
                raise RuntimeError(f"Next server exited early.\n{cls._read_next_logs()}")
            try:
                response = httpx.get(url, timeout=3.0)
                if response.status_code == 405:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(1)

        raise TimeoutError(f"Timed out waiting for Next workflow executor route.\n{cls._read_next_logs()}")

    def setUp(self) -> None:
        _FakeBackendHandler.requests = []

    async def test_backend_calls_dashboard_workflow_executor_over_http(self) -> None:
        assert self.next_port is not None
        window = workflow_service._resolve_window(
            timezone_name="America/New_York",
            reference_utc=datetime(2026, 4, 29, 14, 0, tzinfo=timezone.utc),
        )

        with patch.object(workflow_service_module, "DASHBOARD_BASE_URL", f"http://127.0.0.1:{self.next_port}"), patch.object(
            workflow_service_module,
            "INTERNAL_BACKEND_TOKEN",
            INTEGRATION_TOKEN,
        ), patch.object(workflow_service_module, "WORKFLOW_EXECUTION_TIMEOUT", 60.0):
            try:
                payload = await workflow_service._call_dashboard_executor(
                    user_id=INTEGRATION_USER_ID,
                    run_id="workflow-run-1",
                    workflow_kind="morning_brief",
                    timezone_name="America/New_York",
                    config={
                        "include_calendar": True,
                        "include_streaks": True,
                        "include_biometrics": True,
                        "include_weekly_context": True,
                    },
                    window=window,
                )
            except Exception as exc:
                raise AssertionError(f"{exc}\nNext logs:\n{self._read_next_logs()}") from exc

        self.assertEqual(payload["artifact"]["kind"], "morning_brief")
        self.assertEqual(payload["plan"]["title"], "Morning Brief")
        self.assertEqual(payload["result"]["model"], "deterministic")
        self.assertTrue(payload["artifact"]["summary"])
        self.assertEqual(payload["artifact"]["body"]["schemaVersion"], 1)
        self.assertGreaterEqual(len(payload["artifact"]["body"]["blocks"]), 3)

        paths = {entry["path"] for entry in _FakeBackendHandler.requests}
        self.assertTrue(
            {
                "/api/calendar/scheduled-blocks",
                "/api/analytics/streaks",
                "/api/v1/biometrics/heart-rate/day-summary",
                "/api/analytics/stats",
                "/api/analytics/daily-breakdown",
                "/api/watcher/stats/daily",
                "/api/watcher/stats/top-apps",
                "/api/watcher/stats/top-domains",
            }.issubset(paths)
        )

        for entry in _FakeBackendHandler.requests:
            self.assertEqual(entry["headers"].get("authorization"), f"Bearer {INTEGRATION_TOKEN}")
            self.assertEqual(entry["headers"].get("x-internal-user-id"), INTEGRATION_USER_ID)


if __name__ == "__main__":
    unittest.main()
