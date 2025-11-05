"""
Ritual FastAPI Backend
Mirrors the current TypeScript habits-service.ts interface exactly
"""

from fastapi import FastAPI, HTTPException, Depends, status, Header, Request
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
from models.habit_models import Habit, HabitLog, HabitCreate, HabitUpdate, HabitLogCreate
from models.user_models import OnboardingData, UserProfile
from database.connection import get_db_session
from database.models import WhoopIntegrationDB
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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
        
        # Parse tracking_interests from JSON string (handle NULL safely)
        tracking_interests = None
        if user.tracking_interests:
            try:
                tracking_interests = json.loads(user.tracking_interests)
            except Exception as parse_error:
                print(f"⚠️  Could not parse tracking_interests: {parse_error}")
                tracking_interests = []
        
        # Parse wearable_devices from JSON string (handle NULL safely)
        wearable_devices = None
        if user.wearable_devices:
            try:
                wearable_devices = json.loads(user.wearable_devices)
            except Exception as parse_error:
                print(f"⚠️  Could not parse wearable_devices: {parse_error}")
                wearable_devices = []
        
        # Return profile with safe defaults for NULL fields
        return UserProfile(
            id=user.id,
            email=user.email,
            full_name=user.full_name or "",
            age_bracket=user.age_bracket,
            gender=user.gender,
            country=user.country,
            tracking_interests=tracking_interests,
            wearable_devices=wearable_devices,
            onboarding_completed=bool(user.onboarding_completed),
            created_at=user.created_at,
            updated_at=user.updated_at
        )
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
        
        # Parse tracking_interests for response
        tracking_interests = []
        if user.tracking_interests:
            try:
                tracking_interests = json.loads(user.tracking_interests)
            except:
                tracking_interests = []
        
        # Parse wearable_devices for response
        wearable_devices = []
        if user.wearable_devices:
            try:
                wearable_devices = json.loads(user.wearable_devices)
            except:
                wearable_devices = []
        
        print(f"✅ Onboarding updated successfully for user {current_user['id']}")
        
        return UserProfile(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            age_bracket=user.age_bracket,
            gender=user.gender,
            country=user.country,
            tracking_interests=tracking_interests,
            wearable_devices=wearable_devices,
            onboarding_completed=user.onboarding_completed,
            created_at=user.created_at,
            updated_at=user.updated_at
        )
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
    Get habit breakdown by category from SQLite
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
        
        # Get Whoop user info
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
            "is_active": integration.is_active
        }
        
    except Exception as e:
        print(f"❌ Error checking Whoop status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/integrations/whoop/sync")
async def whoop_sync(days_back: int = 7, current_user = Depends(get_current_user)):
    """
    Sync data from Whoop API
    """
    try:
        print(f"🔄 Starting Whoop sync for user {current_user['id']}")
        result = await whoop_service.sync_whoop_data(current_user["id"], days_back)
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
    """
    try:
        # Verify internal API key
        if internal_key != os.getenv("INTERNAL_API_KEY"):
            raise HTTPException(status_code=403, detail="Invalid internal API key")
        
        print(f"🔄 Starting bulk Whoop sync for all users")
        
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
                result = await whoop_service.sync_whoop_data(integration.user_id, days_back=2)
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
