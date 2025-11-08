"""
Whoop Integration Service
Handles OAuth and data sync with Whoop API
"""

import os
import uuid
import httpx
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError

from database.models import WhoopIntegrationDB
from database.connection import get_db_session
from services.tinybird_service import TinybirdService

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
    
    async def exchange_code_for_token(self, code: str) -> Dict[str, Any]:
        """Exchange OAuth authorization code for access token"""
        if not self.client_id or not self.client_secret or not self.redirect_uri:
            raise Exception("Whoop OAuth configuration missing")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.WHOOP_TOKEN_URL,
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
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.WHOOP_API_BASE}/developer/v1/user/profile/basic",
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
                    integration.access_token = access_token
                    integration.refresh_token = refresh_token
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
                        access_token=access_token,
                        refresh_token=refresh_token,
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
                return result.scalar_one_or_none()
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
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.WHOOP_TOKEN_URL,
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
                        'access_token': new_access_token,
                        'token_expires_at': datetime.utcnow() + timedelta(seconds=new_expires_in)
                    }
                    
                    # Update refresh token if a new one was provided
                    if new_refresh_token:
                        update_values['refresh_token'] = new_refresh_token
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
    
    async def sync_whoop_data(self, user_id: str, days_back: int = 7) -> Dict[str, Any]:
        """
        Sync data from Whoop API
        This is a simplified version - you can expand it based on your needs
        """
        access_token = await self.get_valid_access_token(user_id)
        
        if not access_token:
            raise Exception("Whoop integration not found or token invalid")
        
        synced_data = {
            "recovery": 0,
            "sleep": 0,
            "workouts": 0,
            "cycles": 0  # Daily metrics including steps
        }
        
        # Calculate date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days_back)
        
        async with httpx.AsyncClient() as client:
            try:
                # Fetch recovery data (v1 API - v2 not available yet)
                recovery_response = await client.get(
                    f"{self.WHOOP_API_BASE}/developer/v1/recovery",
                    headers={'Authorization': f'Bearer {access_token}'},
                    params={
                        'start': start_date.isoformat() + 'Z',
                        'end': end_date.isoformat() + 'Z'
                    }
                )
                
                if recovery_response.is_success:
                    recovery_data = recovery_response.json()
                    synced_data["recovery"] = len(recovery_data.get('records', []))
                    print(f"✅ Synced {synced_data['recovery']} recovery records")
                
                # Fetch sleep data (v1 API - v2 not available for all apps yet)
                # Note: According to Whoop API docs, start/end filter by the END time of the sleep session
                print(f"🔍 Fetching sleep data from {start_date.isoformat()}Z to {end_date.isoformat()}Z")
                sleep_response = await client.get(
                    f"{self.WHOOP_API_BASE}/developer/v1/activity/sleep",
                    headers={'Authorization': f'Bearer {access_token}'},
                    params={
                        'start': start_date.isoformat() + 'Z',
                        'end': end_date.isoformat() + 'Z',
                        'limit': 25
                    }
                )
                
                if sleep_response.is_success:
                    sleep_data = sleep_response.json()
                    synced_data["sleep"] = len(sleep_data.get('records', []))
                    print(f"✅ Fetched {synced_data['sleep']} sleep records from Whoop API")
                    
                    # Debug: Print details of each sleep record
                    for record in sleep_data.get('records', []):
                        sleep_start = record.get('start', 'N/A')
                        sleep_end = record.get('end', 'N/A')
                        sleep_date = sleep_start[:10] if sleep_start != 'N/A' else 'N/A'
                        total_ms = record.get('score', {}).get('stage_summary', {}).get('total_in_bed_time_milli', 0)
                        total_hours = round(total_ms / 3600000, 2)
                        print(f"  📊 Sleep: date={sleep_date}, start={sleep_start}, end={sleep_end}, duration={total_hours}h")
                else:
                    print(f"❌ Failed to fetch sleep data: {sleep_response.status_code} - {sleep_response.text}")
                
                # Fetch workout data (v1 API - v2 not available yet)
                workout_response = await client.get(
                    f"{self.WHOOP_API_BASE}/developer/v1/activity/workout",
                    headers={'Authorization': f'Bearer {access_token}'},
                    params={
                        'start': start_date.isoformat() + 'Z',
                        'end': end_date.isoformat() + 'Z'
                    }
                )
                
                if workout_response.is_success:
                    workout_data = workout_response.json()
                    synced_data["workouts"] = len(workout_data.get('records', []))
                    print(f"✅ Synced {synced_data['workouts']} workout records")
                
                # Fetch cycle data (v1 API - includes daily metrics)
                cycle_response = await client.get(
                    f"{self.WHOOP_API_BASE}/developer/v1/cycle",
                    headers={'Authorization': f'Bearer {access_token}'},
                    params={
                        'start': start_date.isoformat() + 'Z',
                        'end': end_date.isoformat() + 'Z'
                    }
                )
                
                if cycle_response.is_success:
                    cycle_data = cycle_response.json()
                    synced_data["cycles"] = len(cycle_data.get('records', []))
                    print(f"✅ Synced {synced_data['cycles']} cycle records (daily metrics)")
                    
                    # Check if cycle records contain sleep data or sleep IDs
                    if cycle_data.get('records'):
                        sample = cycle_data['records'][0]
                        print(f"🔍 Cycle record sample keys: {list(sample.keys())}")
                        print(f"🔍 Cycle record sample: {sample}")
                
                # Store data in Tinybird for analytics
                if self.tinybird_enabled:
                    try:
                        await self._ingest_to_tinybird(
                            user_id=user_id,
                            recovery_data=recovery_data if recovery_response.is_success else None,
                            sleep_data=sleep_data if sleep_response.is_success else None,
                            workout_data=workout_data if workout_response.is_success else None,
                            cycle_data=cycle_data if cycle_response.is_success else None
                        )
                        print(f"✅ Whoop data synced to Tinybird for analytics")
                    except Exception as tb_error:
                        print(f"⚠️  Tinybird ingestion failed (non-fatal): {str(tb_error)}")
                
                # Store data in Turso database for dashboard display
                try:
                    await self._sync_to_habit_logs(
                        user_id=user_id,
                        recovery_data=recovery_data if recovery_response.is_success else None,
                        sleep_data=sleep_data if sleep_response.is_success else None,
                        workout_data=workout_data if workout_response.is_success else None,
                        cycle_data=cycle_data if cycle_response.is_success else None
                    )
                    print(f"✅ Whoop data synced to Turso habit_logs for dashboard")
                except Exception as db_error:
                    print(f"⚠️  Database sync failed (non-fatal): {str(db_error)}")
                
            except Exception as e:
                print(f"⚠️  Error fetching Whoop data: {str(e)}")
        
        # Update last sync time
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
        
        return {
            "status": "success",
            "synced_at": datetime.utcnow().isoformat(),
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
                recovery_events.append({
                    'id': str(uuid.uuid4()),
                    'user_id': user_id,
                    'whoop_connection_id': whoop_connection_id,
                    'cycle_id': str(record.get('cycle_id', '')),
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
                
                sleep_events.append({
                    'id': str(uuid.uuid4()),
                    'user_id': user_id,
                    'whoop_connection_id': whoop_connection_id,
                    'sleep_id': str(record.get('id', '')),
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
                
                workout_events.append({
                    'id': str(uuid.uuid4()),
                    'user_id': user_id,
                    'whoop_connection_id': whoop_connection_id,
                    'workout_id': str(record.get('id', '')),
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
                                
                                # Get total sleep duration in minutes
                                total_sleep_ms = stage_summary.get('total_in_bed_time_milli', 0)
                                total_sleep_minutes = total_sleep_ms // 60000
                                total_sleep_seconds = total_sleep_minutes * 60  # Convert to seconds for storage
                                
                                # Extract date from sleep start time
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
                                    # Update existing log
                                    existing.duration = total_sleep_seconds
                                    existing.completed_at = record.get('end', '')
                                    existing.notes = f"Synced from Whoop (Sleep Performance: {score.get('sleep_performance_percentage', 0)}%)"
                                    print(f"🔄 Updated sleep log for {sleep_date}: {total_sleep_minutes} minutes")
                                else:
                                    # Create new log
                                    new_log = HabitLogDB(
                                        id=str(uuid.uuid4()),
                                        habit_id=habit.id,
                                        duration=total_sleep_seconds,
                                        amount=None,
                                        date=sleep_date,
                                        completed_at=record.get('end', ''),
                                        status='completed',
                                        notes=f"Synced from Whoop (Sleep Performance: {score.get('sleep_performance_percentage', 0)}%)"
                                    )
                                    session.add(new_log)
                                    logs_created += 1
                                    print(f"✅ Created sleep log for {sleep_date}: {total_sleep_minutes} minutes")
                            
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
                                        duration=None,
                                        amount=recovery_score,
                                        date=recovery_date,
                                        completed_at=record.get('created_at', ''),
                                        status='completed',
                                        notes=f"Synced from Whoop (HRV: {score.get('hrv_rmssd_milli', 0)}ms, RHR: {score.get('resting_heart_rate', 0)}bpm)"
                                    )
                                    session.add(new_log)
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
                                        duration=None,
                                        amount=strain_score,
                                        date=workout_date,
                                        completed_at=record.get('end', ''),
                                        status='completed',
                                        notes=f"Synced from Whoop ({self._get_sport_name(record.get('sport_id', 0))})"
                                    )
                                    session.add(new_log)
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

