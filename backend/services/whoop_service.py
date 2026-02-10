"""
Whoop Integration Service
Handles OAuth and data sync with Whoop API
"""

import os
import uuid
import json
import asyncio
import httpx
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError

from database.models import WhoopIntegrationDB
from database.connection import get_db_session
from services.tinybird_service import TinybirdService
from services.token_crypto import token_crypto

class WhoopService:
    """Service for Whoop integration"""
    
    WHOOP_API_BASE = "https://api.prod.whoop.com"
    WHOOP_TOKEN_URL = f"{WHOOP_API_BASE}/oauth/oauth2/token"
    
    def __init__(self):
        self.client_id = os.getenv("WHOOP_CLIENT_ID")
        self.client_secret = os.getenv("WHOOP_CLIENT_SECRET")
        self.redirect_uri = os.getenv("NEXT_PUBLIC_WHOOP_REDIRECT_URI")
        
        try:
            self.tinybird = TinybirdService()
            self.tinybird_enabled = True
            print("✅ Tinybird service initialized for Whoop integration")
        except Exception as e:
            print(f"⚠️  Tinybird service not available for Whoop: {e}")
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
        max_attempts = int(os.getenv("WHOOP_API_MAX_RETRIES", "3"))
        base_delay = float(os.getenv("WHOOP_API_RETRY_BASE_DELAY", "0.5"))
        retryable_statuses = {408, 429, 500, 502, 503, 504}

        for attempt in range(1, max_attempts + 1):
            try:
                response = await client.request(method, url, **kwargs)
                if response.status_code in retryable_statuses and attempt < max_attempts:
                    delay = base_delay * (2 ** (attempt - 1))
                    print(
                        f"⚠️ Whoop API transient error {response.status_code} on {url}; "
                        f"retrying in {delay:.1f}s ({attempt}/{max_attempts})"
                    )
                    await asyncio.sleep(delay)
                    continue
                return response
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt >= max_attempts:
                    raise
                delay = base_delay * (2 ** (attempt - 1))
                print(
                    f"⚠️ Whoop API request error ({exc}); retrying in {delay:.1f}s "
                    f"({attempt}/{max_attempts})"
                )
                await asyncio.sleep(delay)
    
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
                print(f"❌ Whoop token exchange failed: {error_text}")
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
        whoop_user_id: str
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
                
                if integration:
                    # Update existing integration
                    integration.access_token = self._encrypt_token(access_token)
                    integration.refresh_token = self._encrypt_token(refresh_token) if refresh_token else None
                    integration.token_expires_at = expires_at
                    integration.whoop_user_id = whoop_user_id
                    integration.is_active = True
                    integration.connected_at = datetime.utcnow()
                    print(f"✅ Updated Whoop integration for user {user_id}")
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
                        is_active=True
                    )
                    session.add(integration)
                    print(f"✅ Created Whoop integration for user {user_id}")
                
                await session.commit()
                await session.refresh(integration)
                return integration
                
            except SQLAlchemyError as e:
                await session.rollback()
                print(f"❌ Database error saving Whoop integration: {str(e)}")
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
                if integration:
                    integration.access_token = self._decrypt_token(integration.access_token)
                    integration.refresh_token = self._decrypt_token(integration.refresh_token)
                return integration
            except SQLAlchemyError as e:
                print(f"❌ Error fetching Whoop integration: {str(e)}")
                return None
    
    async def disconnect_integration(self, user_id: str) -> bool:
        """Disconnect Whoop integration (mark as inactive)"""
        async with get_db_session() as session:
            try:
                await session.execute(
                    update(WhoopIntegrationDB)
                    .where(WhoopIntegrationDB.user_id == user_id)
                    .values(is_active=False)
                )
                await session.commit()
                print(f"✅ Disconnected Whoop integration for user {user_id}")
                return True
            except SQLAlchemyError as e:
                await session.rollback()
                print(f"❌ Error disconnecting Whoop integration: {str(e)}")
                return False
    
    async def refresh_access_token(self, integration: WhoopIntegrationDB) -> Optional[str]:
        """Refresh access token if expired"""
        if not integration.refresh_token:
            return None
        
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await self._request_with_retry(
                    client=client,
                    method="POST",
                    url=self.WHOOP_TOKEN_URL,
                    headers={'Content-Type': 'application/x-www-form-urlencoded'},
                    data={
                        'grant_type': 'refresh_token',
                        'refresh_token': integration.refresh_token,
                        'client_id': self.client_id,
                        'client_secret': self.client_secret,
                        'redirect_uri': self.redirect_uri,  # Required by Whoop OAuth
                    }
                )
                
                if not response.is_success:
                    print(f"❌ Token refresh failed: {response.status_code}")
                    print(f"❌ Response body: {response.text}")
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
                        print(f"🔄 New refresh token received from Whoop")
                    
                    await session.execute(
                        update(WhoopIntegrationDB)
                        .where(WhoopIntegrationDB.id == integration.id)
                        .values(**update_values)
                    )
                    await session.commit()
                
                print(f"✅ Refreshed Whoop access token for user {integration.user_id}")
                return new_access_token
                
        except Exception as e:
            print(f"❌ Error refreshing token: {str(e)}")
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
            print(f"🔄 Token expired, refreshing for user {user_id}")
            new_token = await self.refresh_access_token(integration)
            return new_token if new_token else integration.access_token
        
        return integration.access_token
    
    async def sync_whoop_data(self, user_id: str, days_back: int = None, force_full_sync: bool = False) -> Dict[str, Any]:
        """
        Sync data from Whoop API with smart incremental syncing.
        
        - First sync: fetches 30 days of historical data
        - Subsequent syncs: only fetches data since last sync (with 2-day overlap)
        - force_full_sync=True: always fetches 30 days
        - days_back override: manual control over sync range
        """
        access_token = await self.get_valid_access_token(user_id)
        
        if not access_token:
            raise Exception("Whoop integration not found or token invalid")
        
        # Get integration to check last sync time
        integration = await self.get_integration(user_id)
        
        synced_data = {
            "recovery": 0,
            "sleep": 0,
            "workouts": 0,
            "cycles": 0  # Daily metrics including steps
        }
        
        # Smart date range calculation
        end_date = datetime.utcnow()
        
        if days_back is not None:
            # Manual override - use specified days
            start_date = end_date - timedelta(days=days_back)
            print(f"📅 Manual sync: fetching last {days_back} days")
        elif force_full_sync:
            # Force full sync - fetch 30 days
            start_date = end_date - timedelta(days=30)
            print(f"📅 Full sync requested: fetching last 30 days")
        elif integration and integration.last_sync_at:
            # Incremental sync - fetch since last sync with 2-day overlap for safety
            # The overlap ensures we don't miss any data due to timezone issues or partial syncs
            last_sync = integration.last_sync_at
            days_since_sync = (end_date - last_sync).days
            
            # Add 2 days overlap, but minimum 1 day, maximum 30 days
            sync_days = min(max(days_since_sync + 2, 1), 30)
            start_date = end_date - timedelta(days=sync_days)
            
            print(f"📅 Incremental sync: last sync was {days_since_sync} days ago, fetching last {sync_days} days")
        else:
            # First sync - fetch 30 days of historical data
            start_date = end_date - timedelta(days=30)
            print(f"📅 First sync: fetching last 30 days of historical data")
        
        # Track whether ANY API call succeeded (to avoid updating last_sync_at on total auth failure)
        any_api_success = False
        
        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                # Fetch recovery data (v1 API - v2 not available yet)
                # Whoop API returns max 25 records per page, so we need pagination
                all_recovery = []
                next_token = None
                
                while True:
                    params = {
                        'start': start_date.isoformat() + 'Z',
                        'end': end_date.isoformat() + 'Z',
                        'limit': 25  # Max allowed by Whoop API
                    }
                    if next_token:
                        params['nextToken'] = next_token
                    
                    recovery_response = await self._request_with_retry(
                        client=client,
                        method="GET",
                        url=f"{self.WHOOP_API_BASE}/developer/v1/recovery",
                        headers={'Authorization': f'Bearer {access_token}'},
                        params=params
                    )
                    
                    if recovery_response.is_success:
                        any_api_success = True
                        recovery_page = recovery_response.json()
                        page_records = recovery_page.get('records', [])
                        all_recovery.extend(page_records)
                        
                        # Check if there are more pages
                        next_token = recovery_page.get('next_token')
                        if not next_token:
                            break  # No more pages
                    elif recovery_response.status_code == 401:
                        print(f"❌ Whoop API returned 401 (unauthorized) - token may be expired or invalid")
                        break
                    else:
                        print(f"⚠️  Error fetching recovery: {recovery_response.status_code}")
                        break
                
                recovery_data = {'records': all_recovery} if all_recovery else None
                if recovery_data:
                    synced_data["recovery"] = len(recovery_data.get('records', []))
                    print(f"✅ Synced {synced_data['recovery']} recovery records")
                
                # Fetch cycle data FIRST (v1 API - includes daily metrics)
                # We need cycle IDs to fetch sleep data in v2 API
                # Whoop API returns max 25 records per page, so we need pagination
                all_cycles = []
                next_token = None
                
                while True:
                    params = {
                        'start': start_date.isoformat() + 'Z',
                        'end': end_date.isoformat() + 'Z',
                        'limit': 25  # Max allowed by Whoop API
                    }
                    if next_token:
                        params['nextToken'] = next_token
                    
                    cycle_response = await self._request_with_retry(
                        client=client,
                        method="GET",
                        url=f"{self.WHOOP_API_BASE}/developer/v1/cycle",
                        headers={'Authorization': f'Bearer {access_token}'},
                        params=params
                    )
                    
                    if cycle_response.is_success:
                        any_api_success = True
                        cycle_page = cycle_response.json()
                        page_records = cycle_page.get('records', [])
                        all_cycles.extend(page_records)
                        
                        # Check if there are more pages
                        next_token = cycle_page.get('next_token')
                        if not next_token:
                            break  # No more pages
                    elif cycle_response.status_code == 401:
                        print(f"❌ Whoop API returned 401 (unauthorized) for cycles")
                        break
                    else:
                        print(f"⚠️  Error fetching cycles: {cycle_response.status_code}")
                        break
                
                cycle_data = {'records': all_cycles} if all_cycles else None
                if cycle_data:
                    synced_data["cycles"] = len(cycle_data.get('records', []))
                    print(f"✅ Synced {synced_data['cycles']} cycle records (daily metrics)")
                
                # Fetch sleep data using v2 API (requires cycle IDs)
                # v2 endpoint: /developer/v2/cycle/{cycleId}/sleep
                print(f"🔍 Fetching sleep data using v2 API (cycle-based)")
                sleep_data = {"records": []}
                
                if cycle_data and cycle_data.get('records'):
                    for cycle in cycle_data['records']:
                        cycle_id = cycle.get('id')
                        if not cycle_id:
                            continue
                        
                        try:
                            sleep_response = await self._request_with_retry(
                                client=client,
                                method="GET",
                                url=f"{self.WHOOP_API_BASE}/developer/v2/cycle/{cycle_id}/sleep",
                                headers={'Authorization': f'Bearer {access_token}'}
                            )
                            
                            if sleep_response.is_success:
                                sleep_record = sleep_response.json()
                                # v2 API returns a single sleep object, not a list
                                # Wrap it in records array format for consistency
                                if sleep_record:
                                    sleep_data['records'].append(sleep_record)
                                    synced_data["sleep"] += 1
                            else:
                                print(f"⚠️  No sleep data for cycle {cycle_id}: {sleep_response.status_code}")
                        except Exception as e:
                            print(f"⚠️  Error fetching sleep for cycle {cycle_id}: {str(e)}")
                    
                    print(f"✅ Fetched {synced_data['sleep']} sleep records from Whoop v2 API")
                    
                    # Debug: Print details of each sleep record
                    for record in sleep_data.get('records', []):
                        sleep_start = record.get('start', 'N/A')
                        sleep_end = record.get('end', 'N/A')
                        sleep_date = sleep_start[:10] if sleep_start != 'N/A' else 'N/A'
                        # Calculate actual sleep time (REM + Slow Wave + Light, excluding awake time)
                        stage_summary = record.get('score', {}).get('stage_summary', {})
                        rem_ms = stage_summary.get('total_rem_sleep_time_milli', 0)
                        slow_wave_ms = stage_summary.get('total_slow_wave_sleep_time_milli', 0)
                        light_ms = stage_summary.get('total_light_sleep_time_milli', 0)
                        total_ms = rem_ms + slow_wave_ms + light_ms
                        total_hours = round(total_ms / 3600000, 2)
                        print(f"  📊 Sleep: date={sleep_date}, start={sleep_start}, end={sleep_end}, duration={total_hours}h (actual sleep)")
                else:
                    print(f"⚠️  No cycles found, skipping sleep data fetch")
                
                # Fetch workout data (v1 API - v2 not available yet)
                # Whoop API returns max 25 records per page, so we need pagination
                all_workouts = []
                next_token = None
                
                while True:
                    params = {
                        'start': start_date.isoformat() + 'Z',
                        'end': end_date.isoformat() + 'Z',
                        'limit': 25  # Max allowed by Whoop API
                    }
                    if next_token:
                        params['nextToken'] = next_token
                    
                    workout_response = await self._request_with_retry(
                        client=client,
                        method="GET",
                        url=f"{self.WHOOP_API_BASE}/developer/v1/activity/workout",
                        headers={'Authorization': f'Bearer {access_token}'},
                        params=params
                    )
                    
                    if workout_response.is_success:
                        any_api_success = True
                        workout_page = workout_response.json()
                        page_records = workout_page.get('records', [])
                        all_workouts.extend(page_records)
                        
                        # Check if there are more pages
                        next_token = workout_page.get('next_token')
                        if not next_token:
                            break  # No more pages
                    elif workout_response.status_code == 401:
                        print(f"❌ Whoop API returned 401 (unauthorized) for workouts")
                        break
                    else:
                        print(f"⚠️  Error fetching workouts: {workout_response.status_code}")
                        break
                
                workout_data = {'records': all_workouts} if all_workouts else None
                if workout_data:
                    synced_data["workouts"] = len(workout_data.get('records', []))
                    print(f"✅ Synced {synced_data['workouts']} workout records")
                
                # Store data in Tinybird for analytics
                if self.tinybird_enabled:
                    try:
                        await self._ingest_to_tinybird(
                            user_id=user_id,
                            recovery_data=recovery_data,
                            sleep_data=sleep_data,
                            workout_data=workout_data,
                            cycle_data=cycle_data
                        )
                        print(f"✅ Whoop data synced to Tinybird for analytics")
                    except Exception as tb_error:
                        print(f"⚠️  Tinybird ingestion failed (non-fatal): {str(tb_error)}")
                
                # Store data in Turso database for dashboard display
                try:
                    await self._sync_to_habit_logs(
                        user_id=user_id,
                        recovery_data=recovery_data,
                        sleep_data=sleep_data,
                        workout_data=workout_data,
                        cycle_data=cycle_data
                    )
                    print(f"✅ Whoop data synced to Turso habit_logs for dashboard")
                except Exception as db_error:
                    print(f"⚠️  Database sync failed (non-fatal): {str(db_error)}")
                
            except Exception as e:
                print(f"⚠️  Error fetching Whoop data: {str(e)}")
        
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
                await session.execute(
                    update(WhoopIntegrationDB)
                    .where(WhoopIntegrationDB.user_id == user_id)
                    .where(WhoopIntegrationDB.is_active == True)
                    .values(last_sync_at=datetime.utcnow())
                )
                await session.commit()
            except SQLAlchemyError as e:
                print(f"⚠️  Error updating last_sync_at: {str(e)}")
        
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
    
    async def _ingest_to_tinybird(
        self,
        user_id: str,
        recovery_data: Optional[Dict[str, Any]] = None,
        sleep_data: Optional[Dict[str, Any]] = None,
        workout_data: Optional[Dict[str, Any]] = None,
        cycle_data: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Ingest Whoop data into Tinybird for analytics
        """
        if not self.tinybird_enabled:
            return
        
        # Get Whoop integration to use as connection_id
        integration = await self.get_integration(user_id)
        if not integration:
            return
        
        whoop_connection_id = integration.id
        
        # Ingest recovery data
        if recovery_data and recovery_data.get('records'):
            recovery_events = []
            for record in recovery_data['records']:
                score = record.get('score', {})
                # Use cycle_id as deterministic key for deduplication
                whoop_cycle_id = str(record.get('cycle_id', ''))
                recovery_events.append({
                    'id': f"whoop_recovery_{whoop_cycle_id}",  # Deterministic ID
                    'user_id': user_id,
                    'whoop_connection_id': whoop_connection_id,
                    'cycle_id': whoop_cycle_id,
                    'date': record.get('created_at', '')[:10],  # Extract date from datetime
                    'recovery_score': score.get('recovery_score', 0),
                    'hrv_rmssd': score.get('hrv_rmssd_milli', 0),
                    'resting_heart_rate': score.get('resting_heart_rate', 0),
                    'spo2_percentage': score.get('spo2_percentage', 0),
                    'skin_temp_celsius': score.get('skin_temp_celsius', 0),
                    'created_at': datetime.utcnow().isoformat()
                })
            
            if recovery_events:
                await self.tinybird.ingest_events('whoop_recovery_data', recovery_events)
                print(f"📊 Ingested {len(recovery_events)} recovery records to Tinybird")
        
        # Ingest sleep data
        if sleep_data and sleep_data.get('records'):
            sleep_events = []
            for record in sleep_data['records']:
                score = record.get('score', {})
                stage_summary = score.get('stage_summary', {})
                
                # Convert milliseconds to minutes
                total_sleep = stage_summary.get('total_in_bed_time_milli', 0) // 60000
                rem_sleep = stage_summary.get('total_rem_sleep_time_milli', 0) // 60000
                slow_wave = stage_summary.get('total_slow_wave_sleep_time_milli', 0) // 60000
                light_sleep = stage_summary.get('total_light_sleep_time_milli', 0) // 60000
                awake = stage_summary.get('total_awake_time_milli', 0) // 60000
                
                # Use Whoop's sleep ID as primary key to enable deduplication
                whoop_sleep_id = str(record.get('id', ''))
                sleep_events.append({
                    'id': f"whoop_sleep_{whoop_sleep_id}",  # Deterministic ID for deduplication
                    'user_id': user_id,
                    'whoop_connection_id': whoop_connection_id,
                    'sleep_id': whoop_sleep_id,
                    'date': record.get('start', '')[:10],  # Extract date from datetime
                    'sleep_performance_percentage': score.get('sleep_performance_percentage', 0),
                    'total_sleep_duration_minutes': total_sleep,
                    'sleep_efficiency_percentage': score.get('sleep_efficiency_percentage', 0),
                    'rem_sleep_minutes': rem_sleep,
                    'slow_wave_sleep_minutes': slow_wave,
                    'light_sleep_minutes': light_sleep,
                    'awake_minutes': awake,
                    'sleep_onset': record.get('start', ''),
                    'sleep_end': record.get('end', ''),
                    'created_at': datetime.utcnow().isoformat()
                })
            
            if sleep_events:
                await self.tinybird.ingest_events('whoop_sleep_data', sleep_events)
                print(f"📊 Ingested {len(sleep_events)} sleep records to Tinybird")
        
        # Ingest workout data
        if workout_data and workout_data.get('records'):
            workout_events = []
            for record in workout_data['records']:
                score = record.get('score', {})
                
                # Convert duration to minutes
                start = datetime.fromisoformat(record.get('start', '').replace('Z', '+00:00'))
                end = datetime.fromisoformat(record.get('end', '').replace('Z', '+00:00'))
                duration_minutes = int((end - start).total_seconds() / 60)
                
                # Use Whoop's workout ID as deterministic key for deduplication
                whoop_workout_id = str(record.get('id', ''))
                workout_events.append({
                    'id': f"whoop_workout_{whoop_workout_id}",  # Deterministic ID
                    'user_id': user_id,
                    'whoop_connection_id': whoop_connection_id,
                    'workout_id': whoop_workout_id,
                    'date': record.get('start', '')[:10],
                    'strain_score': score.get('strain', 0),
                    'activity_name': self._get_sport_name(record.get('sport_id', 0)),
                    'duration_minutes': duration_minutes,
                    'average_heart_rate': score.get('average_heart_rate', 0),
                    'max_heart_rate': score.get('max_heart_rate', 0),
                    'kilojoules': score.get('kilojoule', 0),
                    'distance_meters': score.get('distance_meter', 0),
                    'started_at': record.get('start', ''),
                    'ended_at': record.get('end', ''),
                    'created_at': datetime.utcnow().isoformat()
                })
            
            if workout_events:
                await self.tinybird.ingest_events('whoop_workout_data', workout_events)
                print(f"📊 Ingested {len(workout_events)} workout records to Tinybird")
    
    def _get_sport_name(self, sport_id: int) -> str:
        """Map Whoop sport ID to name"""
        sport_map = {
            0: "Activity", 1: "Running", 2: "Cycling", 3: "Basketball",
            4: "Football", 5: "Soccer", 6: "Swimming", 7: "Gym",
            8: "Weightlifting", 9: "CrossFit", 10: "Yoga", 11: "Tennis",
            12: "Golf", 13: "Hiking", 14: "Rowing", 15: "Climbing"
        }
        return sport_map.get(sport_id, f"Sport {sport_id}")
    
    async def _sync_to_habit_logs(
        self,
        user_id: str,
        recovery_data: Optional[Dict[str, Any]] = None,
        sleep_data: Optional[Dict[str, Any]] = None,
        workout_data: Optional[Dict[str, Any]] = None,
        cycle_data: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Sync Whoop data to Turso database habit_logs for dashboard display
        Maps Whoop metrics to user's tracked Whoop habits
        """
        from database.models import HabitDB, HabitLogDB
        from sqlalchemy import select
        
        async with get_db_session() as session:
            try:
                # Get all user's Whoop habits
                result = await session.execute(
                    select(HabitDB)
                    .where(HabitDB.user_id == user_id)
                    .where(HabitDB.integration_source == 'whoop')
                )
                whoop_habits = result.scalars().all()
                
                if not whoop_habits:
                    print(f"ℹ️  No Whoop habits found for user {user_id}")
                    return
                
                print(f"📋 Found {len(whoop_habits)} Whoop habits to sync")
                
                # Map habit names to habit IDs for quick lookup
                habit_map = {habit.name.lower(): habit for habit in whoop_habits}
                
                # Map cycle IDs to dates (to handle post-midnight sleep starts correctly)
                cycle_date_map = {}
                if cycle_data and cycle_data.get('records'):
                    for cycle in cycle_data['records']:
                        # Whoop cycles have a 'days' array, usually with one date string 'YYYY-MM-DD'
                        days = cycle.get('days', [])
                        if days:
                            cycle_date_map[str(cycle.get('id'))] = days[0]
                
                logs_created = 0
                
                # Sync Sleep Duration
                if sleep_data and sleep_data.get('records'):
                    print(f"🛌 Processing {len(sleep_data['records'])} sleep records from Whoop API")
                    for sleep_habit_name in ['sleep duration', 'sleep', 'whoop sleep']:
                        if sleep_habit_name in habit_map:
                            habit = habit_map[sleep_habit_name]
                            print(f"✅ Found sleep habit: {habit.name} (id: {habit.id})")
                            
                            for record in sleep_data['records']:
                                score = record.get('score', {})
                                stage_summary = score.get('stage_summary', {})
                                
                                # Calculate ACTUAL sleep duration (not time in bed)
                                # Actual sleep = REM + Slow Wave + Light (excludes awake time)
                                rem_ms = stage_summary.get('total_rem_sleep_time_milli', 0)
                                slow_wave_ms = stage_summary.get('total_slow_wave_sleep_time_milli', 0)
                                light_ms = stage_summary.get('total_light_sleep_time_milli', 0)
                                
                                total_sleep_ms = rem_ms + slow_wave_ms + light_ms
                                total_sleep_minutes = total_sleep_ms // 60000
                                total_sleep_seconds = total_sleep_minutes * 60  # Convert to seconds for storage
                                
                                # Determine date: Use cycle date if available (handles post-midnight sleep), else start time
                                cycle_id = str(record.get('cycle_id', ''))
                                if cycle_id in cycle_date_map:
                                    sleep_date = cycle_date_map[cycle_id]
                                else:
                                    sleep_date = record.get('start', '')[:10]
                                    
                                sleep_start_full = record.get('start', '')
                                sleep_end_full = record.get('end', '')
                                
                                print(f"  🔍 Processing sleep: start={sleep_start_full}, end={sleep_end_full}, date={sleep_date}, duration={total_sleep_minutes}min")
                                
                                if not sleep_date or total_sleep_minutes == 0:
                                    print(f"  ⚠️  Skipping sleep record: date={sleep_date}, duration={total_sleep_minutes}min")
                                    continue
                                
                                # Check if log already exists for this date
                                existing_log = await session.execute(
                                    select(HabitLogDB)
                                    .where(HabitLogDB.habit_id == habit.id)
                                    .where(HabitLogDB.date == sleep_date)
                                )
                                existing = existing_log.scalar_one_or_none()
                                
                                if existing:
                                    # Prepare metadata with sleep timestamps
                                    metadata = {
                                        'sleep_id': record.get('id'),
                                        'sleep_onset': record.get('start'),  # Sleep start time
                                        'sleep_end': record.get('end')  # Sleep end time
                                    }
                                    metadata_json = json.dumps(metadata)
                                    
                                    # Update existing log
                                    existing.duration = total_sleep_seconds
                                    existing.completed_at = record.get('end', '')
                                    existing.notes = f"Synced from Whoop (Sleep Performance: {score.get('sleep_performance_percentage', 0)}%)"
                                    existing.log_metadata = metadata_json  # Note: using log_metadata in SQLAlchemy
                                    print(f"🔄 Updated sleep log for {sleep_date}: {total_sleep_minutes} minutes")
                                    
                                    # Sync to Tinybird
                                    if self.tinybird_enabled:
                                        try:
                                            await self.tinybird.ingest_habit_log({
                                                'id': existing.id,
                                                'habit_id': existing.habit_id,
                                                'habit_name': habit.name,
                                                'user_id': user_id,
                                                'date': existing.date,
                                                'duration': existing.duration,
                                                'amount': existing.amount,
                                                'unit': habit.unit_type,
                                                'status': existing.status,
                                                'notes': existing.notes,
                                                'completed_at': existing.completed_at,
                                                'source': 'whoop',
                                                'metadata': metadata_json
                                            })
                                        except Exception as tb_error:
                                            print(f"⚠️  Tinybird sync failed for sleep log (non-fatal): {str(tb_error)}")
                                else:
                                    # Prepare metadata with sleep timestamps
                                    metadata = {
                                        'sleep_id': record.get('id'),
                                        'sleep_onset': record.get('start'),  # Sleep start time
                                        'sleep_end': record.get('end')  # Sleep end time
                                    }
                                    metadata_json = json.dumps(metadata)
                                    
                                    # Create new log
                                    new_log = HabitLogDB(
                                        id=str(uuid.uuid4()),
                                        habit_id=habit.id,
                                        habit_name=habit.name,  # Denormalized for performance
                                        duration=total_sleep_seconds,
                                        amount=None,
                                        date=sleep_date,
                                        completed_at=record.get('end', ''),
                                        status='completed',
                                        notes=f"Synced from Whoop (Sleep Performance: {score.get('sleep_performance_percentage', 0)}%)",
                                        log_metadata=metadata_json  # Note: using log_metadata in SQLAlchemy
                                    )
                                    session.add(new_log)
                                    # Flush to make this log visible for duplicate detection in same transaction
                                    await session.flush()
                                    logs_created += 1
                                    print(f"✅ Created sleep log for {sleep_date}: {total_sleep_minutes} minutes")
                                    
                                    # Sync to Tinybird
                                    if self.tinybird_enabled:
                                        try:
                                            await self.tinybird.ingest_habit_log({
                                                'id': new_log.id,
                                                'habit_id': new_log.habit_id,
                                                'habit_name': habit.name,
                                                'user_id': user_id,
                                                'date': new_log.date,
                                                'duration': new_log.duration,
                                                'amount': new_log.amount,
                                                'unit': habit.unit_type,
                                                'status': new_log.status,
                                                'notes': new_log.notes,
                                                'completed_at': new_log.completed_at,
                                                'source': 'whoop',
                                                'metadata': metadata_json
                                            })
                                        except Exception as tb_error:
                                            print(f"⚠️  Tinybird sync failed for sleep log (non-fatal): {str(tb_error)}")
                            
                            break  # Only process one sleep habit
                
                # Sync Recovery Score
                if recovery_data and recovery_data.get('records'):
                    for recovery_habit_name in ['recovery score', 'recovery', 'whoop recovery']:
                        if recovery_habit_name in habit_map:
                            habit = habit_map[recovery_habit_name]
                            
                            for record in recovery_data['records']:
                                score = record.get('score', {})
                                recovery_score = score.get('recovery_score', 0)
                                
                                # Extract date
                                recovery_date = record.get('created_at', '')[:10]
                                
                                if not recovery_date or recovery_score == 0:
                                    continue
                                
                                # Check if log already exists
                                existing_log = await session.execute(
                                    select(HabitLogDB)
                                    .where(HabitLogDB.habit_id == habit.id)
                                    .where(HabitLogDB.date == recovery_date)
                                )
                                existing = existing_log.scalar_one_or_none()
                                
                                if existing:
                                    existing.amount = recovery_score
                                    existing.completed_at = record.get('created_at', '')
                                    existing.notes = f"Synced from Whoop (HRV: {score.get('hrv_rmssd_milli', 0)}ms, RHR: {score.get('resting_heart_rate', 0)}bpm)"
                                else:
                                    new_log = HabitLogDB(
                                        id=str(uuid.uuid4()),
                                        habit_id=habit.id,
                                        habit_name=habit.name,  # Denormalized for performance
                                        duration=None,
                                        amount=recovery_score,
                                        date=recovery_date,
                                        completed_at=record.get('created_at', ''),
                                        status='completed',
                                        notes=f"Synced from Whoop (HRV: {score.get('hrv_rmssd_milli', 0)}ms, RHR: {score.get('resting_heart_rate', 0)}bpm)"
                                    )
                                    session.add(new_log)
                                    await session.flush()  # Prevent duplicates in same transaction
                                    logs_created += 1
                            
                            break
                
                # Sync Daily Strain
                if workout_data and workout_data.get('records'):
                    for strain_habit_name in ['daily strain', 'strain', 'whoop strain']:
                        if strain_habit_name in habit_map:
                            habit = habit_map[strain_habit_name]
                            
                            for record in workout_data['records']:
                                score = record.get('score', {})
                                strain_score = score.get('strain', 0)
                                
                                workout_date = record.get('start', '')[:10]
                                
                                if not workout_date or strain_score == 0:
                                    continue
                                
                                # Check if log already exists
                                existing_log = await session.execute(
                                    select(HabitLogDB)
                                    .where(HabitLogDB.habit_id == habit.id)
                                    .where(HabitLogDB.date == workout_date)
                                )
                                existing = existing_log.scalar_one_or_none()
                                
                                if existing:
                                    existing.amount = strain_score
                                    existing.completed_at = record.get('end', '')
                                else:
                                    new_log = HabitLogDB(
                                        id=str(uuid.uuid4()),
                                        habit_id=habit.id,
                                        habit_name=habit.name,  # Denormalized for performance
                                        duration=None,
                                        amount=strain_score,
                                        date=workout_date,
                                        completed_at=record.get('end', ''),
                                        status='completed',
                                        notes=f"Synced from Whoop ({self._get_sport_name(record.get('sport_id', 0))})"
                                    )
                                    session.add(new_log)
                                    await session.flush()  # Prevent duplicates in same transaction
                                    logs_created += 1
                            
                            break
                
                # NOTE: WHOOP API does not provide step count data
                # Steps tracking should be done manually or via other integrations (Apple Watch, Fitbit)
                # Commit all changes
                await session.commit()
                print(f"💾 Created {logs_created} new habit logs in Turso database")
                
            except Exception as e:
                await session.rollback()
                print(f"❌ Error syncing to habit_logs: {str(e)}")
                raise
