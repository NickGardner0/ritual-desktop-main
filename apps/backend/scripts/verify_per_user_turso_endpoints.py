#!/usr/bin/env python3
"""Verify authenticated per-user Turso backend endpoints with a real bearer token."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import httpx


def _mask_sync_config(payload: dict[str, Any]) -> dict[str, Any]:
    masked = dict(payload)
    token = str(masked.get("auth_token") or "")
    if token:
        masked["auth_token"] = f"{token[:12]}...{token[-6:]}" if len(token) > 18 else "***"
    return masked


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify /api/user/profile and /api/user/turso-sync-config")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--bearer-token", required=True, help="Real Clerk session JWT")
    args = parser.parse_args()

    headers = {"Authorization": f"Bearer {args.bearer_token}", "Content-Type": "application/json"}
    endpoints = [
        ("/api/user/profile", False),
        ("/api/user/turso-sync-config", True),
    ]

    with httpx.Client(base_url=args.base_url, headers=headers, timeout=30.0) as client:
        for path, mask in endpoints:
            response = client.get(path)
            print(f"\n=== GET {path} ===")
            print(f"status={response.status_code}")
            if response.headers.get("content-type", "").startswith("application/json"):
                payload = response.json()
                if mask and isinstance(payload, dict):
                    payload = _mask_sync_config(payload)
                print(json.dumps(payload, indent=2))
            else:
                print(response.text[:2000])
            if response.status_code >= 400:
                return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
