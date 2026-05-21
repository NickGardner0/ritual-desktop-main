"""Small Sentry helpers for request and domain context.

The helpers are no-ops when Sentry is not installed or the DSN is unset. Keep
this module dependency-light so API routers can safely import it.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

try:
    import sentry_sdk
    from sentry_sdk import logger as sentry_logger
except Exception:  # pragma: no cover - local dev may not install sentry
    sentry_sdk = None  # type: ignore[assignment]
    sentry_logger = None  # type: ignore[assignment]


SENSITIVE_QUERY_KEYS = {
    "token",
    "auth",
    "authorization",
    "code",
    "state",
    "client_secret",
    "refresh_token",
    "access_token",
}

OBSERVABILITY_QUERY_TAGS = {
    "provider",
    "sync_run_id",
    "habit_id",
    "connection_id",
    "device_id",
    "run_id",
}


def set_user_context(user: Optional[Mapping[str, Any]], *, auth_surface: str = "clerk") -> None:
    if sentry_sdk is None or not user:
        return
    user_id = str(user.get("id") or "").strip()
    if not user_id:
        return
    sentry_user: dict[str, Any] = {"id": user_id}
    email = str(user.get("email") or "").strip()
    if email:
        sentry_user["email"] = email
    sentry_sdk.set_user(sentry_user)
    sentry_sdk.set_tag("auth_surface", auth_surface)


def set_request_context(
    *,
    path: str,
    method: str,
    route_name: Optional[str] = None,
    query: Optional[Mapping[str, Any]] = None,
) -> None:
    if sentry_sdk is None:
        return

    sentry_sdk.set_tag("runtime", "backend")
    sentry_sdk.set_tag("surface", "fastapi")
    sentry_sdk.set_tag("route", route_name or path)
    sentry_sdk.set_tag("http.method", method)

    safe_query: dict[str, Any] = {}
    for key, value in (query or {}).items():
        normalized_key = str(key).strip().lower()
        if not normalized_key or normalized_key in SENSITIVE_QUERY_KEYS:
            continue
        if normalized_key in OBSERVABILITY_QUERY_TAGS and value is not None:
            sentry_sdk.set_tag(normalized_key, str(value)[:128])
        if len(safe_query) < 20:
            safe_query[normalized_key] = str(value)[:256]

    if safe_query:
        sentry_sdk.set_context("request.query", safe_query)


def set_domain_tags(**tags: Any) -> None:
    if sentry_sdk is None:
        return
    for key, value in tags.items():
        if value is None:
            continue
        sentry_sdk.set_tag(key, str(value)[:128])


def capture_smoke_message(message: str, **tags: Any) -> None:
    if sentry_sdk is None:
        return
    set_domain_tags(smoke_test="true", **tags)
    sentry_sdk.capture_message(message, level="info")


def _clean_log_attributes(attributes: Mapping[str, Any]) -> dict[str, str | int | float | bool | None]:
    clean: dict[str, str | int | float | bool | None] = {}
    for key, value in attributes.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            continue
        if value is None or isinstance(value, (bool, int, float)):
            clean[normalized_key] = value
        else:
            clean[normalized_key] = str(value)[:512]
    return clean


def capture_structured_log(level: str, message: str, **attributes: Any) -> None:
    if sentry_logger is None:
        return
    clean_attributes = _clean_log_attributes(attributes)
    normalized_level = level.strip().lower()
    log_fn = {
        "trace": getattr(sentry_logger, "trace", None),
        "debug": getattr(sentry_logger, "debug", None),
        "info": getattr(sentry_logger, "info", None),
        "warning": getattr(sentry_logger, "warning", None),
        "warn": getattr(sentry_logger, "warning", None),
        "error": getattr(sentry_logger, "error", None),
        "fatal": getattr(sentry_logger, "fatal", None),
    }.get(normalized_level) or getattr(sentry_logger, "info", None)
    if log_fn is None:
        return
    log_fn(message, attributes=clean_attributes)
