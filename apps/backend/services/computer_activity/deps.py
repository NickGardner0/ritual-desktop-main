"""Shared dependencies for computer activity modules (patch-friendly)."""

from services.turso_activity_remote import fetch_remote_activity_rows
from services.turso_user_service import turso_user_service

__all__ = ["fetch_remote_activity_rows", "turso_user_service"]
