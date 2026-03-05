"""App exclusion helpers for WatcherService."""

from __future__ import annotations

from typing import Dict, List, Optional

from sqlalchemy import delete, select

from database.models import WatcherAppExclusionDB

DEFAULT_SENSITIVE_APPS: List[Dict[str, str]] = [
    {"bundle_id": "com.1password", "name": "1Password"},
    {"bundle_id": "com.lastpass", "name": "LastPass"},
    {"bundle_id": "com.bitwarden", "name": "Bitwarden"},
    {"bundle_id": "com.dashlane", "name": "Dashlane"},
    {"bundle_id": "com.apple.keychainaccess", "name": "Keychain Access"},
    {"bundle_id": "com.apple.Safari", "name": "Safari (Private Windows)"},
    {"bundle_id": "com.google.Chrome.app.Profile", "name": "Chrome (Incognito)"},
    {"bundle_id": "org.mozilla.firefox", "name": "Firefox (Private)"},
    {"bundle_id": "com.apple.Health", "name": "Health"},
    {"bundle_id": "com.apple.MobileSMS", "name": "Messages"},
]


async def add_app_exclusion_impl(
    service,
    user_id: str,
    bundle_id: str,
    app_name: Optional[str] = None,
    reason: str = "user_preference",
) -> bool:
    async with service._get_db_session() as session:
        result = await session.execute(
            select(WatcherAppExclusionDB).where(
                WatcherAppExclusionDB.user_id == user_id,
                WatcherAppExclusionDB.bundle_id == bundle_id,
            )
        )
        if result.scalar_one_or_none():
            return True

        session.add(
            WatcherAppExclusionDB(
                user_id=user_id,
                bundle_id=bundle_id,
                app_name=app_name,
                reason=reason,
                created_at=service._now_ms(),
            )
        )
        await session.commit()
        return True


async def remove_app_exclusion_impl(
    service,
    user_id: str,
    bundle_id: str,
) -> bool:
    async with service._get_db_session() as session:
        result = await session.execute(
            delete(WatcherAppExclusionDB).where(
                WatcherAppExclusionDB.user_id == user_id,
                WatcherAppExclusionDB.bundle_id == bundle_id,
            )
        )
        await session.commit()
        return bool(result.rowcount and result.rowcount > 0)


async def get_app_exclusions_impl(service, user_id: str) -> List[Dict]:
    async with service._get_db_session() as session:
        result = await session.execute(
            select(WatcherAppExclusionDB).where(WatcherAppExclusionDB.user_id == user_id)
        )
        exclusions = result.scalars().all()
        return [
            {
                "bundle_id": exclusion.bundle_id,
                "app_name": exclusion.app_name,
                "reason": exclusion.reason,
            }
            for exclusion in exclusions
        ]


def get_suggested_exclusions_impl() -> List[Dict[str, str]]:
    return DEFAULT_SENSITIVE_APPS
