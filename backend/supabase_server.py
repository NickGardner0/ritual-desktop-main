#!/usr/bin/env python3
"""
Supabase-integrated server for Ritual habit tracking
Uses the existing Habit model and Supabase PostgreSQL database
"""

import sys
import os
sys.path.append('.')

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid
from typing import Optional
from sqlalchemy import text

# Import existing models and database setup
from app.utils.database import get_db, engine, Base
from app.models.habit import Habit
from app.utils.supabase import get_supabase_admin_client

# Create tables if they don't exist
Base.metadata.create_all(bind=engine)

# Pydantic models for API
class HabitCreate(BaseModel):
    name: str
    category: str
    is_custom: bool = True
    unit_type: Optional[str] = None
    integration_source: Optional[str] = None

class HabitResponse(BaseModel):
    id: str
    name: str
    category: str
    is_custom: bool
    unit_type: Optional[str] = None
    integration_source: Optional[str] = None
    user_id: Optional[str] = None

    class Config:
        from_attributes = True

# FastAPI app
app = FastAPI(title="Ritual API - Supabase Edition")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Ritual API with Supabase is running! 🚀"}

@app.post("/habits", response_model=dict)
def create_habit(habit: HabitCreate, db: Session = Depends(get_db)):
    """Create a new habit - connected to Supabase"""
    try:
        # Check what tables we have
        tables_result = db.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """))
        tables = [row[0] for row in tables_result.fetchall()]
        print(f"Available tables in public schema: {tables}")
        
        # Check if there are any existing users in auth.users
        try:
            auth_users_result = db.execute(text("SELECT id FROM auth.users LIMIT 1"))
            existing_auth_user = auth_users_result.fetchone()
            
            if existing_auth_user:
                auth_user_id = existing_auth_user[0]
                print(f"Found existing auth user: {auth_user_id}")
                
                # Check if this user has a profile
                profile_result = db.execute(text("SELECT id FROM profiles WHERE id = :user_id"), {"user_id": auth_user_id})
                existing_profile = profile_result.fetchone()
                
                if existing_profile:
                    user_id = existing_profile[0]
                    print(f"Using existing profile: {user_id}")
                else:
                    # Create profile for existing auth user
                    db.execute(text("""
                        INSERT INTO profiles (id, created_at, updated_at) 
                        VALUES (:id, NOW(), NOW())
                    """), {"id": auth_user_id})
                    db.commit()
                    user_id = auth_user_id
                    print(f"Created profile for existing auth user: {user_id}")
            else:
                print("No auth users found. Creating a temporary solution...")
                raise Exception("No auth users available")
                
        except Exception as auth_error:
            print(f"Could not access auth.users or no users exist: {auth_error}")
            
            # Alternative approach: Temporarily disable foreign key constraint for testing
            # This is a development workaround - NOT for production
            try:
                print("🔧 Development workaround: Attempting to create habit without profile constraint...")
                
                # Check if we can create a habit directly (maybe the constraint can be NULL)
                # Let's examine the habits table structure first
                habits_columns_result = db.execute(text("""
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns 
                    WHERE table_name = 'habits' AND table_schema = 'public'
                    ORDER BY ordinal_position
                """))
                habits_columns = habits_columns_result.fetchall()
                print("Habits table structure:")
                for col in habits_columns:
                    print(f"  {col[0]}: {col[1]} (nullable: {col[2]}, default: {col[3]})")
                
                # Check if user_id in habits table can be nullable
                user_id_column = next((col for col in habits_columns if col[0] == 'user_id'), None)
                if user_id_column and user_id_column[2] == 'YES':  # is_nullable = YES
                    print("user_id is nullable in habits table - trying without user_id...")
                    # Create habit without user_id
                    db_habit = Habit(
                        id=uuid.uuid4(),
                        user_id=None,  # Set to None since it's nullable
                        name=habit.name,
                        category=habit.category,
                        is_custom=habit.is_custom,
                        unit_type=habit.unit_type,
                        integration_source=habit.integration_source
                    )
                else:
                    print("user_id is required - using a dummy UUID (this might fail)")
                    # This will likely fail, but let's see the exact error
                    dummy_user_id = str(uuid.uuid4())
                    db_habit = Habit(
                        id=uuid.uuid4(),
                        user_id=dummy_user_id,
                        name=habit.name,
                        category=habit.category,
                        is_custom=habit.is_custom,
                        unit_type=habit.unit_type,
                        integration_source=habit.integration_source
                    )
                
                db.add(db_habit)
                db.commit()  
                db.refresh(db_habit)
                
                return {
                    "message": "Habit created successfully (development mode)! 🎉", 
                    "id": str(db_habit.id),
                    "name": db_habit.name,
                    "category": db_habit.category,
                    "is_custom": db_habit.is_custom,
                    "unit_type": db_habit.unit_type,
                    "user_id": str(db_habit.user_id) if db_habit.user_id else "none",
                    "note": "Created without proper user authentication (development only)"
                }
                
            except Exception as fallback_error:
                print(f"Fallback approach also failed: {fallback_error}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Cannot create habit without proper user authentication. You need to either: 1) Sign up a user through Supabase Auth, or 2) Modify the database constraints for development. Error: {str(fallback_error)}"
                )
        
        # If we get here, we have a valid user_id
        # Create the habit
        db_habit = Habit(
            id=uuid.uuid4(),
            user_id=user_id,
            name=habit.name,
            category=habit.category,
            is_custom=habit.is_custom,
            unit_type=habit.unit_type,
            integration_source=habit.integration_source
        )
        
        db.add(db_habit)
        db.commit()
        db.refresh(db_habit)
        
        return {
            "message": "Habit created successfully in Supabase! 🎉", 
            "id": str(db_habit.id),
            "name": db_habit.name,
            "category": db_habit.category,
            "is_custom": db_habit.is_custom,
            "unit_type": db_habit.unit_type,
            "user_id": str(db_habit.user_id)
        }
        
    except HTTPException:
        raise  # Re-raise HTTP exceptions as-is
    except Exception as e:
        print(f"Error creating habit: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create habit: {str(e)}")

@app.get("/habits", response_model=list)
def get_habits(db: Session = Depends(get_db)):
    """Get all habits from Supabase"""
    try:
        habits = db.query(Habit).all()
        return [{
            "id": str(h.id), 
            "name": h.name, 
            "category": h.category, 
            "is_custom": h.is_custom, 
            "unit_type": h.unit_type,
            "user_id": str(h.user_id),
            "created_at": str(h.created_at)
        } for h in habits]
    except Exception as e:
        print(f"Error fetching habits: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch habits: {str(e)}")

@app.get("/habits/test-connection")
def test_supabase_connection():
    """Test Supabase connection"""
    try:
        supabase = get_supabase_admin_client()
        # Test connection by getting table info
        result = supabase.table('habits').select('count').execute()
        return {"message": "✅ Supabase connection successful!", "connection": "active"}
    except Exception as e:
        return {"message": f"❌ Supabase connection failed: {str(e)}", "connection": "failed"}

if __name__ == "__main__":
    print("🚀 Starting Ritual API with Supabase on http://localhost:8000")
    print("📊 This server connects to your actual Supabase database")
    uvicorn.run(app, host="0.0.0.0", port=8000) 