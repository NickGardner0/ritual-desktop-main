"""
Tesla Fleet API integration service.

Handles OAuth token exchange, token refresh, and odometer-based
mileage tracking for Tesla vehicles.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import select, update

from database.connection import get_db_session
from database.models import WearableConnectionDB
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)

TESLA_AUTH_BASE = "https://auth.tesla.com"
TESLA_API_BASE = "https://fleet-api.prd.na.vn.cloud.tesla.com"

PROVIDER = "tesla"


class TeslaService:
    """Service for Tesla Fleet API integration."""

    def __init__(self) -> None:
        self.client_id = os.getenv("TESLA_CLIENT_ID", "")
        self.client_secret = os.getenv("TESLA_CLIENT_SECRET", "")
        self.redirect_uri = os.getenv(
            "TESLA_REDIRECT_URI",
            "https://ritualdb.com/api/integrations/tesla/callback",
        )

    # ── OAuth ─────────────────────────────────────────────

    async def exchange_code_for_token(self, code: str) -> Dict[str, Any]:
        """Exchange an authorization code for access + refresh tokens."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{TESLA_AUTH_BASE}/oauth2/v3/token",
                json={
                    "grant_type": "authorization_code",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "redirect_uri": self.redirect_uri,
                    "audience": TESLA_API_BASE,
                },
            )
            if resp.status_code != 200:
                logger.error("Tesla token exchange failed: %s %s", resp.status_code, resp.text)
                raise RuntimeError(f"Tesla token exchange failed ({resp.status_code})")
            return resp.json()

    async def refresh_access_token(self, refresh_token_encrypted: str) -> Dict[str, Any]:
        """Refresh an expired access token."""
        refresh_token = token_crypto.decrypt(refresh_token_encrypted)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{TESLA_AUTH_BASE}/oauth2/v3/token",
                json={
                    "grant_type": "refresh_token",
                    "client_id": self.client_id,
                    "refresh_token": refresh_token,
                },
            )
            if resp.status_code != 200:
                logger.error("Tesla token refresh failed: %s %s", resp.status_code, resp.text)
                raise RuntimeError(f"Tesla token refresh failed ({resp.status_code})")
            return resp.json()

    # ── Connection persistence ────────────────────────────

    async def save_connection(
        self,
        user_id: str,
        access_token: str,
        refresh_token: Optional[str],
        expires_in: int,
    ) -> WearableConnectionDB:
        """Create or update the Tesla WearableConnectionDB row."""
        encrypted_access = token_crypto.encrypt(access_token)
        encrypted_refresh = token_crypto.encrypt(refresh_token) if refresh_token else None
        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == PROVIDER,
                )
            )
            conn = result.scalar_one_or_none()

            if conn:
                conn.access_token = encrypted_access
                conn.refresh_token = encrypted_refresh or conn.refresh_token
                conn.token_expires_at = expires_at
                conn.status = "active"
                conn.updated_at = datetime.utcnow()
            else:
                conn = WearableConnectionDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    provider=PROVIDER,
                    auth_method="oauth",
                    status="active",
                    access_token=encrypted_access,
                    refresh_token=encrypted_refresh,
                    token_expires_at=expires_at,
                    scopes_json=json.dumps(["vehicle_device_data"]),
                    settings_json=json.dumps({"auto_sync_enabled": True}),
                )
                session.add(conn)

            await session.commit()
            await session.refresh(conn)
            return conn

    async def get_valid_access_token(self, user_id: str) -> str:
        """Return a valid access token, refreshing if needed."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == PROVIDER,
                    WearableConnectionDB.status == "active",
                )
            )
            conn = result.scalar_one_or_none()

        if not conn:
            raise RuntimeError("No active Tesla connection found")

        # Refresh if token expires within 5 minutes
        if conn.token_expires_at and conn.token_expires_at < datetime.utcnow() + timedelta(minutes=5):
            if not conn.refresh_token:
                raise RuntimeError("Tesla token expired and no refresh token available")
            token_data = await self.refresh_access_token(conn.refresh_token)
            await self.save_connection(
                user_id=user_id,
                access_token=token_data["access_token"],
                refresh_token=token_data.get("refresh_token"),
                expires_in=token_data.get("expires_in", 28800),
            )
            return token_data["access_token"]

        return token_crypto.decrypt(conn.access_token)

    async def get_connection_status(self, user_id: str) -> Dict[str, Any]:
        """Return connection status for the frontend."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == PROVIDER,
                )
            )
            conn = result.scalar_one_or_none()

        if not conn or conn.status != "active":
            return {"connected": False}

        settings = json.loads(conn.settings_json or "{}")
        return {
            "connected": True,
            "last_sync_at": conn.last_sync_at.isoformat() if conn.last_sync_at else None,
            "connected_at": conn.created_at.isoformat() if conn.created_at else None,
            "vehicles": settings.get("vehicles", []),
        }

    async def disconnect(self, user_id: str) -> None:
        """Revoke the Tesla connection."""
        async with get_db_session() as session:
            await session.execute(
                update(WearableConnectionDB)
                .where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == PROVIDER,
                )
                .values(status="revoked", updated_at=datetime.utcnow())
            )
            await session.commit()

    # ── Fleet API helpers ─────────────────────────────────

    async def _api_get(self, access_token: str, path: str) -> Any:
        """Make an authenticated GET to the Tesla Fleet API."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{TESLA_API_BASE}{path}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if resp.status_code == 401:
                raise RuntimeError("Tesla API: unauthorized (token may be expired)")
            if resp.status_code != 200:
                logger.error("Tesla API error %s %s: %s", resp.status_code, path, resp.text)
                raise RuntimeError(f"Tesla API error ({resp.status_code})")
            return resp.json()

    async def list_vehicles(self, access_token: str) -> List[Dict[str, Any]]:
        """List all vehicles on the account."""
        data = await self._api_get(access_token, "/api/1/vehicles")
        return data.get("response", [])

    async def get_vehicle_data(self, access_token: str, vehicle_id: str) -> Dict[str, Any]:
        """Get vehicle data including odometer."""
        data = await self._api_get(
            access_token,
            f"/api/1/vehicles/{vehicle_id}/vehicle_data?endpoints=vehicle_state",
        )
        return data.get("response", {})

    # ── Odometer sync ─────────────────────────────────────

    async def sync_odometer(self, user_id: str) -> Dict[str, Any]:
        """
        Read odometer for each vehicle and compute miles driven since last sync.
        Stores the delta as habit log entries.
        """
        access_token = await self.get_valid_access_token(user_id)
        vehicles = await self.list_vehicles(access_token)

        if not vehicles:
            return {"synced": 0, "message": "No vehicles found on Tesla account"}

        # Load previous odometer readings from settings
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == PROVIDER,
                )
            )
            conn = result.scalar_one_or_none()

        if not conn:
            return {"synced": 0, "message": "No Tesla connection found"}

        settings = json.loads(conn.settings_json or "{}")
        odometer_history: Dict[str, float] = settings.get("odometer_readings", {})
        vehicle_names: Dict[str, str] = settings.get("vehicle_names", {})
        total_miles_logged = 0
        synced_vehicles = 0

        for vehicle in vehicles:
            vid = str(vehicle.get("id") or vehicle.get("id_s", ""))
            display_name = vehicle.get("display_name", "Tesla")

            try:
                vdata = await self.get_vehicle_data(access_token, vid)
                vehicle_state = vdata.get("vehicle_state", {})
                current_odometer = vehicle_state.get("odometer")

                if current_odometer is None:
                    logger.warning("No odometer data for vehicle %s", vid)
                    continue

                vehicle_names[vid] = display_name
                previous_odometer = odometer_history.get(vid)
                odometer_history[vid] = current_odometer

                if previous_odometer is not None:
                    miles_driven = current_odometer - previous_odometer
                    if miles_driven > 0:
                        await self._log_miles_driven(user_id, miles_driven, display_name)
                        total_miles_logged += miles_driven

                synced_vehicles += 1

            except Exception as e:
                logger.error("Failed to sync vehicle %s: %s", vid, e)
                continue

        # Persist updated odometer readings and vehicle list
        settings["odometer_readings"] = odometer_history
        settings["vehicle_names"] = vehicle_names
        settings["vehicles"] = [
            {"id": str(v.get("id") or v.get("id_s", "")), "name": v.get("display_name", "Tesla")}
            for v in vehicles
        ]

        async with get_db_session() as session:
            await session.execute(
                update(WearableConnectionDB)
                .where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == PROVIDER,
                )
                .values(
                    settings_json=json.dumps(settings),
                    last_sync_at=datetime.utcnow(),
                    last_successful_sync_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
            )
            await session.commit()

        return {
            "synced": synced_vehicles,
            "total_vehicles": len(vehicles),
            "miles_logged": round(total_miles_logged, 1),
        }

    async def _log_miles_driven(self, user_id: str, miles: float, vehicle_name: str) -> None:
        """Create a habit log entry for miles driven."""
        from database.models import HabitDB, HabitLogDB

        today = datetime.utcnow().strftime("%Y-%m-%d")

        async with get_db_session() as session:
            # Find or create the "Miles Driven" habit
            result = await session.execute(
                select(HabitDB).where(
                    HabitDB.user_id == user_id,
                    HabitDB.name == "Miles Driven",
                )
            )
            habit = result.scalar_one_or_none()

            if not habit:
                habit = HabitDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    name="Miles Driven",
                    category="Activity",
                    unit_type="Miles",
                    integration_source="tesla",
                    icon="🚗",
                )
                session.add(habit)
                await session.flush()

            log = HabitLogDB(
                id=str(uuid.uuid4()),
                habit_id=habit.id,
                habit_name="Miles Driven",
                date=today,
                amount=round(miles, 1),
                status="completed",
                completed_at=datetime.utcnow().isoformat(),
                source="integration",
                notes=f"Via {vehicle_name}",
            )
            session.add(log)
            await session.commit()

        logger.info("Logged %.1f miles driven for user %s", miles, user_id)

    # ── Backfill ──────────────────────────────────────────

    async def backfill_from_odometer(
        self,
        user_id: str,
        previous_odometer: float,
        as_of_date: str,
    ) -> Dict[str, Any]:
        """
        Given a user-supplied past odometer reading and date, compute miles
        driven between then and the current stored odometer, and create a
        single backfill habit log for the total.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == PROVIDER,
                    WearableConnectionDB.status == "active",
                )
            )
            conn = result.scalar_one_or_none()

        if not conn:
            raise RuntimeError("No active Tesla connection found")

        settings = json.loads(conn.settings_json or "{}")
        odometer_history = settings.get("odometer_readings", {})

        if not odometer_history:
            # No current reading yet — take a live reading first
            access_token = await self.get_valid_access_token(user_id)
            vehicles = await self.list_vehicles(access_token)
            if not vehicles:
                raise RuntimeError("No vehicles found on Tesla account")

            # Use the first vehicle
            vehicle = vehicles[0]
            vid = str(vehicle.get("id") or vehicle.get("id_s", ""))
            vdata = await self.get_vehicle_data(access_token, vid)
            current_odometer = vdata.get("vehicle_state", {}).get("odometer")
            if current_odometer is None:
                raise RuntimeError("Could not read current odometer")

            odometer_history[vid] = current_odometer
            settings["odometer_readings"] = odometer_history
            settings["vehicle_names"] = settings.get("vehicle_names", {})
            settings["vehicle_names"][vid] = vehicle.get("display_name", "Tesla")

            async with get_db_session() as session:
                await session.execute(
                    update(WearableConnectionDB)
                    .where(
                        WearableConnectionDB.user_id == user_id,
                        WearableConnectionDB.provider == PROVIDER,
                    )
                    .values(settings_json=json.dumps(settings), updated_at=datetime.utcnow())
                )
                await session.commit()

        # Use the first vehicle's current odometer
        vid = next(iter(odometer_history))
        current_odometer = odometer_history[vid]
        vehicle_name = settings.get("vehicle_names", {}).get(vid, "Tesla")

        if previous_odometer >= current_odometer:
            raise RuntimeError(
                f"Previous odometer ({previous_odometer:.0f}) must be less than "
                f"current odometer ({current_odometer:.0f})"
            )

        total_miles = current_odometer - previous_odometer

        # Compute days between as_of_date and today
        from_date = datetime.strptime(as_of_date, "%Y-%m-%d")
        to_date = datetime.utcnow()
        total_days = max((to_date - from_date).days, 1)

        # Distribute miles evenly across days as individual log entries
        daily_miles = total_miles / total_days

        from database.models import HabitDB, HabitLogDB

        async with get_db_session() as session:
            # Find or create the Miles Driven habit
            result = await session.execute(
                select(HabitDB).where(
                    HabitDB.user_id == user_id,
                    HabitDB.name == "Miles Driven",
                )
            )
            habit = result.scalar_one_or_none()

            if not habit:
                habit = HabitDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    name="Miles Driven",
                    category="Activity",
                    unit_type="Miles",
                    integration_source="tesla",
                    icon="🚗",
                )
                session.add(habit)
                await session.flush()

            logs_created = 0
            for day_offset in range(total_days):
                log_date = from_date + timedelta(days=day_offset)
                date_str = log_date.strftime("%Y-%m-%d")

                # Skip if a log already exists for this date
                existing = await session.execute(
                    select(HabitLogDB).where(
                        HabitLogDB.habit_id == habit.id,
                        HabitLogDB.date == date_str,
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                log = HabitLogDB(
                    id=str(uuid.uuid4()),
                    habit_id=habit.id,
                    habit_name="Miles Driven",
                    date=date_str,
                    amount=round(daily_miles, 1),
                    status="completed",
                    completed_at=log_date.replace(hour=20, minute=0).isoformat(),
                    source="integration",
                    notes=f"Backfill via {vehicle_name}",
                )
                session.add(log)
                logs_created += 1

            await session.commit()

        logger.info(
            "Backfilled %d days (%.0f total miles) for user %s",
            logs_created,
            total_miles,
            user_id,
        )

        return {
            "status": "success",
            "total_miles": round(total_miles, 1),
            "daily_average": round(daily_miles, 1),
            "days_backfilled": logs_created,
            "from_date": as_of_date,
            "to_date": to_date.strftime("%Y-%m-%d"),
        }
