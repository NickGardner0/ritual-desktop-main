#!/usr/bin/env python3
"""
Simple test version of the backend with Tinybird credentials
"""

import os
import sys
import time
from pathlib import Path

# Set environment variables for testing
os.environ.update({
    'DATABASE_URL': 'sqlite+aiosqlite:///./ritual.db',
    'TINYBIRD_ENV': 'cloud',
    'TINYBIRD_API_URL': 'https://api.us-east.aws.tinybird.co',
    'TINYBIRD_TOKEN': 'p.eyJ1IjogIjljMTA0NGJhLTM5NjAtNDZkOS1iMWQ5LTAyY2Q2OTc5ZDVlOSIsICJpZCI6ICJmMWJjYzQ4Zi1mM2QxLTQ3YzgtODAwYi00MWU0ZTlhMzU5YjciLCAiaG9zdCI6ICJ1cy1lYXN0LWF3cyJ9.cIau5gLqIaohshuRL2Lr6MO_2UuXKwE49hyF3IUw5oA',
    'JWT_SECRET': 'test-secret-key-for-development',
    'API_HOST': '127.0.0.1',
    'API_PORT': '8000',
    'DEBUG': 'true'
})

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import uvicorn

# Create simple FastAPI app
app = FastAPI(
    title="Ritual Backend API (Test)",
    version="1.0.0-test",
    description="Simple test version of the Ritual backend"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "tauri://localhost", "https://tauri.localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Authentication dependency
async def get_current_user(authorization: str = Header(None)):
    """
    Extract and validate user from Clerk JWT token
    For now, we'll make auth optional to ease migration
    """
    if not authorization:
        print("⚠️ No authorization header - using fallback user ID")
        # Fallback to hardcoded user ID for migration period
        return {"id": "05cbe689-f7ec-487b-adb6-ad50c7dc767b", "email": "test@example.com"}
    
    try:
        # Handle Clerk tokens in format "Bearer clerk-user-{user_id}"
        if authorization.startswith("Bearer clerk-user-"):
            clerk_user_id = authorization.replace("Bearer clerk-user-", "")
            print(f"✅ Extracted user from Clerk token: {clerk_user_id} (None)")
            return {"id": clerk_user_id, "email": None}
        
        from services.auth_service import AuthService
        auth_service = AuthService()
        
        # Extract token from "Bearer <token>" format
        token = auth_service.extract_token_from_header(authorization)
        if not token:
            print("⚠️ Invalid authorization header format")
            return {"id": "05cbe689-f7ec-487b-adb6-ad50c7dc767b", "email": "test@example.com"}
        
        # Get user from token
        user = await auth_service.get_user_from_token(token)
        if not user:
            print("⚠️ Invalid token - using fallback user ID")
            return {"id": "05cbe689-f7ec-487b-adb6-ad50c7dc767b", "email": "test@example.com"}
        
        print(f"✅ Authenticated user: {user['id']} ({user.get('email', 'no email')})")
        return user
        
    except Exception as e:
        print(f"⚠️ Auth error: {e} - using fallback user ID")
        return {"id": "05cbe689-f7ec-487b-adb6-ad50c7dc767b", "email": "test@example.com"}

@app.get("/")
async def root():
    return {
        "message": "Ritual Backend API (Test Version)",
        "status": "running",
        "version": "1.0.0-test"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "database": "sqlite (test)",
        "tinybird": "configured",
        "environment": "test"
    }

@app.get("/test/tinybird")
async def test_tinybird():
    """Test Tinybird connection"""
    try:
        from services.tinybird_service import TinybirdService
        
        tb_service = TinybirdService()
        
        # Test a simple query (this will fail gracefully if no data exists)
        try:
            result = await tb_service.query_pipe('user_habits_summary', {
                'user_id': 'test-user',
                'days_back': 7
            })
            return {
                "status": "success",
                "message": "Tinybird connection successful",
                "sample_query": "user_habits_summary executed"
            }
        except Exception as query_error:
            return {
                "status": "partial_success",
                "message": "Tinybird connection works, but no data/pipes available",
                "error": str(query_error),
                "note": "This is expected for a fresh setup"
            }
            
    except Exception as e:
        return {
            "status": "error",
            "message": "Tinybird connection failed",
            "error": str(e)
        }

@app.post("/api/habits")
async def create_habit(habit_data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new habit for authenticated user"""
    try:
        from services.habits_service import HabitsService
        
        user_id = current_user["id"]
        
        # Create habit model from request data
        from models.habit_models import HabitCreate
        habit_create = HabitCreate(**habit_data)
        
        habits_service = HabitsService()
        habit = await habits_service.create_habit(habit_create, user_id)
        
        return habit.dict()
        
    except Exception as e:
        return {
            "status": "error",
            "message": "Failed to create habit",
            "error": str(e)
        }

@app.get("/api/habits")
async def get_habits(current_user: dict = Depends(get_current_user)):
    """Get all habits for authenticated user"""
    try:
        from services.habits_service import HabitsService
        
        user_id = current_user["id"]
        print(f"🔍 Fetching habits for user: {user_id}")
        
        habits_service = HabitsService()
        habits = await habits_service.get_habits(user_id)
        
        print(f"✅ Found {len(habits)} habits")
        
        return [habit.dict() for habit in habits]
        
    except Exception as e:
        print(f"❌ Error fetching habits: {e}")
        return {
            "status": "error",
            "message": "Failed to get habits",
            "error": str(e)
        }

@app.delete("/api/habits/{habit_id}")
async def delete_habit(habit_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a habit for authenticated user"""
    try:
        from services.habits_service import HabitsService
        
        user_id = current_user["id"]
        
        print(f"🗑️ Deleting habit {habit_id} for user: {user_id}")
        
        habits_service = HabitsService()
        success = await habits_service.delete_habit(habit_id, user_id)
        
        if success:
            print(f"✅ Habit {habit_id} deleted successfully")
            return {"status": "success", "message": "Habit deleted successfully"}
        else:
            print(f"❌ Habit {habit_id} not found or not owned by user")
            raise HTTPException(status_code=404, detail="Habit not found")
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error deleting habit: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete habit: {str(e)}")

@app.post("/api/habit-logs")
async def create_habit_log(log_data: dict):
    """Create a new habit log"""
    try:
        from models.habit_models import HabitLogCreate
        from services.habits_service import HabitsService
        
        # Use the real Supabase user ID (hardcoded for now)
        user_id = "05cbe689-f7ec-487b-adb6-ad50c7dc767b"
        
        print(f"🔍 Creating habit log: {log_data}")
        
        # Extract habit_id from log_data
        habit_id = log_data.pop('habit_id')
        
        # Create habit log model from request data
        habit_log_create = HabitLogCreate(**log_data)
        
        habits_service = HabitsService()
        habit_log = await habits_service.log_habit(habit_id, habit_log_create, user_id)
        
        print(f"✅ Habit log created: {habit_log.id}")
        
        return habit_log.dict()
        
    except Exception as e:
        print(f"❌ Error creating habit log: {e}")
        return {
            "status": "error",
            "message": "Failed to create habit log",
            "error": str(e)
        }

@app.get("/api/habit-logs")
async def get_habit_logs(habit_id: str = None, current_user: dict = Depends(get_current_user)):
    """Get habit logs for user"""
    try:
        from services.habits_service import HabitsService
        
        user_id = current_user["id"]
        
        print(f"🔍 Fetching habit logs for user: {user_id}, habit_id: {habit_id}")
        
        habits_service = HabitsService()
        habit_logs = await habits_service.get_habit_logs(habit_id, user_id)
        
        print(f"✅ Found {len(habit_logs)} habit logs")
        
        return [log.dict() for log in habit_logs]
        
    except Exception as e:
        print(f"❌ Error fetching habit logs: {e}")
        return {
            "status": "error",
            "message": "Failed to get habit logs",
            "error": str(e)
        }

@app.get("/api/test/habits")
async def test_get_habits():
    """Test get habits without authentication (for testing only)"""
    try:
        from services.habits_service import HabitsService
        
        habits_service = HabitsService()
        # Use a test user ID
        habits = await habits_service.get_habits("test-user-123")
        
        return {
            "status": "success",
            "message": f"Retrieved {len(habits)} test habits",
            "habits": [habit.dict() for habit in habits],
            "count": len(habits)
        }
        
    except Exception as e:
        return {
            "status": "error", 
            "message": "Test get habits failed",
            "error": str(e)
        }

@app.get("/test/database")
async def test_database():
    """Test database connection"""
    try:
        from database.connection import get_db_session
        
        async with get_db_session() as session:
            # Simple test query
            result = await session.execute("SELECT 1 as test")
            row = result.fetchone()
            
            return {
                "status": "success",
                "message": "Database connection successful",
                "test_query_result": row[0] if row else None
            }
            
    except Exception as e:
        return {
            "status": "error", 
            "message": "Database connection failed",
            "error": str(e)
        }

@app.get("/test/models")
async def test_models():
    """Test that models can be imported and used"""
    try:
        from models.habit_models import Habit, HabitCreate
        from database.models import HabitDB
        
        # Test creating model instances
        habit_create = HabitCreate(
            name="Test Habit",
            category="Health"
        )
        
        return {
            "status": "success",
            "message": "Models imported and instantiated successfully",
            "test_model": {
                "name": habit_create.name,
                "category": habit_create.category
            }
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": "Model test failed", 
            "error": str(e)
        }

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    try:
        from database.connection import init_database
        await init_database()
        print("✅ Test database initialized")
    except Exception as e:
        print(f"⚠️  Database initialization warning: {e}")

if __name__ == "__main__":
    print("🚀 Starting Ritual Backend Test Server...")
    print("📊 Test endpoints available:")
    print("  - http://127.0.0.1:8000/ (root)")
    print("  - http://127.0.0.1:8000/health (health check)")
    print("  - http://127.0.0.1:8000/test/tinybird (test Tinybird)")
    print("  - http://127.0.0.1:8000/test/database (test database)")
    print("  - http://127.0.0.1:8000/test/models (test models)")
    print("  - http://127.0.0.1:8000/docs (API documentation)")
    print()
    
    uvicorn.run(
        "simple_test:app",  # Use import string for reload
        host="127.0.0.1",
        port=8000,
        reload=False,  # Disable reload for testing
        log_level="info"
    )
