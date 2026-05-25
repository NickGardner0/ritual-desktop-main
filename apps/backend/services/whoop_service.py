"""
Whoop Integration Service
Handles OAuth and data sync with Whoop API
"""

import os
import uuid
import json
import httpx
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError

from database.models import WearableEventDB, WearableSampleDB, WhoopIntegrationDB
from database.connection import get_db_session
from services.tinybird_service import TinybirdService
from services.token_crypto import token_crypto
from services.whoop_api_client import WhoopApiClient
from services.whoop_tinybird_sink import ingest_whoop_tinybird
from services.unified_wearables_service import (
    wearable_connection_service,
    wearable_sync_service,
)

logger = logging.getLogger(__name__)

class WhoopService:
    """Service for Whoop integration"""
    
    WHOOP_API_BASE = "https://api.prod.whoop.com"
    WHOOP_TOKEN_URL = f"{WHOOP_API_BASE}/oauth/oauth2/token"
    WHOOP_SLEEP_HABIT_NAMES = {"sleep duration", "sleep", "whoop sleep"}
    WHOOP_RECOVERY_HABIT_NAMES = {"recovery score", "recovery", "whoop recovery"}
    WHOOP_WORKOUT_HABIT_NAMES = {"daily strain", "strain", "whoop strain"}
    DEFAULT_INITIAL_SYNC_DAYS = int(os.getenv("WHOOP_INITIAL_SYNC_DAYS", "30"))
    DEFAULT_RECONNECT_OVERLAP_DAYS = int(os.getenv("WHOOP_RECONNECT_OVERLAP_DAYS", "2"))
    DEFAULT_FULL_HISTORY_SYNC_DAYS = int(os.getenv("WHOOP_FULL_HISTORY_SYNC_DAYS", "3650"))
    MAX_MANUAL_SYNC_DAYS = int(os.getenv("WHOOP_MAX_MANUAL_SYNC_DAYS", "3650"))
    
    def __init__(self):
        self.client_id = os.getenv("WHOOP_CLIENT_ID")
        self.client_secret = os.getenv("WHOOP_CLIENT_SECRET")
        self.redirect_uri = os.getenv("NEXT_PUBLIC_WHOOP_REDIRECT_URI")
        self.api_client = WhoopApiClient(api_base=self.WHOOP_API_BASE)
        
        try:
            self.tinybird = TinybirdService()
            self.tinybird_enabled = True
            logger.info("✅ Tinybird service initialized for Whoop integration")
        except Exception as e:
            logger.warning(f"⚠️  Tinybird service not available for Whoop: {e}")
            self.tinybird = None
            self.tinybird_enabled = False

    def _encrypt_token(self, token: Optional[str]) -> Optional[str]:
        if token is None:
            return None
        return token_crypto.encrypt(token)

    def _decrypt_token(self, token: Optional[str]) -> Optional[str]:
        return token_crypto.decrypt(token)

    async def _request_with_retry(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        **kwargs
    ) -> httpx.Response:
        """
        Perform an HTTP request with exponential backoff retries for transient failures.
        """
        return await self.api_client.request_with_retry(client, method, url, **kwargs)
    
    async def exchange_code_for_token(self, code: str) -> Dict[str, Any]:
        """Exchange OAuth authorization code for access token"""
        if not self.client_id or not self.client_secret or not self.redirect_uri:
            raise Exception("Whoop OAuth configuration missing")
        
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await self._request_with_retry(
                client=client,
                method="POST",
                url=self.WHOOP_TOKEN_URL,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                data={
                    'grant_type': 'authorization_code',
                    'code': code,
                    'client_id': self.client_id,
                    'client_secret': self.client_secret,
                    'redirect_uri': self.redirect_uri,
                }
            )
            
            if not response.is_success:
                error_text = await response.aread()
                logger.error(f"❌ Whoop token exchange failed: {error_text}")
                raise Exception(f"Failed to exchange authorization code: {response.status_code}")
            
            return response.json()
    
    async def get_whoop_user_info(self, access_token: str) -> Dict[str, Any]:
        """Get user info from Whoop API (v1)"""
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await self._request_with_retry(
                client=client,
                method="GET",
                url=f"{self.WHOOP_API_BASE}/developer/v1/user/profile/basic",
                headers={'Authorization': f'Bearer {access_token}'}
            )
            
            if not response.is_success:
                raise Exception(f"Failed to get Whoop user info: {response.status_code}")
            
            return response.json()
    
    async def save_integration(
        self,
        user_id: str,
        access_token: str,
        refresh_token: Optional[str],
        expires_in: int,
        whoop_user_id: str,
        scope: Optional[str] = None,
    ) -> WhoopIntegrationDB:
        """Save or update Whoop integration for user"""
        async with get_db_session() as session:
            try:
                # Check if integration exists
                result = await session.execute(
                    select(WhoopIntegrationDB)
                    .where(WhoopIntegrationDB.user_id == user_id)
                )
                integration = result.scalar_one_or_none()
                
                expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
                reconnected = False
                provider_user_changed = False
                
                if integration:
                    reconnected = not bool(integration.is_active)
                    provider_user_changed = (
                        bool(integration.whoop_user_id)
                        and integration.whoop_user_id != whoop_user_id
                    )
                    # Update existing integration
                    integration.access_token = self._encrypt_token(access_token)
                    integration.refresh_token = self._encrypt_token(refresh_token) if refresh_token else None
                    integration.token_expires_at = expires_at
                    integration.whoop_user_id = whoop_user_id
                    integration.is_active = True
                    integration.connected_at = datetime.utcnow()
                    if scope:
                        integration.scope = scope
                    if provider_user_changed:
                        # A different upstream Whoop account is effectively a brand new
                        # connection, so the next sync should rebuild from a fresh window.
                        integration.last_sync_at = None
                    elif reconnected:
                        logger.info(
                            "🔄 Whoop reconnect detected for same Whoop user; "
                            "preserving last_sync_at so the next sync can resume incrementally"
                        )
                    logger.info(f"✅ Updated Whoop integration for user {user_id}")
                else:
                    # Create new integration
                    integration = WhoopIntegrationDB(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        whoop_user_id=whoop_user_id,
                        access_token=self._encrypt_token(access_token),
                        refresh_token=self._encrypt_token(refresh_token) if refresh_token else None,
                        token_expires_at=expires_at,
                        connected_at=datetime.utcnow(),
                        is_active=True,
                        scope=scope,
                    )
                    session.add(integration)
                    logger.info(f"✅ Created Whoop integration for user {user_id}")
                
                await session.commit()
                await session.refresh(integration)
                await wearable_connection_service.get_or_create_connection(
                    user_id=user_id,
                    provider="whoop",
                    auth_method="oauth",
                    provider_user_id=whoop_user_id,
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_expires_at=expires_at,
                    settings={
                        "whoop_sync_hour": integration.whoop_sync_hour or 9,
                        "sync_hour": integration.whoop_sync_hour or 9,
                        "auto_sync_enabled": True,
                    },
                    status="active",
                    reset_sync_state=provider_user_changed,
                )
                return integration
                
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Database error saving Whoop integration: {str(e)}")
                raise Exception(f"Failed to save Whoop integration: {str(e)}")
    
    async def get_integration(self, user_id: str) -> Optional[WhoopIntegrationDB]:
        """Get Whoop integration for user"""
        async with get_db_session() as session:
            try:
                result = await session.execute(
                    select(WhoopIntegrationDB)
                    .where(WhoopIntegrationDB.user_id == user_id)
                    .where(WhoopIntegrationDB.is_active == True)
                )
                integration = result.scalar_one_or_none()
                if integration is None:
                    canonical = await wearable_connection_service.get_connection(user_id, "whoop")
                    if (
                        canonical is None
                        or canonical.status != "active"
                        or not canonical.provider_user_id
                        or not canonical.access_token
                    ):
                        return None

                    settings = {}
                    if canonical.settings_json:
                        try:
                            settings = json.loads(canonical.settings_json)
                        except Exception:
                            settings = {}

                    scopes = None
                    if canonical.scopes_json:
                        try:
                            parsed_scopes = json.loads(canonical.scopes_json)
                            if isinstance(parsed_scopes, list):
                                scopes = " ".join(str(scope) for scope in parsed_scopes if scope)
                            elif isinstance(parsed_scopes, str):
                                scopes = parsed_scopes
                        except Exception:
                            scopes = canonical.scopes_json

                    integration = WhoopIntegrationDB(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        whoop_user_id=canonical.provider_user_id,
                        access_token=canonical.access_token,
                        refresh_token=canonical.refresh_token,
                        token_expires_at=canonical.token_expires_at or datetime.utcnow(),
                        connected_at=canonical.created_at or datetime.utcnow(),
                        last_sync_at=canonical.last_sync_at,
                        is_active=True,
                        whoop_sync_hour=int(settings.get("sync_hour", settings.get("whoop_sync_hour", 9)) or 9),
                        scope=scopes,
                    )
                    session.add(integration)
                    await session.commit()
                    await session.refresh(integration)
                    logger.info(
                        "🩹 Rebuilt legacy Whoop integration row from canonical wearable connection for user %s",
                        user_id,
                    )

                if integration:
                    integration.access_token = self._decrypt_token(integration.access_token)
                    integration.refresh_token = self._decrypt_token(integration.refresh_token)
                return integration
            except SQLAlchemyError as e:
                logger.error(f"❌ Error fetching Whoop integration: {str(e)}")
                return None
    
    async def disconnect_integration(self, user_id: str) -> bool:
        """Disconnect Whoop integration (mark as inactive)"""
        async with get_db_session() as session:
            try:
                # Avoid async libsql CursorResult cleanup bugs on write statements by
                # running the ORM update through the sync session bridge.
                def _mark_inactive(sync_session):
                    sync_session.execute(
                        update(WhoopIntegrationDB)
                        .where(WhoopIntegrationDB.user_id == user_id)
                        .values(is_active=False)
                    )

                await session.run_sync(_mark_inactive)
                await session.commit()
                await wearable_connection_service.disconnect(user_id, "whoop")
                logger.info(f"✅ Disconnected Whoop integration for user {user_id}")
                return True
            except SQLAlchemyError as e:
                await session.rollback()
                logger.error(f"❌ Error disconnecting Whoop integration: {str(e)}")
                return False
            except Exception as e:
                await session.rollback()
                logger.error(f"❌ Error disconnecting Whoop integration: {str(e)}")
                return False
    
    async def refresh_access_token(self, integration: WhoopIntegrationDB) -> Optional[str]:
        """Refresh access token if expired"""
        if not integration.refresh_token:
            return None
        
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                base_payload = {
                    'grant_type': 'refresh_token',
                    'refresh_token': integration.refresh_token,
                    'client_id': self.client_id,
                    'client_secret': self.client_secret,
                }

                scope = getattr(integration, 'scope', None)
                payload_attempts = []
                if scope:
                    payload_attempts.append(("stored-scope", {**base_payload, 'scope': scope}))
                payload_attempts.append(("no-scope", dict(base_payload)))
                if self.redirect_uri:
                    payload_attempts.append(
                        ("redirect-uri", {**base_payload, 'redirect_uri': self.redirect_uri})
                    )

                response = None
                for attempt_name, refresh_payload in payload_attempts:
                    response = await self._request_with_retry(
                        client=client,
                        method="POST",
                        url=self.WHOOP_TOKEN_URL,
                        headers={'Content-Type': 'application/x-www-form-urlencoded'},
                        data=refresh_payload,
                    )
                    if response.is_success:
                        if attempt_name != "stored-scope":
                            logger.info(
                                "✅ Whoop token refresh succeeded using fallback payload: %s",
                                attempt_name,
                            )
                        break

                    logger.warning(
                        "⚠️ Whoop token refresh attempt '%s' failed: %s %s",
                        attempt_name,
                        response.status_code,
                        response.text,
                    )

                if response is None or not response.is_success:
                    logger.error(f"❌ Token refresh failed: {response.status_code if response else 'no response'}")
                    logger.error(f"❌ Response body: {response.text if response else 'n/a'}")
                    return None
                
                token_data = response.json()
                new_access_token = token_data['access_token']
                new_refresh_token = token_data.get('refresh_token')  # Whoop may return a new refresh token
                new_expires_in = token_data.get('expires_in', 3600)
                
                # Update in database
                async with get_db_session() as session:
                    update_values = {
                        'access_token': self._encrypt_token(new_access_token),
                        'token_expires_at': datetime.utcnow() + timedelta(seconds=new_expires_in)
                    }
                    
                    # Update refresh token if a new one was provided
                    if new_refresh_token:
                        update_values['refresh_token'] = self._encrypt_token(new_refresh_token)
                        logger.info(f"🔄 New refresh token received from Whoop")

                    # Persist scope if returned (backfills existing rows)
                    new_scope = token_data.get('scope')
                    if new_scope:
                        update_values['scope'] = new_scope
                    
                    await session.execute(
                        update(WhoopIntegrationDB)
                        .where(WhoopIntegrationDB.id == integration.id)
                        .values(**update_values)
                    )
                    await session.commit()

                await wearable_connection_service.get_or_create_connection(
                    user_id=integration.user_id,
                    provider="whoop",
                    auth_method="oauth",
                    provider_user_id=integration.whoop_user_id,
                    access_token=new_access_token,
                    refresh_token=new_refresh_token or integration.refresh_token,
                    token_expires_at=datetime.utcnow() + timedelta(seconds=new_expires_in),
                    settings={
                        "whoop_sync_hour": integration.whoop_sync_hour or 9,
                        "sync_hour": integration.whoop_sync_hour or 9,
                        "auto_sync_enabled": True,
                    },
                    status="active",
                )
                
                logger.info(f"✅ Refreshed Whoop access token for user {integration.user_id}")
                return new_access_token
                
        except Exception as e:
            logger.error(f"❌ Error refreshing token: {str(e)}")
            return None
    
    async def get_valid_access_token(self, user_id: str) -> Optional[str]:
        """Get valid access token, refreshing if needed"""
        integration = await self.get_integration(user_id)
        
        if not integration:
            return None
        
        # Check if token is expired or about to expire (within 5 minutes)
        now = datetime.utcnow()
        expires_at = integration.token_expires_at
        
        if expires_at < now + timedelta(minutes=5):
            # Token expired or about to expire, refresh it
            logger.info(f"🔄 Token expired, refreshing for user {user_id}")
            new_token = await self.refresh_access_token(integration)
            return new_token
        
        return integration.access_token

    async def _get_enabled_whoop_sync_metrics(self, user_id: str) -> Dict[str, bool]:
        """
        Determine which Whoop metric families are enabled based on the user's
        selected Whoop-linked habits.
        """
        from database.models import HabitDB

        async with get_db_session() as session:
            result = await session.execute(
                select(HabitDB.name)
                .where(HabitDB.user_id == user_id)
                .where(HabitDB.integration_source == 'whoop')
            )
            habit_names = {
                (name or "").strip().lower()
                for name in result.scalars().all()
            }

        return {
            "sleep": bool(habit_names & self.WHOOP_SLEEP_HABIT_NAMES),
            "recovery": bool(habit_names & self.WHOOP_RECOVERY_HABIT_NAMES),
            "workouts": bool(habit_names & self.WHOOP_WORKOUT_HABIT_NAMES),
        }

    async def _infer_last_sync_from_stored_data(self, user_id: str) -> Optional[datetime]:
        """
        Reconstruct a conservative sync checkpoint from canonical Whoop data when
        an older reconnect flow has already cleared last_sync_at.
        """
        async with get_db_session() as session:
            event_result = await session.execute(
                select(func.max(WearableEventDB.end_time)).where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.provider == "whoop",
                    WearableEventDB.deleted_at.is_(None),
                )
            )
            sample_result = await session.execute(
                select(func.max(WearableSampleDB.end_time)).where(
                    WearableSampleDB.user_id == user_id,
                    WearableSampleDB.provider == "whoop",
                    WearableSampleDB.deleted_at.is_(None),
                )
            )

        latest_event_end = event_result.scalar_one_or_none()
        latest_sample_end = sample_result.scalar_one_or_none()
        candidates = [dt for dt in (latest_event_end, latest_sample_end) if dt is not None]
        if not candidates:
            return None
        inferred = max(candidates)
        logger.info(
            "📎 Reconstructed Whoop sync checkpoint from stored data: %s",
            inferred.isoformat(),
        )
        return inferred
    
    async def sync_whoop_data(
        self,
        user_id: str,
        days_back: int = None,
        force_full_sync: bool = False,
        full_history: bool = False,
    ) -> Dict[str, Any]:
        """
        Sync data from Whoop API with smart incremental syncing.
        
        - First sync: fetches a configurable historical window (default 30 days)
        - Same-user reconnects: resume from prior checkpoint with a short safety overlap
        - Subsequent syncs: only fetches data since last sync (with safety overlap)
        - force_full_sync=True: always fetches the default historical window
        - full_history=True: fetches the extended historical window for deep backfills
        - days_back override: manual control over sync range (up to MAX_MANUAL_SYNC_DAYS)
        """
        access_token = await self.get_valid_access_token(user_id)
        
        if not access_token:
            raise Exception("Whoop integration not found or token invalid")
        
        # Get integration to check last sync time
        integration = await self.get_integration(user_id)
        enabled_metrics = await self._get_enabled_whoop_sync_metrics(user_id)
        logger.info(f"📋 Whoop metric mappings enabled: {enabled_metrics}")
        
        synced_data = {
            "recovery": 0,
            "sleep": 0,
            "workouts": 0,
            "cycles": 0  # Daily metrics including steps
        }
        
        # Smart date range calculation
        end_date = datetime.utcnow()
        default_initial_sync_days = max(self.DEFAULT_INITIAL_SYNC_DAYS, 1)
        overlap_days = max(self.DEFAULT_RECONNECT_OVERLAP_DAYS, 1)
        
        if full_history:
            full_history_days = max(self.DEFAULT_FULL_HISTORY_SYNC_DAYS, default_initial_sync_days)
            start_date = end_date - timedelta(days=full_history_days)
            logger.info(
                f"📅 Full history sync requested: fetching last {full_history_days} days"
            )
        elif days_back is not None:
            # Manual override - use the requested window, clamped to a safe upper bound.
            requested_days = max(int(days_back), 1)
            sync_days = min(requested_days, self.MAX_MANUAL_SYNC_DAYS)
            start_date = end_date - timedelta(days=sync_days)
            if sync_days != requested_days:
                logger.info(
                    f"📅 Manual sync request clamped from {requested_days} to {sync_days} days"
                )
            else:
                logger.info(f"📅 Manual sync: fetching last {sync_days} days")
        elif force_full_sync:
            # Force a historical refresh using the default first-sync window.
            start_date = end_date - timedelta(days=default_initial_sync_days)
            logger.info(
                f"📅 Full sync requested: fetching last {default_initial_sync_days} days"
            )
        elif integration and integration.last_sync_at:
            # Incremental sync - fetch since last sync with a short overlap for safety
            # The overlap ensures we don't miss any data due to timezone issues or partial syncs
            last_sync = integration.last_sync_at
            days_since_sync = (end_date - last_sync).days
            
            # Add the safety overlap, but minimum 1 day, maximum manual window cap
            sync_days = min(max(days_since_sync + overlap_days, 1), self.MAX_MANUAL_SYNC_DAYS)
            start_date = end_date - timedelta(days=sync_days)
            
            logger.info(
                f"📅 Incremental sync: last sync was {days_since_sync} days ago, "
                f"fetching last {sync_days} days"
            )
        else:
            inferred_last_sync = await self._infer_last_sync_from_stored_data(user_id)
            if inferred_last_sync:
                days_since_sync = (end_date - inferred_last_sync).days
                sync_days = min(max(days_since_sync + overlap_days, 1), self.MAX_MANUAL_SYNC_DAYS)
                start_date = end_date - timedelta(days=sync_days)
                logger.info(
                    f"📅 Recovered incremental sync: inferred checkpoint was {days_since_sync} days ago, "
                    f"fetching last {sync_days} days"
                )
            else:
                # First sync - fetch the default historical window.
                start_date = end_date - timedelta(days=default_initial_sync_days)
                logger.info(
                    f"📅 First sync: fetching last {default_initial_sync_days} days of historical data"
                )
        
        any_api_success = False

        try:
            fetched = await self.api_client.fetch_enabled_data(
                access_token=access_token,
                start_date=start_date,
                end_date=end_date,
                enabled_metrics=enabled_metrics,
            )
            recovery_data = fetched.recovery_data
            sleep_data = fetched.sleep_data
            workout_data = fetched.workout_data
            cycle_data = fetched.cycle_data
            synced_data = fetched.synced_data
            any_api_success = fetched.any_api_success

            # Store data in Tinybird for analytics
            if self.tinybird_enabled:
                try:
                    await ingest_whoop_tinybird(
                        self.tinybird,
                        user_id=user_id,
                        whoop_connection_id=integration.id if integration else user_id,
                        recovery_data=recovery_data,
                        sleep_data=sleep_data,
                        workout_data=workout_data,
                        cycle_data=cycle_data
                    )
                    logger.info(f"✅ Whoop data synced to Tinybird for analytics")
                except Exception as tb_error:
                    logger.warning(f"⚠️  Tinybird ingestion failed (non-fatal): {str(tb_error)}")

            try:
                await wearable_sync_service.ingest_whoop_data(
                    user_id=user_id,
                    provider_user_id=integration.whoop_user_id if integration else user_id,
                    recovery_data=recovery_data,
                    sleep_data=sleep_data,
                    workout_data=workout_data,
                    cycle_data=cycle_data,
                    access_token=access_token,
                    refresh_token=integration.refresh_token if integration else None,
                    token_expires_at=integration.token_expires_at if integration else None,
                )
                logger.info("✅ Whoop data synced through canonical wearable storage")
            except Exception as db_error:
                logger.warning(f"⚠️  Canonical wearable sync failed (non-fatal): {str(db_error)}")

            try:
                latest_cycle_date = None
                if cycle_data and cycle_data.get("records"):
                    latest_cycle_date = max(
                        (
                            str(record.get("start", ""))[:10]
                            for record in cycle_data["records"]
                            if record.get("start")
                        ),
                        default=None,
                    )
                latest_sleep_date = None
                if sleep_data and sleep_data.get("records"):
                    latest_sleep_date = max(
                        (
                            str(record.get("start", ""))[:10]
                            for record in sleep_data["records"]
                            if record.get("start")
                        ),
                        default=None,
                    )

                if integration:
                    await wearable_connection_service.get_or_create_connection(
                        user_id=user_id,
                        provider="whoop",
                        auth_method="oauth",
                        provider_user_id=integration.whoop_user_id,
                        access_token=access_token,
                        refresh_token=integration.refresh_token,
                        token_expires_at=integration.token_expires_at,
                        settings={
                            "whoop_sync_hour": integration.whoop_sync_hour or 9,
                            "sync_hour": integration.whoop_sync_hour or 9,
                            "auto_sync_enabled": True,
                            "latest_upstream_cycle_date": latest_cycle_date,
                            "latest_upstream_sleep_date": latest_sleep_date,
                        },
                        status="active",
                    )
            except Exception as connection_error:
                logger.warning(f"⚠️  Failed to persist Whoop upstream sync metadata: {str(connection_error)}")

        except Exception as e:
            logger.warning(f"⚠️  Error fetching Whoop data: {str(e)}")
        
        # If no API call succeeded at all, this is likely a total auth failure
        # Don't update last_sync_at so the next sync uses the correct date range
        if not any_api_success:
            total_records = sum(synced_data.values())
            if total_records == 0:
                raise Exception(
                    "Whoop API authentication failed - all requests returned 401. "
                    "Please disconnect and reconnect your Whoop integration to get fresh tokens."
                )
        
        # Update last sync time (only if we successfully talked to the API)
        async with get_db_session() as session:
            try:
                synced_at = datetime.utcnow()

                # Route the write through the sync bridge to avoid libsql async
                # cursor cleanup bugs that surface after an otherwise successful sync.
                def _mark_synced(sync_session):
                    sync_session.execute(
                        update(WhoopIntegrationDB)
                        .where(WhoopIntegrationDB.user_id == user_id)
                        .where(WhoopIntegrationDB.is_active == True)
                        .values(last_sync_at=synced_at)
                    )

                await session.run_sync(_mark_synced)
                await session.commit()
            except SQLAlchemyError as e:
                logger.warning(f"⚠️  Error updating last_sync_at: {str(e)}")
        
        # Calculate days synced for the response
        days_synced = (end_date - start_date).days
        
        return {
            "status": "success",
            "synced_at": datetime.utcnow().isoformat(),
            "sync_period": {
                "start_date": start_date.strftime('%Y-%m-%d'),
                "end_date": end_date.strftime('%Y-%m-%d'),
                "days": days_synced
            },
            "data": synced_data
        }

whoop_service = WhoopService()
