"""
Ritual FastAPI Backend
Mirrors the current TypeScript habits-service.ts interface exactly
"""

from fastapi import FastAPI, HTTPException, Depends, status, Header, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
from datetime import datetime
import asyncio
import httpx
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables FIRST before importing services
load_dotenv()

# Import our services
from services.habits_service import HabitsService
from services.auth_service import AuthService
from services.tinybird_service import TinybirdService
from services.whoop_service import WhoopService
from services.user_service import UserService
from services.screenshot_analyzer import analyze_screenshot_for_habits
from models.habit_models import Habit, HabitLog, HabitCreate, HabitUpdate, HabitLogCreate
from models.user_models import OnboardingData, UserProfile
from database.connection import get_db_session
from database.models import WhoopIntegrationDB
from database.helpers import user_db_to_profile, parse_json_field
from sqlalchemy import select
import json

app = FastAPI(title="Ritual Backend API", version="1.0.0")

# Rate limiting setup
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware to allow frontend requests
# For development
ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,https://localhost:3000,tauri://localhost"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Security
security = HTTPBearer()

# Initialize services
habits_service = HabitsService()
auth_service = AuthService()
tinybird_service = TinybirdService()
whoop_service = WhoopService()
user_service = UserService()

# Dependency to get current user from JWT token
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Extract user from JWT token - mirrors Supabase auth"""
    try:
        user = await auth_service.get_user_from_token(credentials.credentials)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
        return user
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

@app.get("/")
async def root():
    return {"message": "Ritual Backend API", "status": "running"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ================================
# USER ENDPOINTS - Profile and Onboarding
# ================================

@app.get("/api/user/profile", response_model=UserProfile)
async def get_user_profile(current_user = Depends(get_current_user)):
    """
    Get current user's profile
    """
    try:
        print(f"📋 Fetching profile for user: {current_user['id']}")
        
        # Ensure user exists in database
        user = await user_service.ensure_user_exists(
            user_id=current_user["id"],
            email=current_user["email"],
            full_name=current_user.get("name")
        )
        
        print(f"✅ User found/created: {user.email}")
        return user_db_to_profile(user)
    except Exception as e:
        print(f"❌ Error getting user profile: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/user/onboarding", response_model=UserProfile)
async def update_onboarding(
    onboarding_data: OnboardingData, 
    current_user = Depends(get_current_user)
):
    """
    Update user profile with onboarding data
    """
    try:
        print(f"📝 Updating onboarding for user {current_user['id']}")
        
        # Ensure user exists first
        await user_service.ensure_user_exists(
            user_id=current_user["id"],
            email=current_user["email"],
            full_name=current_user.get("name")
        )
        
        # Update onboarding data
        user = await user_service.update_onboarding(
            user_id=current_user["id"],
            name=onboarding_data.name,
            age_bracket=onboarding_data.age_bracket,
            gender=onboarding_data.gender,
            country=onboarding_data.country,
            tracking_interests=onboarding_data.tracking_interests,
            wearable_devices=onboarding_data.wearable_devices
        )
        
        print(f"✅ Onboarding updated successfully for user {current_user['id']}")
        return user_db_to_profile(user)
    except Exception as e:
        print(f"❌ Error updating onboarding: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# HABITS ENDPOINTS - Mirror TypeScript interface exactly
# ================================

@app.post("/api/habits", response_model=Habit)
@limiter.limit("10/minute")  # Max 10 habit creations per minute
async def create_habit(habit_data: HabitCreate, request: Request, current_user = Depends(get_current_user)):
    """
    Create a new habit - mirrors habitsService.createHabit()
    """
    try:
        habit = await habits_service.create_habit(habit_data, current_user["id"])
        
        # Dual write: also write to Tinybird for analytics
        await tinybird_service.ingest_habit_definition(habit)
        
        return habit
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/habits", response_model=List[Habit])
@limiter.limit("30/minute")  # Max 30 habit fetches per minute
async def get_habits(
    request: Request,
    current_user = Depends(get_current_user)
):
    """
    Get all habits for current user - mirrors habitsService.getHabits()
    """
    try:
        habits = await habits_service.get_habits(current_user["id"])
        return habits
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/habits/aliases")
async def get_all_habit_aliases(current_user = Depends(get_current_user)):
    """
    Phase 5A: Get all aliases for all habits owned by the user.
    Returns a dict mapping habit_id -> [aliases]
    """
    try:
        aliases_map = await habits_service.get_all_aliases_for_user(current_user["id"])
        return aliases_map
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/habits/{habit_id}/aliases")
async def add_habit_alias(
    habit_id: str,
    alias_text: str,
    current_user = Depends(get_current_user)
):
    """
    Phase 5A: Add an alias to a habit.
    """
    try:
        success = await habits_service.add_habit_alias(habit_id, alias_text, current_user["id"])
        if not success:
            raise HTTPException(status_code=404, detail="Habit not found or alias could not be added")
        return {"success": True, "alias": alias_text.lower().strip()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/habits/{habit_id}/generate-aliases")
async def generate_habit_aliases(
    habit_id: str,
    current_user = Depends(get_current_user)
):
    """
    Phase 5A: Auto-generate aliases for a habit from its name and synonyms.
    """
    try:
        count = await habits_service.ensure_habit_aliases(habit_id, current_user["id"])
        return {"success": True, "aliases_added": count}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/habits/{habit_id}", response_model=Habit)
async def update_habit(habit_id: str, updates: HabitUpdate, current_user = Depends(get_current_user)):
    """
    Update a habit - mirrors habitsService.updateHabit()
    """
    try:
        habit = await habits_service.update_habit(habit_id, updates, current_user["id"])
        
        # Update in Tinybird as well
        await tinybird_service.update_habit_definition(habit)
        
        return habit
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/habits/{habit_id}")
async def delete_habit(habit_id: str, current_user = Depends(get_current_user)):
    """
    Delete a habit - mirrors habitsService.deleteHabit()
    """
    try:
        await habits_service.delete_habit(habit_id, current_user["id"])
        return {"message": "Habit deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ================================
# HABIT LOGS ENDPOINTS
# ================================

@app.post("/api/habits/{habit_id}/logs", response_model=HabitLog)
@limiter.limit("60/minute")  # Max 60 log entries per minute
async def log_habit(habit_id: str, log_data: HabitLogCreate, request: Request, current_user = Depends(get_current_user)):
    """
    Log a habit completion - mirrors habitsService.logHabit()
    """
    try:
        # Get habit details for the log
        habit = await habits_service.get_habit_by_id(habit_id, current_user["id"])
        if not habit:
            raise HTTPException(status_code=404, detail="Habit not found")
        
        # Create the log (Tinybird sync happens automatically in the service)
        habit_log = await habits_service.log_habit(habit_id, log_data, current_user["id"])
        
        return habit_log
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/habits/{habit_id}/logs", response_model=List[HabitLog])
async def get_habit_logs(habit_id: str, current_user = Depends(get_current_user)):
    """
    Get habit logs - mirrors habitsService.getHabitLogs()
    """
    try:
        logs = await habits_service.get_habit_logs(habit_id, current_user["id"])
        return logs
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/habit-logs", response_model=List[HabitLog])
async def get_all_habit_logs(current_user = Depends(get_current_user)):
    """
    Get all habit logs for user - mirrors habitsService.getHabitLogs()
    """
    try:
        logs = await habits_service.get_habit_logs(None, current_user["id"])
        return logs
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ================================
# PHASE 5A: BATCH LOGGING ENDPOINT
# ================================

class BatchLogItem(BaseModel):
    habit_id: str
    date: str  # YYYY-MM-DD
    amount: Optional[float] = None
    duration: Optional[int] = None  # in seconds
    unit: Optional[str] = None
    source: str = "ai_log_v2"
    notes: Optional[str] = None
    completed_at: Optional[str] = None

class BatchLogRequest(BaseModel):
    items: List[BatchLogItem]
    client_event_id: Optional[str] = None  # For idempotency

@app.post("/api/logs/batch")
@limiter.limit("30/minute")  # Max 30 batch log requests per minute
async def batch_log_habits(
    request: Request,
    batch_request: BatchLogRequest,
    current_user = Depends(get_current_user)
):
    """
    Phase 5A: Batch log multiple habits at once.
    Supports multi-intent logging from natural language parsing.
    
    Returns per-item success/error results for reliability.
    Uses client_event_id for idempotency to prevent duplicate logs.
    """
    try:
        if not batch_request.items:
            raise HTTPException(status_code=400, detail="No items provided")
        
        if len(batch_request.items) > 10:
            raise HTTPException(status_code=400, detail="Maximum 10 items per batch")
        
        # Convert Pydantic models to dicts for the service
        items = [item.model_dump() for item in batch_request.items]
        
        result = await habits_service.batch_log_habits(
            items=items,
            user_id=current_user["id"],
            client_event_id=batch_request.client_event_id
        )
        
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "Batch log failed"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Batch log error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================
# ANALYTICS ENDPOINTS - Powered by Tinybird
# ================================

@app.get("/api/analytics/habits/summary")
@limiter.limit("20/minute")  # Max 20 analytics queries per minute
async def get_habits_summary(request: Request, days_back: int = 30, current_user = Depends(get_current_user)):
    """
    Get habit analytics summary from Tinybird
    """
    try:
        summary = await tinybird_service.get_user_habits_summary(current_user["id"], days_back)
        return summary
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/analytics/habits/trends")
@limiter.limit("20/minute")  # Max 20 trend queries per minute
async def get_habit_trends(
    request: Request,
    period: str = "day", 
    days_back: int = 30, 
    habit_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get habit trends from Tinybird
    """
    try:
        trends = await tinybird_service.get_habit_trends(
            current_user["id"], period, days_back, habit_id
        )
        return trends
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/analytics/habits/breakdown")
async def get_habits_breakdown(
    user_id: str,
    start_date: str,
    end_date: str,
    current_user = Depends(get_current_user)
):
    """
    Get habit breakdown by category from Turso database
    Returns count of completed habits per category
    """
    try:
        breakdown = await habits_service.get_category_breakdown(
            user_id, start_date, end_date
        )
        return {"breakdown": breakdown}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ================================
# CENTRALIZED ANALYTICS - Single Source of Truth
# ================================

from services.analytics_service import analytics_service

@app.get("/api/analytics/stats")
@limiter.limit("30/minute")
async def get_habit_stats(
    request: Request,
    habit_id: Optional[str] = None,
    habit_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: int = 30,
    current_user = Depends(get_current_user)
):
    """
    Get comprehensive habit statistics.
    Single source of truth for: total, average (per day with data), min, max, variance.
    
    Query params:
    - habit_id: Specific habit ID (optional)
    - habit_name: Habit name to search for (flexible matching)
    - start_date: Start date YYYY-MM-DD
    - end_date: End date YYYY-MM-DD  
    - days_back: Days to look back (default 30, used if no dates provided)
    """
    try:
        result = await analytics_service.get_habit_stats(
            user_id=current_user["id"],
            habit_id=habit_id,
            habit_name=habit_name,
            start_date=start_date,
            end_date=end_date,
            days_back=days_back
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/analytics/daily-breakdown")
@limiter.limit("30/minute")
async def get_daily_breakdown(
    request: Request,
    habit_id: Optional[str] = None,
    habit_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: int = 30,
    timezone: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get day-by-day breakdown for a habit.
    Returns chronological list of daily values.
    
    Query params:
    - habit_id: Specific habit ID
    - habit_name: Habit name to search for (flexible matching)
    - start_date: Start date (YYYY-MM-DD) - overrides days_back
    - end_date: End date (YYYY-MM-DD) - overrides days_back
    - days_back: Days to look back (default 30, ignored if dates provided)
    - timezone: User's timezone for time display (e.g., 'America/New_York')
    """
    try:
        result = await analytics_service.get_daily_breakdown(
            user_id=current_user["id"],
            habit_id=habit_id,
            habit_name=habit_name,
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
            timezone=timezone
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/analytics/correlation")
@limiter.limit("20/minute")
async def get_correlation(
    request: Request,
    habit1_id: Optional[str] = None,
    habit1_name: Optional[str] = None,
    habit2_id: Optional[str] = None,
    habit2_name: Optional[str] = None,
    days_back: int = 30,
    current_user = Depends(get_current_user)
):
    """
    Calculate correlation between two habits.
    Returns Pearson correlation coefficient and interpretation.
    
    Query params:
    - habit1_id/habit1_name: First habit
    - habit2_id/habit2_name: Second habit
    - days_back: Days to analyze (default 30)
    """
    try:
        result = await analytics_service.get_correlation(
            user_id=current_user["id"],
            habit1_id=habit1_id,
            habit1_name=habit1_name,
            habit2_id=habit2_id,
            habit2_name=habit2_name,
            days_back=days_back
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/analytics/list-habits")
async def list_habits_for_analytics(
    current_user = Depends(get_current_user)
):
    """
    List all habits for a user with basic info.
    Useful for AI chat to know available habits.
    """
    try:
        result = await analytics_service.list_habits(current_user["id"])
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/analytics/trends")
@limiter.limit("20/minute")
async def get_analytics_trends(
    request: Request,
    habit_id: Optional[str] = None,
    habit_name: Optional[str] = None,
    window_days: int = 30,
    current_user = Depends(get_current_user)
):
    """
    Get habit trends comparing current period vs previous period.
    Returns direction (up/down/flat), percent change, and confidence.
    
    Query params:
    - habit_id: Specific habit ID (optional, returns all habits if not provided)
    - habit_name: Habit name to search for (flexible matching)
    - window_days: Period length in days (default 30)
    """
    try:
        result = await analytics_service.get_habit_trends(
            user_id=current_user["id"],
            habit_id=habit_id,
            habit_name=habit_name,
            window_days=window_days
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/analytics/anomalies")
@limiter.limit("20/minute")
async def get_analytics_anomalies(
    request: Request,
    habit_id: Optional[str] = None,
    habit_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: int = 30,
    z_threshold: float = 2.0,
    max_results: int = 5,
    current_user = Depends(get_current_user)
):
    """
    Identify unusual days (spikes/drops) for a habit using z-score analysis.
    
    Query params:
    - habit_id: Specific habit ID
    - habit_name: Habit name to search for (flexible matching)
    - start_date: Start date YYYY-MM-DD
    - end_date: End date YYYY-MM-DD
    - days_back: Days to look back (default 30, used if no dates provided)
    - z_threshold: Z-score threshold for anomaly detection (default 2.0)
    - max_results: Maximum anomalies to return (default 5)
    """
    try:
        result = await analytics_service.get_habit_anomalies(
            user_id=current_user["id"],
            habit_id=habit_id,
            habit_name=habit_name,
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
            z_threshold=z_threshold,
            max_results=max_results
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ================================
# REAL-TIME ENDPOINTS - WebSocket for live updates
# ================================

from fastapi import WebSocket, WebSocketDisconnect
from services.websocket_manager import WebSocketManager

websocket_manager = WebSocketManager()

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for real-time updates
    Replaces Supabase real-time subscriptions
    """
    await websocket_manager.connect(websocket, user_id)
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            # Echo back for heartbeat
            await websocket.send_text(f"pong: {data}")
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket, user_id)

# ================================
# WHOOP INTEGRATION ENDPOINTS
# ================================

@app.post("/api/integrations/whoop/callback")
async def whoop_callback(
    code: str,
    state: Optional[str] = None,
    error: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Handle Whoop OAuth callback
    Exchange authorization code for access token and save integration
    """
    try:
        if error:
            raise HTTPException(status_code=400, detail=f"Whoop OAuth error: {error}")
        
        if not code:
            raise HTTPException(status_code=400, detail="No authorization code provided")
        
        print(f"🔑 Whoop callback - exchanging code for user {current_user['id']}")
        
        # Exchange code for token
        token_data = await whoop_service.exchange_code_for_token(code)
        print(f"🔍 Token data keys received from Whoop: {list(token_data.keys())}")
        print(f"🔍 Has refresh_token: {bool(token_data.get('refresh_token'))}")
        
        # Get Whoop user info (v1 API)
        user_info = await whoop_service.get_whoop_user_info(token_data["access_token"])
        
        # Save integration
        await whoop_service.save_integration(
            user_id=current_user["id"],
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            expires_in=token_data.get("expires_in", 3600),
            whoop_user_id=str(user_info["user_id"])
        )
        
        print(f"✅ Whoop integration saved for user {current_user['id']}")
        
        return {
            "status": "success",
            "message": "Whoop connected successfully",
            "whoop_user_id": user_info["user_id"]
        }
        
    except Exception as e:
        print(f"❌ Whoop callback error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/integrations/whoop/status")
async def whoop_status(current_user = Depends(get_current_user)):
    """
    Check if user has connected Whoop integration
    """
    try:
        integration = await whoop_service.get_integration(current_user["id"])
        
        if not integration:
            return {"connected": False}
        
        return {
            "connected": True,
            "whoop_user_id": integration.whoop_user_id,
            "connected_at": integration.connected_at.isoformat(),
            "last_sync_at": integration.last_sync_at.isoformat() if integration.last_sync_at else None,
            "is_active": integration.is_active,
            "sync_hour": integration.whoop_sync_hour or 9  # Default to 9 AM if not set
        }
        
    except Exception as e:
        print(f"❌ Error checking Whoop status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/integrations/whoop/sync")
async def whoop_sync(
    days_back: int = None, 
    force_full_sync: bool = False,
    current_user = Depends(get_current_user)
):
    """
    Sync data from Whoop API with smart incremental syncing.
    
    - Default: Only fetches new data since last sync (with 2-day overlap for safety)
    - First sync: Automatically fetches 30 days of historical data
    - days_back: Manual override to fetch specific number of days
    - force_full_sync: Force a full 30-day sync regardless of last sync time
    """
    try:
        sync_type = "smart incremental"
        if force_full_sync:
            sync_type = "full (forced)"
        elif days_back is not None:
            sync_type = f"manual ({days_back} days)"
            
        print(f"🔄 Starting Whoop {sync_type} sync for user {current_user['id']}")
        result = await whoop_service.sync_whoop_data(
            current_user["id"], 
            days_back=days_back,
            force_full_sync=force_full_sync
        )
        print(f"✅ Whoop sync completed for user {current_user['id']}")
        return result
        
    except Exception as e:
        print(f"❌ Whoop sync error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/integrations/whoop/sync-all")
async def whoop_sync_all(
    internal_key: str = Header(None, alias="X-Internal-Key")
):
    """
    Sync Whoop data for all users with active integrations
    This endpoint is for internal use (cron jobs, background tasks)
    Uses smart incremental syncing - only fetches new data since each user's last sync
    """
    try:
        # Verify internal API key
        if internal_key != os.getenv("INTERNAL_API_KEY"):
            raise HTTPException(status_code=403, detail="Invalid internal API key")
        
        print(f"🔄 Starting bulk Whoop sync for all users (smart incremental)")
        
        # Get all users with active Whoop integrations
        async with get_db_session() as session:
            result = await session.execute(
                select(WhoopIntegrationDB)
                .where(WhoopIntegrationDB.is_active == True)
            )
            integrations = result.scalars().all()
        
        sync_results = []
        for integration in integrations:
            try:
                print(f"🔄 Syncing Whoop data for user {integration.user_id}")
                # Use smart sync (no days_back = auto-detect based on last_sync_at)
                result = await whoop_service.sync_whoop_data(integration.user_id)
                sync_results.append({
                    "user_id": integration.user_id,
                    "success": True,
                    "data": result
                })
            except Exception as e:
                print(f"❌ Failed to sync for user {integration.user_id}: {str(e)}")
                sync_results.append({
                    "user_id": integration.user_id,
                    "success": False,
                    "error": str(e)
                })
        
        successful_syncs = sum(1 for r in sync_results if r["success"])
        print(f"✅ Bulk sync completed: {successful_syncs}/{len(sync_results)} successful")
        
        return {
            "success": True,
            "total_users": len(sync_results),
            "successful_syncs": successful_syncs,
            "results": sync_results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Bulk Whoop sync error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/integrations/whoop")
async def whoop_disconnect(current_user = Depends(get_current_user)):
    """
    Disconnect Whoop integration
    """
    try:
        success = await whoop_service.disconnect_integration(current_user["id"])
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to disconnect Whoop")
        
        print(f"✅ Whoop disconnected for user {current_user['id']}")
        
        return {
            "status": "success",
            "message": "Whoop disconnected successfully"
        }
        
    except Exception as e:
        print(f"❌ Whoop disconnect error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class WhoopSyncHourUpdate(BaseModel):
    sync_hour: int  # 0-23

@app.put("/api/integrations/whoop/sync-hour")
async def update_whoop_sync_hour(
    update_data: WhoopSyncHourUpdate,
    current_user = Depends(get_current_user)
):
    """
    Update user's preferred Whoop sync hour (0-23)
    """
    try:
        # Validate hour range
        if not 0 <= update_data.sync_hour <= 23:
            raise HTTPException(status_code=400, detail="Sync hour must be between 0 and 23")
        
        # Update the sync hour
        async with get_db_session() as session:
            result = await session.execute(
                select(WhoopIntegrationDB)
                .where(WhoopIntegrationDB.user_id == current_user["id"])
            )
            integration = result.scalar_one_or_none()
            
            if not integration:
                raise HTTPException(status_code=404, detail="Whoop integration not found")
            
            integration.whoop_sync_hour = update_data.sync_hour
            await session.commit()
        
        print(f"✅ Updated Whoop sync hour to {update_data.sync_hour} for user {current_user['id']}")
        
        return {
            "status": "success",
            "message": f"Sync hour updated to {update_data.sync_hour}:00",
            "sync_hour": update_data.sync_hour
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error updating sync hour: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# SCREENSHOT ANALYSIS ENDPOINTS - Smart screenshot upload for any habit
# ================================

@app.post("/api/screenshot/analyze")
@limiter.limit("10/minute")  # Max 10 screenshot uploads per minute
async def analyze_and_log_screenshot(
    request: Request,
    file: UploadFile = File(...),
    current_user = Depends(get_current_user),
):
    """
    Upload a screenshot and intelligently detect which habit to update.
    Uses OpenAI vision to analyze the screenshot and determine:
    - What type of data it contains (screen time, meetings, workouts, etc.)
    - Which habit it should update
    - What value to extract
    
    Returns:
        - habit_id: The ID of the matched/created habit
        - habit_name: Name of the habit
        - value: The extracted value
        - unit: The unit of the value
        - description: What was detected
        - logged_at: When the log was created
    """
    try:
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file must be an image (PNG, JPG, etc.)",
            )
        
        # Read image bytes
        image_bytes = await file.read()
        
        if len(image_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )
        
        if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File size exceeds 10MB limit",
            )
        
        print(f"📸 Analyzing screenshot for user {current_user['id']} ({len(image_bytes)} bytes)")
        
        # Get user's existing habits
        user_habits = await habits_service.get_habits(current_user["id"])
        habits_for_analysis = [
            {"id": h.id, "name": h.name, "unit_type": h.unit_type}
            for h in user_habits
        ]
        
        print(f"📋 User has {len(habits_for_analysis)} habits to match against")
        
        # Analyze screenshot using OpenAI vision
        analysis = analyze_screenshot_for_habits(image_bytes, habits_for_analysis)
        
        if analysis is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Could not extract useful data from this screenshot. "
                    "Please make sure the screenshot clearly shows trackable data like "
                    "screen time, workout stats, reading progress, meeting times, etc."
                ),
            )
        
        print(f"✅ Analysis result: {analysis}")
        
        habit_id = analysis.get("habit_id")
        habit_name = analysis.get("habit_name", "Unknown")
        value = analysis.get("value")
        unit = analysis.get("unit", "Count")
        
        # If no habit matched, create a new one
        if not habit_id:
            print(f"🆕 Creating new habit: {habit_name}")
            
            # Determine category based on detected type
            detected_type = analysis.get("detected_type", "other")
            category_map = {
                "screen_time": "wellness",
                "meetings": "productivity", 
                "workout": "health",
                "reading": "learning",
                "sleep": "health",
                "meditation": "wellness",
                "steps": "health",
                "distance": "health",
            }
            category = category_map.get(detected_type, "other")
            
            new_habit = await habits_service.create_habit(
                HabitCreate(
                    name=habit_name,
                    category=category,
                    unit_type=unit,
                    is_custom=True,
                    integration_source="screenshot",
                ),
                current_user["id"]
            )
            habit_id = new_habit.id
            habit_name = new_habit.name
            print(f"✅ Created new habit: {habit_name} ({habit_id})")
        
        # Get the habit to verify it exists
        habit = await habits_service.get_habit_by_id(habit_id, current_user["id"])
        if not habit:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Habit not found: {habit_id}",
            )
        
        # Convert value to appropriate format for logging
        # For time-based habits, we might need to convert
        duration = None
        amount = value
        
        habit_unit = (habit.unit_type or "").lower()
        if "hour" in habit_unit:
            # Store as amount in hours
            if unit.lower() == "minutes":
                amount = value / 60  # Convert minutes to hours
        elif "minute" in habit_unit:
            # Store as amount in minutes
            if unit.lower() == "hours":
                amount = value * 60  # Convert hours to minutes
        
        # Log the habit
        from datetime import datetime, timezone
        logged_at = datetime.now(timezone.utc)
        date_str = logged_at.strftime("%Y-%m-%d")
        
        log_data = HabitLogCreate(
            duration=duration,
            amount=amount,
            date=date_str,
            completed_at=logged_at.isoformat(),
            status="completed",
            notes=f"Logged via screenshot: {analysis.get('description', '')}",
        )
        
        habit_log = await habits_service.log_habit(habit_id, log_data, current_user["id"])
        
        # Format display value
        display_value = f"{amount:.1f}" if isinstance(amount, float) else str(amount)
        
        return {
            "success": True,
            "habit_id": habit_id,
            "habit_name": habit_name,
            "value": amount,
            "unit": habit.unit_type or unit,
            "description": analysis.get("description", ""),
            "detected_type": analysis.get("detected_type", "other"),
            "confidence": analysis.get("confidence", 0.5),
            "logged_at": logged_at.isoformat(),
            "message": f"Successfully logged {display_value} {habit.unit_type or unit} of {habit_name}.",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Screenshot analysis error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ================================
# SCREENSHOT PREVIEW & CONFIRM ENDPOINTS (User Confirmation Flow)
# ================================

@app.post("/api/screenshot/preview")
@limiter.limit("10/minute")
async def preview_screenshot_analysis(
    request: Request,
    file: UploadFile = File(...),
    current_user = Depends(get_current_user),
):
    """
    Analyze a screenshot and return preview data WITHOUT logging.
    User can review and confirm before the data is actually logged.
    
    Returns:
        - requires_confirmation: True (always for this endpoint)
        - habit_id: The ID of the matched habit (or None if new)
        - habit_name: Name of the habit
        - value: The extracted value
        - unit: The unit of the value
        - confidence: How confident the AI is (0-1)
        - validation: Whether the value passes sanity checks
        - available_habits: List of user's habits for selection
    """
    try:
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file must be an image (PNG, JPG, etc.)",
            )
        
        # Read image bytes
        image_bytes = await file.read()
        
        if len(image_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )
        
        if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File size exceeds 10MB limit",
            )
        
        print(f"📸 Preview analyzing screenshot for user {current_user['id']} ({len(image_bytes)} bytes)")
        
        # Get user's existing habits
        user_habits = await habits_service.get_habits(current_user["id"])
        habits_for_analysis = [
            {"id": h.id, "name": h.name, "unit_type": h.unit_type}
            for h in user_habits
        ]
        
        print(f"📋 User has {len(habits_for_analysis)} habits to match against")
        
        # Analyze screenshot using OpenAI vision
        analysis = analyze_screenshot_for_habits(image_bytes, habits_for_analysis)
        
        if analysis is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Could not extract useful data from this screenshot. "
                    "Please make sure the screenshot clearly shows trackable data like "
                    "screen time, workout stats, reading progress, meeting times, etc."
                ),
            )
        
        print(f"✅ Preview analysis result: {analysis}")
        
        # Check confidence threshold
        confidence = analysis.get("confidence", 0.5)
        low_confidence = confidence < 0.6
        
        # Get validation info
        validation = analysis.get("validation", {"is_valid": True})
        
        return {
            "requires_confirmation": True,
            "habit_id": analysis.get("habit_id"),
            "habit_name": analysis.get("habit_name", "Unknown"),
            "value": analysis.get("value"),
            "unit": analysis.get("unit", "Count"),
            "description": analysis.get("description", ""),
            "detected_type": analysis.get("detected_type", "other"),
            "raw_text": analysis.get("raw_text", ""),
            "confidence": confidence,
            "low_confidence": low_confidence,
            "validation": validation,
            "is_new_habit": analysis.get("habit_id") is None,
            "available_habits": [
                {"id": h.id, "name": h.name, "unit_type": h.unit_type}
                for h in user_habits
            ],
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Screenshot preview error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class ScreenshotConfirmRequest(BaseModel):
    habit_id: Optional[str] = None  # None if creating new habit
    habit_name: str
    value: float
    unit: str
    detected_type: str = "other"
    description: str = ""
    create_new_habit: bool = False


@app.post("/api/screenshot/confirm")
async def confirm_screenshot_log(
    request: ScreenshotConfirmRequest,
    current_user = Depends(get_current_user),
):
    """
    Confirm and log the screenshot analysis after user review.
    User can modify the value, habit, or unit before confirming.
    """
    try:
        from datetime import datetime, timezone
        
        habit_id = request.habit_id
        habit_name = request.habit_name
        value = request.value
        unit = request.unit
        
        # If no habit_id or create_new_habit is True, create a new habit
        if not habit_id or request.create_new_habit:
            print(f"🆕 Creating new habit: {habit_name}")
            
            # Determine category based on detected type
            category_map = {
                "screen_time": "wellness",
                "meetings": "productivity", 
                "workout": "health",
                "reading": "learning",
                "sleep": "health",
                "meditation": "wellness",
                "steps": "health",
                "distance": "health",
            }
            category = category_map.get(request.detected_type, "other")
            
            new_habit = await habits_service.create_habit(
                HabitCreate(
                    name=habit_name,
                    category=category,
                    unit_type=unit,
                    is_custom=True,
                    integration_source="screenshot",
                ),
                current_user["id"]
            )
            habit_id = new_habit.id
            habit_name = new_habit.name
            print(f"✅ Created new habit: {habit_name} ({habit_id})")
        
        # Get the habit to verify it exists
        habit = await habits_service.get_habit_by_id(habit_id, current_user["id"])
        if not habit:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Habit not found: {habit_id}",
            )
        
        # Convert value to appropriate format for logging
        duration = None
        amount = value
        
        habit_unit = (habit.unit_type or "").lower()
        if "hour" in habit_unit:
            if unit.lower() == "minutes":
                amount = value / 60
        elif "minute" in habit_unit:
            if unit.lower() == "hours":
                amount = value * 60
        
        # Log the habit
        logged_at = datetime.now(timezone.utc)
        date_str = logged_at.strftime("%Y-%m-%d")
        
        log_data = HabitLogCreate(
            duration=duration,
            amount=amount,
            date=date_str,
            completed_at=logged_at.isoformat(),
            status="completed",
            notes=f"Logged via screenshot: {request.description}",
        )
        
        habit_log = await habits_service.log_habit(habit_id, log_data, current_user["id"])
        
        # Format display value
        display_value = f"{amount:.1f}" if isinstance(amount, float) else str(amount)
        
        return {
            "success": True,
            "habit_id": habit_id,
            "habit_name": habit_name,
            "value": amount,
            "unit": habit.unit_type or unit,
            "description": request.description,
            "detected_type": request.detected_type,
            "logged_at": logged_at.isoformat(),
            "message": f"Successfully logged {display_value} {habit.unit_type or unit} of {habit_name}.",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Screenshot confirm error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# Legacy endpoint for backward compatibility
@app.post("/api/screentime/from-screenshot")
@limiter.limit("10/minute")
async def log_screentime_from_screenshot_legacy(
    request: Request,
    file: UploadFile = File(...),
    current_user = Depends(get_current_user),
):
    """
    Legacy endpoint - redirects to the new smart analyzer.
    """
    return await analyze_and_log_screenshot(request, file, current_user)

# ================================
# AI CONVERSATION ENDPOINTS - Chat persistence
# ================================

from services.conversation_service import conversation_service

class MessageCreate(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str
    tool_payload: Optional[dict] = None

@app.post("/api/conversations")
async def create_conversation(
    current_user = Depends(get_current_user)
):
    """
    Create a new AI conversation for the user.
    Returns the new conversation with its ID.
    """
    try:
        conversation = await conversation_service.create_conversation(current_user["id"])
        return conversation
    except Exception as e:
        print(f"❌ Error creating conversation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/conversations/latest")
async def get_latest_conversation(
    current_user = Depends(get_current_user)
):
    """
    Get the most recently updated conversation for the user.
    Returns null if no conversations exist.
    """
    try:
        conversation = await conversation_service.get_latest_conversation(current_user["id"])
        if not conversation:
            return None
        return conversation
    except Exception as e:
        print(f"❌ Error getting latest conversation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    current_user = Depends(get_current_user)
):
    """
    Get a specific conversation by ID.
    Only returns if the conversation belongs to the user.
    """
    try:
        conversation = await conversation_service.get_conversation(
            conversation_id, 
            current_user["id"]
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conversation
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error getting conversation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/conversations/{conversation_id}/messages")
async def add_message(
    conversation_id: str,
    message_data: MessageCreate,
    current_user = Depends(get_current_user)
):
    """
    Add a message to a conversation.
    """
    try:
        message = await conversation_service.add_message(
            conversation_id=conversation_id,
            user_id=current_user["id"],
            role=message_data.role,
            content=message_data.content,
            tool_payload=message_data.tool_payload
        )
        if not message:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return message
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error adding message: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/conversations")
async def list_conversations(
    limit: int = 20,
    current_user = Depends(get_current_user)
):
    """
    List conversations for the user.
    """
    try:
        conversations = await conversation_service.list_conversations(
            current_user["id"],
            limit=limit
        )
        return {"conversations": conversations}
    except Exception as e:
        print(f"❌ Error listing conversations: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class ResponseModeUpdate(BaseModel):
    response_mode: str  # 'text' or 'voice'

@app.patch("/api/conversations/{conversation_id}/response-mode")
async def update_conversation_response_mode(
    conversation_id: str,
    update: ResponseModeUpdate,
    current_user = Depends(get_current_user)
):
    """
    Update the response mode for a conversation.
    """
    try:
        if update.response_mode not in ('text', 'voice'):
            raise HTTPException(status_code=400, detail="response_mode must be 'text' or 'voice'")
        
        result = await conversation_service.update_response_mode(
            conversation_id,
            current_user["id"],
            update.response_mode
        )
        if not result:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error updating response mode: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# MIGRATION ENDPOINTS - For data migration
# ================================

@app.post("/api/migrate/from-supabase")
async def migrate_from_supabase(current_user = Depends(get_current_user)):
    """
    Migrate user's data from Supabase to Tinybird
    """
    try:
        # This would be used during migration phase
        result = await habits_service.migrate_user_data_from_supabase(current_user["id"])
        return {"message": "Migration completed", "migrated_records": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Startup and shutdown events
@app.on_event("startup")
async def startup_event():
    """Initialize database and services on startup"""
    import logging
    logger = logging.getLogger("uvicorn")
    
    from database.connection import init_database
    await init_database()
    logger.info("🚀 Ritual Backend API started successfully!")
    logger.info("📅 Automated Whoop sync is handled by Trigger.dev (runs daily at 9 AM)")

@app.on_event("shutdown") 
async def shutdown_event():
    """Clean up on shutdown"""
    from database.connection import close_database
    await close_database()
    print("👋 Ritual Backend API shutdown complete!")

if __name__ == "__main__":
    import uvicorn
    import os
    from dotenv import load_dotenv
    
    load_dotenv()
    
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", 8000))
    debug = os.getenv("DEBUG", "true").lower() == "true"
    
    uvicorn.run(app, host=host, port=port, reload=debug)
