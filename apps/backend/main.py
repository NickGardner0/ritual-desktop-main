"""
Ritual FastAPI Backend
Mirrors the current TypeScript habits-service.ts interface exactly
"""

from fastapi import FastAPI, HTTPException, Depends, status, Header, Request, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
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
async def get_habits_summary(
    request: Request,
    days_back: int = Query(30, ge=1, le=36500),  # Allow "All time" queries (up to ~100 years)
    current_user = Depends(get_current_user)
):
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
    days_back: int = Query(30, ge=1, le=36500),  # Allow "All time" queries (up to ~100 years) 
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
            current_user["id"], start_date, end_date
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
    days_back: int = Query(30, ge=1, le=36500),  # Allow "All time" queries (up to ~100 years)
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
    days_back: int = Query(30, ge=1, le=36500),  # Allow "All time" queries (up to ~100 years)
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
    days_back: int = Query(30, ge=7, le=36500),  # Allow "All time" queries
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
    window_days: int = Query(30, ge=7, le=36500),  # Allow "All time" queries
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
    days_back: int = Query(30, ge=1, le=36500),  # Allow "All time" queries (up to ~100 years)
    z_threshold: float = 2.0,
    max_results: int = Query(5, ge=1, le=50),
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
    auth_header = websocket.headers.get("authorization")
    token = auth_service.extract_token_from_header(auth_header or "")

    # Fallback for websocket clients that pass token as a query string.
    if not token:
        token = websocket.query_params.get("token")

    if not token:
        await websocket.close(code=1008, reason="Authentication required")
        return

    user = await auth_service.get_user_from_token(token)
    if not user or user.get("id") != user_id:
        await websocket.close(code=1008, reason="Invalid authentication token")
        return

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

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    current_user = Depends(get_current_user)
):
    """
    Delete a conversation and all its messages.
    Only deletes if the conversation belongs to the user.
    """
    try:
        deleted = await conversation_service.delete_conversation(
            conversation_id,
            current_user["id"]
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error deleting conversation: {str(e)}")
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


# ================================
# WEARABLES API - Apple Health + Multi-source support
# ================================

from services.wearables_service import wearables_service
from schemas.wearables_apple import (
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceStatusResponse,
    AppleIngestRequest,
    AppleIngestResponse,
    AppleIngestResult,
)

@app.post("/api/wearables/apple/register_device", response_model=DeviceRegisterResponse)
async def register_apple_device(
    request: DeviceRegisterRequest,
    current_user = Depends(get_current_user)
):
    """
    Register a new iOS device for Apple Health sync.
    
    Returns a device_id and device_secret that should be:
    - device_id: Stored for future API calls
    - device_secret: Stored securely in iOS Keychain for request signing
    
    The device_secret is used to sign all ingest requests to prevent tampering.
    """
    try:
        print(f"📱 Registering device '{request.device_name}' for user {current_user['id']}")
        
        device_id, device_secret = await wearables_service.register_device(
            user_id=current_user["id"],
            device_name=request.device_name,
            platform=request.platform
        )
        
        return DeviceRegisterResponse(
            device_id=device_id,
            device_secret=device_secret,
            registered_at=datetime.utcnow().isoformat() + "Z"
        )
        
    except Exception as e:
        print(f"❌ Device registration error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wearables/apple/devices")
async def list_apple_devices(current_user = Depends(get_current_user)):
    """
    List all registered devices for the current user.
    """
    try:
        devices = await wearables_service.get_user_devices(current_user["id"])
        
        return {
            "devices": [
                DeviceStatusResponse(
                    device_id=d.id,
                    device_name=d.device_name,
                    platform=d.platform,
                    registered_at=d.registered_at.isoformat() + "Z",
                    last_sync_at=d.last_sync_at.isoformat() + "Z" if d.last_sync_at else None,
                    is_active=d.is_active
                )
                for d in devices
            ]
        }
        
    except Exception as e:
        print(f"❌ List devices error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/wearables/apple/devices/{device_id}")
async def deactivate_apple_device(
    device_id: str,
    current_user = Depends(get_current_user)
):
    """
    Deactivate a device (soft delete).
    The device will no longer be able to sync data.
    """
    try:
        success = await wearables_service.deactivate_device(device_id, current_user["id"])
        
        if not success:
            raise HTTPException(status_code=404, detail="Device not found")
        
        return {"success": True, "message": "Device deactivated"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Deactivate device error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wearables/apple/tracked_metrics")
async def get_apple_tracked_metrics(current_user = Depends(get_current_user)):
    """
    Get the list of Apple Watch metric types the user has selected to track.
    
    This endpoint returns the metric_type values for all habits where:
    - integration_source = 'apple_health'
    - metric_type is not null
    
    The iOS companion app uses this to know which HealthKit metrics to sync.
    
    Example response:
    ```json
    {
        "metric_types": ["steps", "hr", "hrv", "sleep_session"],
        "habits": [
            {"id": "abc", "name": "Steps", "metric_type": "steps", "unit_type": "Steps"},
            {"id": "def", "name": "Heart Rate", "metric_type": "hr", "unit_type": "BPM"}
        ]
    }
    ```
    """
    try:
        from database.connection import get_db_session
        from database.models import HabitDB
        from sqlalchemy import select
        
        async with get_db_session() as session:
            # Query habits where integration_source is apple_health and metric_type is set
            stmt = select(HabitDB).where(
                HabitDB.user_id == current_user["id"],
                HabitDB.integration_source == "apple_health",
                HabitDB.metric_type.isnot(None)
            )
            result = await session.execute(stmt)
            habits = result.scalars().all()
            
            # Build response
            metric_types = list(set(h.metric_type for h in habits if h.metric_type))
            habits_list = [
                {
                    "id": h.id,
                    "name": h.name,
                    "metric_type": h.metric_type,
                    "unit_type": h.unit_type
                }
                for h in habits
            ]
            
            return {
                "metric_types": metric_types,
                "habits": habits_list
            }
            
    except Exception as e:
        print(f"❌ Get tracked metrics error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/wearables/apple/ingest", response_model=AppleIngestResponse)
@limiter.limit("30/minute")  # Rate limit ingest requests
async def ingest_apple_health_metrics(
    request: Request,
    ingest_request: AppleIngestRequest,
    current_user = Depends(get_current_user)
):
    """
    Ingest normalized metrics from Apple Health.
    
    This endpoint:
    1. Validates the request signature (HMAC-SHA256)
    2. Checks for duplicate client_event_id (idempotency)
    3. Stores each metric individually
    4. Returns per-item results (partial success allowed)
    
    Request signing:
    - Signature = base64(HMAC-SHA256(device_secret, canonical_string))
    - Canonical string = device_id + "\\n" + client_event_id + "\\n" + captured_at + "\\n" + sha256(metrics_json)
    
    Example request:
    ```json
    {
        "device_id": "abc-123",
        "client_event_id": "uuid-here",
        "captured_at": "2024-01-15T10:30:00Z",
        "metrics": [
            {
                "source": "apple_health",
                "metric_type": "steps",
                "start_time": "2024-01-15T00:00:00Z",
                "end_time": "2024-01-15T23:59:59Z",
                "value": 8500,
                "unit": "count"
            }
        ],
        "schema_version": 1,
        "signature": "base64-hmac-signature"
    }
    ```
    """
    try:
        print(f"📊 Ingesting {len(ingest_request.metrics)} metrics from device {ingest_request.device_id}")
        
        success, results, error = await wearables_service.process_ingest_request(
            user_id=current_user["id"],
            request=ingest_request
        )
        
        if error and not success:
            # If there's an error and no success, return appropriate status
            if error == "Device not found":
                raise HTTPException(status_code=404, detail=error)
            elif error == "Device does not belong to this user":
                raise HTTPException(status_code=403, detail=error)
            elif error == "Invalid signature":
                raise HTTPException(status_code=401, detail=error)
            elif error == "Already processed (idempotency)":
                # Return success for idempotent requests
                return AppleIngestResponse(
                    success=True,
                    results=[],
                    server_time=datetime.utcnow().isoformat() + "Z",
                    next_poll_seconds=60
                )
            else:
                raise HTTPException(status_code=400, detail=error)
        
        return AppleIngestResponse(
            success=success,
            results=results,
            server_time=datetime.utcnow().isoformat() + "Z",
            next_poll_seconds=60 if success else 300  # Back off on failure
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Ingest error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# Import V2 schemas
from schemas.wearables_apple import (
    AppleIngestRequestV2,
    AppleIngestResponseV2,
    DeleteResult,
    SyncStatusResponse,
)


@app.post("/api/wearables/apple/ingest/v2", response_model=AppleIngestResponseV2)
@limiter.limit("60/minute")  # Higher rate limit for incremental sync
async def ingest_apple_health_metrics_v2(
    request: Request,
    ingest_request: AppleIngestRequestV2,
    current_user = Depends(get_current_user)
):
    """
    V2 Ingest endpoint with incremental sync support.
    
    Supports:
    - added: New metrics since last sync
    - deleted: HealthKit UUIDs of deleted samples
    - modified: Updated metrics (same external_id, new values)
    
    Returns confirmation of operations and anchor state.
    """
    try:
        total_ops = len(ingest_request.added) + len(ingest_request.deleted) + len(ingest_request.modified)
        print(f"📊 V2 Ingest: {len(ingest_request.added)} added, {len(ingest_request.deleted)} deleted, {len(ingest_request.modified)} modified")
        
        success, added_results, deleted_results, modified_results, error = await wearables_service.process_ingest_request_v2(
            user_id=current_user["id"],
            request=ingest_request
        )
        
        # Force flush Tinybird batch to ensure data is synced immediately
        flushed_count = await wearables_service.force_flush_tinybird_batch()
        if flushed_count > 0:
            print(f"📊 Flushed {flushed_count} habit logs to Tinybird")
        
        if error and not success:
            if error == "Device not found":
                raise HTTPException(status_code=404, detail=error)
            elif error == "Device does not belong to this user":
                raise HTTPException(status_code=403, detail=error)
            elif error == "Invalid signature":
                raise HTTPException(status_code=401, detail=error)
            elif error == "Already processed (idempotency)":
                return AppleIngestResponseV2(
                    success=True,
                    added_results=[],
                    deleted_results=[],
                    modified_results=[],
                    server_time=datetime.utcnow().isoformat() + "Z",
                    next_poll_seconds=60,
                    confirmed_anchors=ingest_request.anchors
                )
            else:
                raise HTTPException(status_code=400, detail=error)
        
        return AppleIngestResponseV2(
            success=success,
            added_results=added_results,
            deleted_results=deleted_results,
            modified_results=modified_results,
            server_time=datetime.utcnow().isoformat() + "Z",
            next_poll_seconds=60 if success else 300,
            confirmed_anchors=ingest_request.anchors if success else None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ V2 Ingest error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wearables/apple/devices/{device_id}/status", response_model=SyncStatusResponse)
async def get_device_sync_status(
    device_id: str,
    current_user = Depends(get_current_user)
):
    """
    Get sync status for a specific device.
    Used by desktop app to display sync health.
    """
    try:
        status = await wearables_service.get_device_sync_status(
            device_id=device_id,
            user_id=current_user["id"]
        )
        
        if not status:
            raise HTTPException(status_code=404, detail="Device not found")
        
        return SyncStatusResponse(**status)
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Get sync status error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wearables/apple/sync-status")
async def get_all_devices_sync_status(current_user = Depends(get_current_user)):
    """
    Get sync status for all user's Apple Health devices.
    Used by desktop app settings to show connection health.
    """
    try:
        devices = await wearables_service.get_user_devices(current_user["id"])
        
        statuses = []
        for device in devices:
            status = await wearables_service.get_device_sync_status(
                device_id=device.id,
                user_id=current_user["id"]
            )
            if status:
                statuses.append(status)
        
        return {
            "devices": statuses,
            "count": len(statuses)
        }
        
    except Exception as e:
        print(f"❌ Get all sync status error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wearables/metrics")
async def get_wearable_metrics(
    source: Optional[str] = None,
    metric_type: Optional[str] = None,
    days_back: int = 7,
    limit: int = 100,
    current_user = Depends(get_current_user)
):
    """
    Query stored wearable metrics for the current user.
    
    Query params:
    - source: Filter by source (apple_health, whoop, etc.)
    - metric_type: Filter by type (steps, active_energy, hr, etc.)
    - days_back: Days to look back (default 7)
    - limit: Max results (default 100)
    """
    try:
        from datetime import timedelta
        
        start_date = datetime.utcnow() - timedelta(days=days_back)
        
        metrics = await wearables_service.get_user_metrics(
            user_id=current_user["id"],
            source=source,
            metric_type=metric_type,
            start_date=start_date,
            limit=limit
        )
        
        return {
            "metrics": [
                {
                    "id": m.id,
                    "source": m.source,
                    "metric_type": m.metric_type,
                    "start_time": m.start_time.isoformat() + "Z",
                    "end_time": m.end_time.isoformat() + "Z",
                    "value": m.value,
                    "unit": m.unit,
                    "timezone": m.timezone,
                    "device_id": m.device_id,
                    "external_id": m.external_id,
                    "created_at": m.created_at.isoformat() + "Z"
                }
                for m in metrics
            ],
            "count": len(metrics)
        }
        
    except Exception as e:
        print(f"❌ Get metrics error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# ROBUST IMPORT SYSTEM ENDPOINTS
# ================================

from services.import_service import import_service
from models.import_models import (
    ImportSource, ImportStatus, ConflictPolicy, AggregationPeriod,
    ImportOptions, ImportRunCreate, ImportRunSummary, ImportRun,
    ImportItem, ImportPreviewResponse, BatchLogsRequest, BatchLogsResponse,
    ChunkIngestRequest, ChunkIngestResponse, UndoImportResponse
)

# In-process background import task registry.
# This keeps long-running imports off the request path.
_import_tasks: Dict[str, asyncio.Task] = {}
_import_tasks_lock = asyncio.Lock()


class ImportRunCreateRequest(BaseModel):
    """Request to create a new import run"""
    source: str  # csv, screenshot, apple_health, whoop, oura, garmin
    file_name: Optional[str] = None
    options: Optional[dict] = None


@app.post("/api/import/runs")
async def create_import_run(
    request: ImportRunCreateRequest,
    current_user = Depends(get_current_user)
):
    """
    Create a new import run.
    This initializes the import job without processing any data.
    """
    try:
        source = ImportSource(request.source)
        options = None
        if request.options:
            options = ImportOptions(**request.options)
        
        run = await import_service.create_import_run(
            user_id=current_user["id"],
            source=source,
            file_name=request.file_name,
            options=options
        )
        
        return run.model_dump()
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid source: {str(e)}")
    except Exception as e:
        print(f"❌ Create import run error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/import/runs/{run_id}")
async def get_import_run(
    run_id: str,
    current_user = Depends(get_current_user)
):
    """
    Get an import run by ID.
    """
    try:
        run = await import_service.get_import_run(run_id, current_user["id"])
        
        if not run:
            raise HTTPException(status_code=404, detail="Import run not found")
        
        return run.model_dump()
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Get import run error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/import/runs")
async def list_import_runs(
    limit: int = 20,
    offset: int = 0,
    current_user = Depends(get_current_user)
):
    """
    Get import history for the user.
    """
    try:
        runs = await import_service.get_import_history(
            current_user["id"],
            limit=limit,
            offset=offset
        )
        
        return {
            "runs": [run.model_dump() for run in runs],
            "count": len(runs)
        }
        
    except Exception as e:
        print(f"❌ List import runs error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class BatchLogsApiRequest(BaseModel):
    """API request for batch log creation"""
    import_run_id: Optional[str] = None
    conflict_policy: str = "skip_existing"  # skip_existing, overwrite_existing, merge_sum, merge_avg
    logs: List[dict]


@app.post("/api/habits/logs/batch")
@limiter.limit("30/minute")
async def create_logs_batch(
    request: Request,
    batch_request: BatchLogsApiRequest,
    current_user = Depends(get_current_user)
):
    """
    Create habit logs in batch with conflict resolution.
    
    This endpoint:
    1. Validates all habits belong to the user
    2. Generates dedupe keys for each log
    3. Applies conflict resolution policy
    4. Performs bulk insert/upsert
    5. Returns detailed results per log
    """
    try:
        from models.import_models import BatchLogCreate, BatchLogsRequest as BatchRequest
        
        # Validate batch size
        if len(batch_request.logs) > 2000:
            raise HTTPException(status_code=400, detail="Maximum 2000 logs per batch")
        
        # Parse conflict policy
        try:
            conflict_policy = ConflictPolicy(batch_request.conflict_policy)
        except ValueError:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid conflict_policy. Must be one of: skip_existing, overwrite_existing, merge_sum, merge_avg"
            )
        
        # Convert logs to BatchLogCreate objects
        logs = []
        for i, log_dict in enumerate(batch_request.logs):
            try:
                logs.append(BatchLogCreate(**log_dict))
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid log at index {i}: {str(e)}"
                )
        
        # Create request object
        batch_req = BatchRequest(
            import_run_id=batch_request.import_run_id,
            conflict_policy=conflict_policy,
            logs=logs
        )
        
        # Process batch
        result = await import_service.create_logs_batch(
            user_id=current_user["id"],
            request=batch_req
        )
        
        return result.model_dump()
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Batch log creation error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/import/runs/{run_id}/undo")
async def undo_import_run(
    run_id: str,
    current_user = Depends(get_current_user)
):
    """
    Undo an import run by deleting all logs it created.
    Also deletes any habits that were created by this import and now have no logs.
    """
    try:
        result = await import_service.undo_import_run(run_id, current_user["id"])
        return result.model_dump()
        
    except HTTPException:
        raise
    except Exception as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        if "cannot be undone" in str(e).lower():
            raise HTTPException(status_code=400, detail=str(e))
        print(f"❌ Undo import error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class ImportPreviewApiRequest(BaseModel):
    """API request for import preview"""
    source: str
    file_content: Optional[str] = None  # Base64 encoded file content
    options: Optional[dict] = None


# Configuration for preview limits
PREVIEW_PARSE_LIMIT = 500  # Max rows to parse for preview
PREVIEW_SAMPLE_SIZE = 50   # Sample items to return in response
PREVIEW_DEDUPE_CHECK_LIMIT = 100  # Items to check for duplicates
PREVIEW_STAGE_LIMIT = 50   # Items to stage (reduced from 500)


@app.post("/api/import/preview")
@limiter.limit("20/minute")
async def preview_import(
    request: Request,
    file: UploadFile = File(...),
    source: str = Form(None),
    options: str = Form(None),  # JSON string of options (moved from header)
    current_user = Depends(get_current_user)
):
    """
    OPTIMIZED Preview endpoint - returns in <300ms for CSV.
    
    Accepts FormData with:
    - file: The file to import
    - source: Import source type (csv, screenshot, etc.)
    - options: JSON string of import options (replaces X-Import-Options header)
    
    Performance optimizations:
    - Idempotent: Returns existing run if same file hash exists
    - Bulk queries for duplicate checking
    - Only stages sample items (50 instead of 500)
    - Screenshot AI runs asynchronously (returns immediately with status="parsing")
    
    Returns:
    - Summary counts (total, new, duplicates, conflicts)
    - Sample of items that will be imported
    - Validation issues
    - Detected columns/metrics
    """
    import json
    import csv
    import io
    import hashlib
    from services.import_service import parse_date_flexible
    
    try:
        # Get file content from upload
        file_content = await file.read()
        file_name = file.filename
        
        if not file_content:
            raise HTTPException(status_code=400, detail="No file provided")
        
        # Parse options from FormData body OR header (backward compatible)
        options_dict = {}
        if options:
            try:
                options_dict = json.loads(options)
            except json.JSONDecodeError:
                pass
        
        # Fallback to header for backward compatibility
        if not options_dict:
            import_options_header = request.headers.get("X-Import-Options")
            if import_options_header:
                try:
                    header_data = json.loads(import_options_header)
                    source = source or header_data.get("source")
                    options_dict = header_data.get("options", {})
                except json.JSONDecodeError:
                    pass
        
        if not source:
            raise HTTPException(status_code=400, detail="Source is required")
        
        # Parse source enum
        try:
            source_enum = ImportSource(source)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid source: {source}")
        
        # Parse options
        import_options = None
        if options_dict:
            try:
                import_options = ImportOptions(**options_dict)
            except Exception as e:
                print(f"⚠️ Could not parse import options: {e}")
        
        # OPTIMIZATION: Check for existing run with same file hash (idempotent)
        file_hash = hashlib.sha256(file_content).hexdigest()
        existing_run = await import_service.find_existing_run_by_hash(
            current_user["id"],
            file_hash,
            source_enum
        )
        
        if existing_run:
            print(f"♻️ Resuming existing import run: {existing_run.id}")
            # Return cached preview data
            existing_items = await import_service.get_import_items(existing_run.id, limit=PREVIEW_SAMPLE_SIZE)
            
            return {
                "import_run_id": existing_run.id,
                "source": source_enum.value,
                "resumed": True,
                "summary": existing_run.summary.model_dump() if existing_run.summary else {
                    "total_rows": 0, "parsed": 0, "new_items": 0, "duplicates": 0, "conflicts": 0
                },
                "sample_items": [item.model_dump() for item in existing_items],
                "validation_issues": [item.model_dump() for item in existing_items if item.validation_status != "ok"][:20],
                "dedupe_estimate": {"total_items": 0, "new_items": 0, "duplicates": 0, "conflicts": 0},
                "detected_columns": None,
                "detected_metrics": None
            }
        
        # Create import run for preview
        run = await import_service.create_import_run(
            user_id=current_user["id"],
            source=source_enum,
            file_name=file_name,
            file_content=file_content,
            options=import_options
        )
        
        # OPTIMIZATION: Pre-fetch and cache habits once
        habits = await import_service.get_cached_habits(current_user["id"])
        
        items = []
        detected_columns = None
        detected_metrics = None
        total_rows_in_file = 0
        
        if source_enum == ImportSource.CSV:
            # Parse CSV with streaming (don't load entire file structure)
            text_content = file_content.decode('utf-8')
            reader = csv.DictReader(io.StringIO(text_content))
            detected_columns = reader.fieldnames
            
            for i, row in enumerate(reader):
                total_rows_in_file += 1
                if i >= PREVIEW_PARSE_LIMIT:  # Limit for preview
                    continue  # Still count total rows
                
                # Parse date - try multiple columns
                date_col = (import_options.date_column if import_options else None)
                date_val = None
                for col_name in [date_col, 'date', 'Date', 'DATE', 'timestamp', 'Timestamp', 'day', 'Day']:
                    if col_name and col_name in row:
                        date_val = row.get(col_name)
                        if date_val:
                            break
                
                parsed_date = parse_date_flexible(date_val) if date_val else None
                
                # Get value columns from mapping or auto-detect
                if import_options and import_options.column_mappings:
                    for mapping in import_options.column_mappings:
                        val = row.get(mapping.source_column)
                        try:
                            amount = float(val) if val else None
                        except:
                            amount = None
                        
                        items.append(ImportItem(
                            habit_key=mapping.habit_key or f"csv:{mapping.habit_name}",
                            habit_name=mapping.habit_name,
                            date=parsed_date or date_val or '',
                            amount=amount,
                            unit_type=mapping.unit_type,
                            raw_json=row,
                            row_index=i
                        ))
                else:
                    # Auto-detect value columns (non-date numeric columns)
                    for col, val in row.items():
                        if col.lower() in ['date', 'time', 'datetime', 'timestamp', 'day']:
                            continue
                        try:
                            amount = float(val)
                            items.append(ImportItem(
                                habit_key=f"csv:{col}",
                                habit_name=col,
                                date=parsed_date or '',
                                amount=amount,
                                raw_json=row,
                                row_index=i
                            ))
                        except:
                            pass
        
        elif source_enum == ImportSource.SCREENSHOT:
            # Check for OpenAI key
            openai_key = os.getenv("OPENAI_API_KEY")
            if not openai_key:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "OPENAI_KEY_MISSING",
                        "message": "Screenshot import requires an OpenAI API key configured on the server."
                    }
                )
            
            # OPTIMIZATION: For screenshots, we still analyze synchronously since it's a single item
            # but we could move to async with status polling for better UX
            from services.screenshot_analyzer import analyze_screenshot_for_habits
            
            habits_for_analysis = [
                {"id": h.id, "name": h.name, "unit_type": h.unit_type}
                for h in habits
            ]
            
            analysis = analyze_screenshot_for_habits(file_content, habits_for_analysis)
            
            if analysis:
                confidence = analysis.get("confidence", 0.5)
                validation_status = "ok" if confidence >= 0.75 else "warning"
                
                items.append(ImportItem(
                    habit_key=f"screenshot:{analysis.get('detected_type', 'unknown')}",
                    habit_name=analysis.get("habit_name", "Unknown"),
                    date=datetime.utcnow().strftime("%Y-%m-%d"),
                    amount=analysis.get("value"),
                    unit_type=analysis.get("unit"),
                    validation_status=validation_status,
                    raw_json=analysis
                ))
                
                detected_metrics = [{
                    "name": analysis.get("habit_name"),
                    "value": analysis.get("value"),
                    "unit": analysis.get("unit"),
                    "confidence": confidence,
                    "detected_type": analysis.get("detected_type")
                }]
            
            total_rows_in_file = len(items)
        
        # V2: Apply validation rules to all items
        from services.import_validator import (
            ImportValidator, calculate_confidence, ValidationRules, MatchReason
        )
        
        validation_rules = import_options.validation_rules if import_options else None
        validator = ImportValidator(validation_rules or ValidationRules())
        
        # Validate all items and add confidence scores
        for item in items:
            validator.validate_item(item)
            
            # Calculate confidence based on how the item was matched
            match_type = MatchReason.EXACT_NAME  # Default for CSV
            inferred_fields = []
            
            if not item.date or item.date == '':
                inferred_fields.append("date")
            if not item.unit_type:
                inferred_fields.append("unit")
            if source_enum == ImportSource.SCREENSHOT:
                match_type = MatchReason.AI_DETECTED
            
            item.confidence = calculate_confidence(item, match_type, inferred_fields)
        
        # OPTIMIZATION: Bulk duplicate check (2 queries instead of N+1)
        dedupe_estimate = await import_service.check_duplicates_bulk(
            current_user["id"],
            items[:PREVIEW_DEDUPE_CHECK_LIMIT],
            habits=habits
        )
        
        # OPTIMIZATION: Only stage sample items (50 instead of 500)
        # Full staging happens when user clicks "Start Import"
        await import_service.add_import_items_bulk(run.id, items[:PREVIEW_STAGE_LIMIT])
        
        # V2: Calculate validation summary
        validation_issues = [item for item in items[:PREVIEW_SAMPLE_SIZE] if item.validation_status != "ok"]
        errors_count = sum(1 for item in items if item.validation_status == "error")
        warnings_count = sum(1 for item in items if item.validation_status == "warning")
        auto_fixable = sum(
            1 for item in items 
            if any(m.auto_fixable for m in item.validation_messages)
        )
        
        # V2: Calculate confidence summary
        high_conf = sum(1 for item in items if item.confidence and item.confidence.score >= 0.9)
        med_conf = sum(1 for item in items if item.confidence and 0.7 <= item.confidence.score < 0.9)
        low_conf = sum(1 for item in items if item.confidence and item.confidence.score < 0.7)
        
        # Update run status with accurate counts
        await import_service.update_import_run_status(
            run.id,
            ImportStatus.READY,
            summary=ImportRunSummary(
                total_rows=total_rows_in_file or len(items),
                parsed=len(items),
                errors=errors_count
            )
        )
        
        return {
            "import_run_id": run.id,
            "source": source_enum.value,
            "summary": {
                "total_rows": total_rows_in_file or len(items),
                "parsed": len(items),
                "imported": 0,
                "skipped": 0,
                "updated": 0,
                "duplicates": dedupe_estimate.duplicates,
                "errors": errors_count,
                # V2: Enhanced summary
                "will_create": dedupe_estimate.new_items,
                "will_update": dedupe_estimate.conflicts,
                "will_skip": dedupe_estimate.duplicates,
                "has_warnings": warnings_count,
                "has_errors": errors_count,
                "auto_fixable": auto_fixable,
            },
            "sample_items": [item.model_dump() for item in items[:PREVIEW_SAMPLE_SIZE]],
            "validation_issues": [item.model_dump() for item in validation_issues[:20]],
            "dedupe_estimate": dedupe_estimate.model_dump(),
            "detected_columns": detected_columns,
            "detected_metrics": detected_metrics,
            # V2: Confidence summary
            "confidence_summary": {
                "high": high_conf,
                "medium": med_conf,
                "low": low_conf
            },
            # V2: Validation summary
            "validation_summary": {
                "total_errors": errors_count,
                "total_warnings": warnings_count,
                "auto_fixable_count": auto_fixable
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Import preview error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class ImportStartRequest(BaseModel):
    """Request to start importing"""
    import_run_id: Optional[str] = None
    conflict_policy: str = "skip_existing"
    create_habits: bool = True  # Whether to auto-create habits that don't exist


@app.post("/api/import/runs/{run_id}/start")
async def start_import(
    run_id: str,
    start_request: ImportStartRequest,
    current_user = Depends(get_current_user)
):
    """
    Start the actual import process.
    Uses chunked processing for large imports.
    """
    try:
        run = await import_service.get_import_run(run_id, current_user["id"])
        if not run:
            raise HTTPException(status_code=404, detail="Import run not found")

        if start_request.import_run_id and start_request.import_run_id != run_id:
            raise HTTPException(status_code=400, detail="Path run_id and payload import_run_id do not match")

        if run.status == ImportStatus.IMPORTING:
            async with _import_tasks_lock:
                task = _import_tasks.get(run_id)
                if task and not task.done():
                    return JSONResponse(
                        status_code=202,
                        content={
                            "status": "importing",
                            "import_run_id": run_id,
                            "message": "Import is already running in the background",
                        },
                    )

        if run.status not in [ImportStatus.READY, ImportStatus.IMPORTING]:
            raise HTTPException(
                status_code=400,
                detail=f"Import run is not ready. Current status: {run.status.value}"
            )

        if run.status == ImportStatus.READY:
            await import_service.update_import_run_status(run_id, ImportStatus.IMPORTING)

        async with _import_tasks_lock:
            existing = _import_tasks.get(run_id)
            if existing and not existing.done():
                return JSONResponse(
                    status_code=202,
                    content={
                        "status": "importing",
                        "import_run_id": run_id,
                        "message": "Import is already running in the background",
                    },
                )

            _import_tasks[run_id] = asyncio.create_task(
                _run_import_job(
                    run_id=run_id,
                    user_id=current_user["id"],
                    conflict_policy_raw=start_request.conflict_policy,
                    create_habits=start_request.create_habits,
                )
            )

        return JSONResponse(
            status_code=202,
            content={
                "status": "importing",
                "import_run_id": run_id,
                "message": "Import started in background",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Start import error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def _run_import_job(
    run_id: str,
    user_id: str,
    conflict_policy_raw: str,
    create_habits: bool
) -> None:
    """
    Execute a long-running import in a background task.
    """
    try:
        run = await import_service.get_import_run(run_id, user_id)
        if not run:
            return

        items = await import_service.get_import_items(run_id, limit=10000)
        total_items = len(items)

        if total_items == 0:
            await import_service.update_import_run_status(
                run_id,
                ImportStatus.COMPLETED,
                summary=ImportRunSummary()
            )
            return

        await import_service.update_import_progress(run_id, 0, total_items)

        try:
            conflict_policy = ConflictPolicy(conflict_policy_raw)
        except ValueError:
            conflict_policy = ConflictPolicy.SKIP_EXISTING

        from collections import defaultdict
        items_by_habit = defaultdict(list)
        for item in items:
            items_by_habit[item.habit_key].append(item)

        from models.import_models import BatchLogCreate, BatchLogsRequest as BatchRequest

        summary = ImportRunSummary(total_rows=total_items)
        created_habit_ids = []
        existing_habits = await habits_service.get_habits(user_id)

        def fuzzy_match_habit(csv_name: str, existing_habits: list) -> tuple:
            SYNONYMS = {
                "sleep": ["sleep", "rest", "slept", "sleeping", "bed", "nap"],
                "duration": ["duration", "time", "hours", "length", "total"],
                "steps": ["steps", "step", "walking", "walk", "walked", "footsteps"],
                "workout": ["workout", "exercise", "training", "gym", "fitness"],
                "run": ["run", "running", "jog", "jogging"],
                "caffeine": ["caffeine", "coffee", "tea", "espresso", "energy"],
                "water": ["water", "hydration", "drink", "fluid", "h2o"],
                "calories": ["calories", "cal", "kcal", "energy", "food"],
                "meditation": ["meditation", "meditate", "mindfulness", "mindful", "zen", "calm"],
                "reading": ["reading", "read", "book", "pages", "literature"],
                "screen": ["screen", "screentime", "phone", "device", "digital"],
                "heart": ["heart", "hr", "heartrate", "pulse", "bpm"],
                "weight": ["weight", "mass", "kg", "lbs", "pounds"],
            }

            UNIT_INFERENCE = {
                "_mg": "Milligrams", "mg": "Milligrams", "milligrams": "Milligrams",
                "_hours": "Hours", "hours": "Hours", "_hrs": "Hours", "hrs": "Hours",
                "_minutes": "Minutes", "minutes": "Minutes", "_mins": "Minutes", "mins": "Minutes",
                "_min": "Minutes",
                "_seconds": "Seconds", "seconds": "Seconds", "_secs": "Seconds",
                "_count": "Count", "count": "Count", "_num": "Count",
                "_pages": "Pages", "pages": "Pages",
                "_miles": "Miles", "miles": "Miles", "_mi": "Miles",
                "_km": "Kilometers", "kilometers": "Kilometers",
                "_glasses": "Glasses", "glasses": "Glasses", "_cups": "Cups", "cups": "Cups",
                "_cal": "Calories", "_kcal": "Calories", "calories": "Calories",
                "_bpm": "BPM", "bpm": "BPM",
                "_kg": "Kilograms", "kg": "Kilograms",
                "_lbs": "Pounds", "lbs": "Pounds", "pounds": "Pounds",
            }

            def get_synonym_group(word: str) -> set:
                result = {word}
                for key, synonyms in SYNONYMS.items():
                    if word in synonyms or key == word:
                        result.update(synonyms)
                        result.add(key)
                return result

            def infer_unit(name: str) -> str:
                name_lower = name.lower()
                for pattern, unit in UNIT_INFERENCE.items():
                    if name_lower.endswith(pattern) or pattern in name_lower.split("_"):
                        return unit
                return "Count"

            def tokenize(name: str) -> set:
                import re
                name = name.replace("_", " ").replace("-", " ").replace(".", " ")
                name = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
                return {w.lower() for w in name.split() if len(w) >= 2}

            def calculate_match_score(csv_words: set, habit_words: set) -> float:
                if not csv_words or not habit_words:
                    return 0

                csv_expanded = set()
                for w in csv_words:
                    csv_expanded.update(get_synonym_group(w))

                habit_expanded = set()
                for w in habit_words:
                    habit_expanded.update(get_synonym_group(w))

                direct_overlap = csv_words & habit_words
                if direct_overlap:
                    return 0.95

                synonym_overlap = csv_expanded & habit_expanded
                if synonym_overlap:
                    return 0.85

                for cw in csv_words:
                    for hw in habit_words:
                        if len(cw) >= 4 and len(hw) >= 4:
                            min_len = min(len(cw), len(hw))
                            prefix_len = 0
                            for i in range(min_len):
                                if cw[i] == hw[i]:
                                    prefix_len += 1
                                else:
                                    break
                            if prefix_len >= 4:
                                return 0.75

                return 0

            csv_words = tokenize(csv_name)
            inferred_unit = infer_unit(csv_name)
            best_match = None
            best_score = 0

            for h in existing_habits:
                habit_words = tokenize(h.name)

                if csv_name.lower().replace("_", " ") == h.name.lower():
                    return (h.id, 1.0, inferred_unit)

                score = calculate_match_score(csv_words, habit_words)
                if h.unit_type and inferred_unit.lower() == h.unit_type.lower():
                    score = min(score + 0.05, 1.0)

                if score > best_score:
                    best_match = h.id
                    best_score = score

            return (best_match, best_score, inferred_unit) if best_score >= 0.5 else (None, 0, inferred_unit)

        for habit_key, habit_items in items_by_habit.items():
            latest_run = await import_service.get_import_run(run_id, user_id)
            if latest_run and latest_run.status == ImportStatus.CANCELED:
                return

            habit_name = habit_items[0].habit_name or habit_key.split(":")[-1]
            unit_type = habit_items[0].unit_type
            habit_id = None

            for h in existing_habits:
                if h.metric_type and h.metric_type == habit_key.split(":")[-1]:
                    habit_id = h.id
                    print(f"✅ Matched '{habit_name}' to existing habit '{h.name}' by metric_type")
                    break

            if not habit_id:
                matched_id, confidence, inferred_unit = fuzzy_match_habit(habit_name, existing_habits)
                if matched_id:
                    habit_id = matched_id
                    matched_habit = next((h for h in existing_habits if h.id == matched_id), None)
                    print(f"✅ Fuzzy matched '{habit_name}' to existing habit '{matched_habit.name}' (confidence: {confidence:.0%})")
                elif not unit_type:
                    unit_type = inferred_unit
                    print(f"📋 Inferred unit '{inferred_unit}' for new habit '{habit_name}'")

            if not habit_id and create_habits:
                source_prefix = habit_key.split(":")[0] if ":" in habit_key else "csv"
                metric_type = habit_key.split(":")[-1] if ":" in habit_key else None

                category_map = {
                    "steps": "health", "hr": "health", "hrv": "health",
                    "sleep": "health", "active_energy": "health",
                    "screen_time": "wellness", "meetings": "productivity"
                }
                category = category_map.get(metric_type, "other")

                new_habit = await habits_service.create_habit(
                    HabitCreate(
                        name=habit_name,
                        category=category,
                        unit_type=unit_type or "count",
                        is_custom=True,
                        integration_source=source_prefix if source_prefix in ["apple_health", "whoop", "oura", "garmin"] else "import",
                        metric_type=metric_type
                    ),
                    user_id
                )
                habit_id = new_habit.id
                created_habit_ids.append(habit_id)

            if not habit_id:
                summary.skipped += len(habit_items)
                continue

            logs = [
                BatchLogCreate(
                    habit_id=habit_id,
                    date=item.date,
                    amount=item.amount,
                    unit_type=item.unit_type,
                    source=f"{run.source.value}_import",
                    dedupe_key=item.dedupe_key
                )
                for item in habit_items
                if item.date
            ]

            if logs:
                batch_req = BatchRequest(
                    import_run_id=run_id,
                    conflict_policy=conflict_policy,
                    logs=logs
                )

                result = await import_service.create_logs_batch(user_id, batch_req)

                summary.imported += result.inserted
                summary.updated += result.updated
                summary.skipped += result.skipped
                summary.errors += result.errors

                habit_for_tinybird = await habits_service.get_habit_by_id(habit_id, user_id)
                if habit_for_tinybird and tinybird_service:
                    synced_count = 0
                    for log_result in result.results:
                        if log_result.status in ["inserted", "updated"] and log_result.log_id:
                            log_data = logs[log_result.index] if log_result.index < len(logs) else None
                            if log_data:
                                try:
                                    await tinybird_service.ingest_habit_log({
                                        'id': log_result.log_id,
                                        'habit_id': habit_id,
                                        'habit_name': habit_for_tinybird.name,
                                        'user_id': user_id,
                                        'date': log_data.date,
                                        'duration': log_data.duration or 0,
                                        'amount': log_data.amount or 0,
                                        'unit': habit_for_tinybird.unit_type or 'count',
                                        'status': 'completed',
                                        'notes': log_data.notes or '',
                                        'completed_at': datetime.utcnow().isoformat(),
                                        'source': log_data.source or f'{run.source.value}_import'
                                    })
                                    synced_count += 1
                                except Exception as tb_err:
                                    print(f"⚠️ Tinybird sync error for log {log_result.log_id}: {tb_err}")

                    if synced_count > 0:
                        print(f"📊 Synced {synced_count} logs to Tinybird for habit '{habit_for_tinybird.name}'")

            processed = summary.imported + summary.updated + summary.skipped + summary.errors
            await import_service.update_import_progress(run_id, processed, total_items)

        summary.created_habit_ids = created_habit_ids
        await import_service.update_import_run_status(
            run_id,
            ImportStatus.COMPLETED,
            summary=summary
        )

    except asyncio.CancelledError:
        await import_service.update_import_run_status(run_id, ImportStatus.CANCELED)
        raise
    except Exception as e:
        await import_service.update_import_run_status(
            run_id,
            ImportStatus.FAILED,
            errors=[{"error": str(e)}]
        )
        print(f"❌ Import background job failed ({run_id}): {str(e)}")
    finally:
        async with _import_tasks_lock:
            _import_tasks.pop(run_id, None)


@app.post("/api/import/runs/{run_id}/cancel")
async def cancel_import(
    run_id: str,
    current_user = Depends(get_current_user)
):
    """
    Cancel an in-progress import.
    """
    try:
        run = await import_service.get_import_run(run_id, current_user["id"])
        if not run:
            raise HTTPException(status_code=404, detail="Import run not found")
        
        if run.status not in [ImportStatus.CREATED, ImportStatus.PARSING, ImportStatus.READY, ImportStatus.IMPORTING]:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot cancel import in status: {run.status.value}"
            )

        task_canceled = False
        async with _import_tasks_lock:
            task = _import_tasks.get(run_id)
            if task and not task.done():
                task.cancel()
                task_canceled = True
        
        await import_service.update_import_run_status(run_id, ImportStatus.CANCELED)
        
        return {
            "status": "canceled",
            "import_run_id": run_id,
            "task_canceled": task_canceled
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Cancel import error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ================================
# V2: MAPPING TEMPLATES ENDPOINTS
# ================================

from models.import_models import MappingPresetCreate, MappingPreset, ImportHistoryFilters


@app.post("/api/import/templates")
async def create_mapping_template(
    template: MappingPresetCreate,
    current_user = Depends(get_current_user)
):
    """
    V2: Create a reusable mapping template for imports.
    Templates can be saved and reused across multiple imports.
    """
    try:
        import uuid
        import json
        from database.connection import get_db_session
        from database.models import ImportMappingPresetDB
        
        template_id = str(uuid.uuid4())
        
        async with get_db_session() as session:
            preset_db = ImportMappingPresetDB(
                id=template_id,
                user_id=current_user["id"],
                name=template.name,
                source=template.source.value,
                mapping_json=json.dumps({
                    "description": template.description,
                    "mapping": template.mapping.model_dump(),
                    "example_sources": template.example_sources,
                    "tags": template.tags
                }),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            session.add(preset_db)
            await session.commit()
        
        return {
            "id": template_id,
            "name": template.name,
            "source": template.source.value,
            "created_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        print(f"❌ Create template error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/import/templates")
async def list_mapping_templates(
    source: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    V2: List all mapping templates for the user.
    Optionally filter by source type.
    """
    try:
        import json
        from database.connection import get_db_session
        from database.models import ImportMappingPresetDB
        from sqlalchemy import select, and_
        
        async with get_db_session() as session:
            query = select(ImportMappingPresetDB).where(
                ImportMappingPresetDB.user_id == current_user["id"]
            )
            
            if source:
                query = query.where(ImportMappingPresetDB.source == source)
            
            query = query.order_by(ImportMappingPresetDB.updated_at.desc())
            
            result = await session.execute(query)
            presets = result.scalars().all()
            
            templates = []
            for preset in presets:
                mapping_data = json.loads(preset.mapping_json) if preset.mapping_json else {}
                templates.append({
                    "id": preset.id,
                    "name": preset.name,
                    "source": preset.source,
                    "description": mapping_data.get("description"),
                    "example_sources": mapping_data.get("example_sources", []),
                    "tags": mapping_data.get("tags", []),
                    "created_at": preset.created_at.isoformat() if preset.created_at else None,
                    "updated_at": preset.updated_at.isoformat() if preset.updated_at else None
                })
            
            return {"templates": templates}
        
    except Exception as e:
        print(f"❌ List templates error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/import/templates/{template_id}")
async def get_mapping_template(
    template_id: str,
    current_user = Depends(get_current_user)
):
    """
    V2: Get a specific mapping template.
    """
    try:
        import json
        from database.connection import get_db_session
        from database.models import ImportMappingPresetDB
        from sqlalchemy import select, and_
        
        async with get_db_session() as session:
            result = await session.execute(
                select(ImportMappingPresetDB).where(
                    and_(
                        ImportMappingPresetDB.id == template_id,
                        ImportMappingPresetDB.user_id == current_user["id"]
                    )
                )
            )
            preset = result.scalar_one_or_none()
            
            if not preset:
                raise HTTPException(status_code=404, detail="Template not found")
            
            mapping_data = json.loads(preset.mapping_json) if preset.mapping_json else {}
            
            return {
                "id": preset.id,
                "name": preset.name,
                "source": preset.source,
                "description": mapping_data.get("description"),
                "mapping": mapping_data.get("mapping"),
                "example_sources": mapping_data.get("example_sources", []),
                "tags": mapping_data.get("tags", []),
                "created_at": preset.created_at.isoformat() if preset.created_at else None,
                "updated_at": preset.updated_at.isoformat() if preset.updated_at else None
            }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Get template error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/import/templates/{template_id}")
async def delete_mapping_template(
    template_id: str,
    current_user = Depends(get_current_user)
):
    """
    V2: Delete a mapping template.
    """
    try:
        from database.connection import get_db_session
        from database.models import ImportMappingPresetDB
        from sqlalchemy import select, and_
        
        async with get_db_session() as session:
            result = await session.execute(
                select(ImportMappingPresetDB).where(
                    and_(
                        ImportMappingPresetDB.id == template_id,
                        ImportMappingPresetDB.user_id == current_user["id"]
                    )
                )
            )
            preset = result.scalar_one_or_none()
            
            if not preset:
                raise HTTPException(status_code=404, detail="Template not found")
            
            await session.delete(preset)
            await session.commit()
            
            return {"deleted": True, "id": template_id}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Delete template error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ================================
# V2: AUTO-FIX ENDPOINT
# ================================

@app.post("/api/import/runs/{run_id}/auto-fix")
async def auto_fix_import_items(
    run_id: str,
    current_user = Depends(get_current_user)
):
    """
    V2: Apply auto-fixes to all fixable validation issues in an import run.
    Returns summary of fixes applied.
    """
    try:
        from services.import_validator import ImportValidator
        
        # Get the import run
        run = await import_service.get_import_run(run_id, current_user["id"])
        if not run:
            raise HTTPException(status_code=404, detail="Import run not found")
        
        # Get all items with validation issues
        items = await import_service.get_import_items(run_id, limit=10000)
        
        # Initialize validator with rules from import options
        rules = run.options.validation_rules if run.options else None
        validator = ImportValidator(rules)
        
        # Apply auto-fixes
        fixed_count = 0
        for item in items:
            if any(m.auto_fixable for m in item.validation_messages):
                validator.auto_fix_item(item)
                fixed_count += 1
        
        # Update staged items
        await import_service.clear_import_items(run_id)
        await import_service.add_import_items_bulk(run_id, items[:500])
        
        return {
            "import_run_id": run_id,
            "items_fixed": fixed_count,
            "total_items": len(items)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Auto-fix error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ================================
# V2: ENHANCED IMPORT HISTORY
# ================================

@app.get("/api/import/history")
async def get_import_history_filtered(
    source: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    has_errors: Optional[bool] = None,
    search: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    current_user = Depends(get_current_user)
):
    """
    V2: Get import history with advanced filtering.
    """
    try:
        import json
        from database.connection import get_db_session
        from database.models import ImportRunDB
        from sqlalchemy import select, and_, or_
        
        async with get_db_session() as session:
            query = select(ImportRunDB).where(ImportRunDB.user_id == current_user["id"])
            
            # Apply filters
            conditions = []
            
            if source:
                conditions.append(ImportRunDB.source == source)
            
            if status:
                conditions.append(ImportRunDB.status == status)
            
            if date_from:
                conditions.append(ImportRunDB.created_at >= datetime.fromisoformat(date_from))
            
            if date_to:
                conditions.append(ImportRunDB.created_at <= datetime.fromisoformat(date_to + "T23:59:59"))
            
            if search:
                conditions.append(ImportRunDB.file_name.ilike(f"%{search}%"))
            
            if conditions:
                query = query.where(and_(*conditions))
            
            # Order by most recent first
            query = query.order_by(ImportRunDB.created_at.desc())
            query = query.offset(offset).limit(limit)
            
            result = await session.execute(query)
            runs = result.scalars().all()
            
            # Format response
            history = []
            for run in runs:
                summary = json.loads(run.summary_json) if run.summary_json else {}
                
                # Filter by has_errors if specified
                if has_errors is not None:
                    run_has_errors = summary.get("errors", 0) > 0
                    if has_errors != run_has_errors:
                        continue
                
                history.append({
                    "id": run.id,
                    "source": run.source,
                    "file_name": run.file_name,
                    "status": run.status,
                    "created_at": run.created_at.isoformat() if run.created_at else None,
                    "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                    "summary": summary,
                    "undo_available": run.undo_available,
                    "progress_current": run.progress_current,
                    "progress_total": run.progress_total
                })
            
            return {
                "runs": history,
                "total": len(history),
                "offset": offset,
                "limit": limit
            }
        
    except Exception as e:
        print(f"❌ Get history error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/import/runs/{run_id}/export")
async def export_import_run_data(
    run_id: str,
    format: str = "json",  # json or csv
    current_user = Depends(get_current_user)
):
    """
    V2: Export parsed data from an import run for debugging.
    """
    try:
        import json
        
        # Get the import run
        run = await import_service.get_import_run(run_id, current_user["id"])
        if not run:
            raise HTTPException(status_code=404, detail="Import run not found")
        
        # Get all items
        items = await import_service.get_import_items(run_id, limit=10000)
        
        if format == "csv":
            import io
            import csv
            
            output = io.StringIO()
            writer = csv.writer(output)
            
            # Header
            writer.writerow([
                "habit_key", "habit_name", "date", "amount", "unit_type",
                "validation_status", "conflict_status", "row_index"
            ])
            
            # Data
            for item in items:
                writer.writerow([
                    item.habit_key,
                    item.habit_name,
                    item.date,
                    item.amount,
                    item.unit_type,
                    item.validation_status,
                    item.conflict_status,
                    item.row_index
                ])
            
            return {
                "format": "csv",
                "data": output.getvalue(),
                "filename": f"import_{run_id}.csv"
            }
        
        else:  # JSON
            return {
                "format": "json",
                "import_run": run.model_dump(),
                "items": [item.model_dump() for item in items],
                "filename": f"import_{run_id}.json"
            }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Export error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ================================
# SEARCH API - Typesense Integration
# ================================

from services.search_service import search_service


@app.get("/api/search")
async def global_search(
    q: str = "",
    collections: Optional[str] = None,  # Comma-separated: habits,logs,conversations,activity
    limit: int = 10,
    current_user = Depends(get_current_user)
):
    """
    Global federated search across all collections.
    Used by the Command Palette (⌘K).
    """
    try:
        collection_list = collections.split(",") if collections else None
        
        results = await search_service.search_global(
            query=q,
            user_id=current_user["id"],
            collections=collection_list,
            limit=limit
        )
        
        return results
        
    except Exception as e:
        print(f"❌ Search error: {str(e)}")
        # Return fallback results instead of error
        return search_service._fallback_search(q)


@app.get("/api/search/habits")
async def search_habits_endpoint(
    q: str = "",
    limit: int = 10,
    include_inactive: bool = False,
    current_user = Depends(get_current_user)
):
    """
    Search habits with autocomplete.
    Used for habit selector and quick logging.
    """
    try:
        results = await search_service.search_habits(
            query=q,
            user_id=current_user["id"],
            limit=limit,
            include_inactive=include_inactive
        )
        
        return {"hits": results, "found": len(results)}
        
    except Exception as e:
        print(f"❌ Habit search error: {str(e)}")
        return {"hits": [], "found": 0}


@app.get("/api/search/logs")
async def search_logs_endpoint(
    q: str = "",
    habit_ids: Optional[str] = None,  # Comma-separated
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 50,
    current_user = Depends(get_current_user)
):
    """
    Search habit logs with filters.
    Used by Activity page enhanced search.
    """
    try:
        habit_id_list = habit_ids.split(",") if habit_ids else None
        
        results = await search_service.search_logs(
            query=q,
            user_id=current_user["id"],
            habit_ids=habit_id_list,
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )
        
        return results
        
    except Exception as e:
        print(f"❌ Log search error: {str(e)}")
        return {"hits": [], "found": 0}


@app.post("/api/search/reindex")
async def reindex_user_data(
    current_user = Depends(get_current_user)
):
    """
    Reindex all data for a user.
    Called on first login or manual refresh.
    """
    try:
        from database.connection import get_db_session
        from database.models import HabitDB, HabitLogDB, AIMessageDB
        from sqlalchemy import select
        
        user_id = current_user["id"]
        indexed_counts = {"habits": 0, "logs": 0, "messages": 0}
        
        async with get_db_session() as session:
            # Index habits
            habits_result = await session.execute(
                select(HabitDB).where(HabitDB.user_id == user_id)
            )
            habits = habits_result.scalars().all()
            
            habit_docs = []
            for h in habits:
                habit_docs.append({
                    "id": h.id,
                    "name": h.name,
                    "category": h.category,
                    "icon": h.icon,
                    "unit_type": h.unit_type,
                    "metric_type": h.metric_type,
                    "is_active": h.is_active,
                    "goal": h.goal,
                    "created_at": h.created_at,
                    "updated_at": h.updated_at,
                    "aliases": [],
                })
            
            await search_service.bulk_index_habits(habit_docs, user_id)
            indexed_counts["habits"] = len(habit_docs)
            
            # Index logs (last 90 days)
            from datetime import datetime, timedelta
            ninety_days_ago = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
            
            logs_result = await session.execute(
                select(HabitLogDB, HabitDB.name, HabitDB.category)
                .join(HabitDB, HabitLogDB.habit_id == HabitDB.id)
                .where(HabitDB.user_id == user_id)
                .where(HabitLogDB.date >= ninety_days_ago)
            )
            logs = logs_result.all()
            
            log_docs = []
            for log, habit_name, category in logs:
                log_docs.append({
                    "id": log.id,
                    "habit_id": log.habit_id,
                    "habit_name": habit_name,
                    "category": category,
                    "date": log.date,
                    "amount": log.amount,
                    "duration": log.duration,
                    "unit_type": log.unit_type,
                    "status": log.status,
                    "notes": log.notes,
                    "source": log.source,
                    "created_at": log.completed_at,
                })
            
            await search_service.bulk_index_logs(log_docs, user_id)
            indexed_counts["logs"] = len(log_docs)
        
        return {
            "success": True,
            "indexed": indexed_counts,
            "message": f"Indexed {indexed_counts['habits']} habits and {indexed_counts['logs']} logs"
        }
        
    except Exception as e:
        print(f"❌ Reindex error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/suggestions")
async def get_suggestions(
    mode: str = "chat",  # "log" or "chat"
    q: str = "",
    current_user = Depends(get_current_user)
):
    """
    Personalized suggestions for the dashboard chat input.
    
    Log mode: habit autocomplete + recently logged habits (powered by Typesense)
    Chat mode: personalized question suggestions based on user's habits
    """
    try:
        suggestions = await search_service.get_suggestions(
            user_id=current_user["id"],
            mode=mode,
            query=q,
        )
        return {"suggestions": suggestions, "mode": mode, "query": q}
    except Exception as e:
        print(f"❌ Suggestions error: {str(e)}")
        return {"suggestions": [], "mode": mode, "query": q}


@app.post("/api/search/index-phrase")
async def index_log_phrase(
    data: dict,
    current_user = Depends(get_current_user)
):
    """
    Index a raw log phrase after successful habit logging.
    
    This powers learned phrase matching: "I consumed" → Caffeine Consumption.
    Called by the frontend after the AI chat successfully logs a habit.
    """
    try:
        input_text = data.get("input_text", "")
        habit_id = data.get("habit_id", "")
        habit_name = data.get("habit_name", "")
        value = data.get("value")
        unit = data.get("unit")
        
        if not input_text or not habit_id:
            return {"success": False, "message": "input_text and habit_id required"}
        
        await search_service.index_log_phrase(
            user_id=current_user["id"],
            input_text=input_text,
            habit_id=habit_id,
            habit_name=habit_name,
            value=value,
            unit=unit,
        )
        
        return {"success": True}
    except Exception as e:
        print(f"❌ Index phrase error: {str(e)}")
        return {"success": False, "message": str(e)}


@app.get("/api/search/status")
async def search_status():
    """Check if Typesense search is available"""
    return {
        "available": search_service.is_available,
        "message": "Search service is ready" if search_service.is_available else "Typesense not configured"
    }


# ================================
# WATCHER API ROUTER - Computer Activity Tracking
# ================================

from api.watcher import router as watcher_router
app.include_router(watcher_router)


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
    logger.info("🖥️ Watcher API ready for computer activity tracking")

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
