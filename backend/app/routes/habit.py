# app/routes/habit.py
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from typing import List
import uuid

from app.models.habit import Habit
from app.schemas.habit import HabitCreate, HabitResponse, HabitUpdate
from app.dependencies import get_db, get_current_user
from app.models.user import Profile

router = APIRouter(
    tags=["Habits"]
)

# Test endpoint without authentication (for testing only)
@router.post("/test", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_test_habit(habit: HabitCreate, db: Session = Depends(get_db)):
    """Test endpoint to create a habit without authentication - for testing only"""
    # Use a dummy user ID for testing
    test_user_id = "test-user-123"
    db_habit = Habit(**habit.dict(), id=uuid.uuid4(), user_id=test_user_id)
    db.add(db_habit)
    db.commit()
    db.refresh(db_habit)
    return {"message": "Test habit created successfully", "habit": db_habit}

# Test delete endpoint without authentication (for testing only)
@router.delete("/test/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test_habit(habit_id: str, db: Session = Depends(get_db)):
    """Test endpoint to delete a habit without authentication - for testing only"""
    # Use the same dummy user ID for testing
    test_user_id = "test-user-123"
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == test_user_id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    db.delete(habit)
    db.commit()
    return None

# Test get endpoint without authentication (for testing only)
@router.get("/test", response_model=List[HabitResponse])
def get_test_habits(db: Session = Depends(get_db)):
    """Test endpoint to get habits without authentication - for testing only"""
    # Use the same dummy user ID for testing
    test_user_id = "test-user-123"
    return db.query(Habit).filter(Habit.user_id == test_user_id).all()

@router.get("/", response_model=List[HabitResponse])
def get_habits(current_user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all habits for the authenticated user"""
    print(f"🎯 [ROUTE DEBUG] get_habits called for user: {current_user.id if current_user else 'None'}")
    habits = db.query(Habit).filter(Habit.user_id == current_user.id).all()
    return habits


@router.post("/", response_model=HabitResponse, status_code=status.HTTP_201_CREATED)
def create_habit(habit: HabitCreate, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    db_habit = Habit(**habit.dict(), id=uuid.uuid4(), user_id=current_user.id)
    db.add(db_habit)
    db.commit()
    db.refresh(db_habit)
    return db_habit


@router.get("/{habit_id}", response_model=HabitResponse)
def get_habit(habit_id: str, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    return habit


@router.put("/{habit_id}", response_model=HabitResponse)
def update_habit(habit_id: str, habit_update: HabitUpdate, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    
    update_data = habit_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(habit, field, value)
    
    db.commit()
    db.refresh(habit)
    return habit


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(habit_id: str, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    db.delete(habit)
    db.commit()
    return None

# Test endpoint to check if frontend can reach backend
@router.get("/debug/test")
def test_connection():
    """Test endpoint that doesn't require authentication"""
    return {"message": "✅ Backend connection working!", "timestamp": "now"}

# Test endpoint to see what headers we're receiving
@router.get("/debug/headers")
def test_headers(request: Request):
    """Test endpoint to see what headers the frontend is sending"""
    headers = dict(request.headers)
    print(f"🔍 [DEBUG] Received headers: {headers}")
    return {"headers": headers}

# Super simple auth test endpoint
@router.get("/debug/auth-test")
def test_auth(current_user: Profile = Depends(get_current_user)):
    """Simple test that requires authentication"""
    return {"message": f"✅ Authenticated as user: {current_user.id}", "email": getattr(current_user, 'email', 'unknown')}
