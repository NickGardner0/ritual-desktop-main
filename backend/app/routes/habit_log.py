# app/routes/habit_log.py
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
import uuid

from app.models.habit_log import HabitLog
from app.models.habit import Habit
from app.schemas.habit_log import HabitLogCreate, HabitLogResponse, HabitLogUpdate
from app.dependencies import get_db, get_current_user
from app.models.user import Profile

router = APIRouter(tags=["Habit Logs"])

# Test endpoint without authentication (for testing only)
@router.post("/test", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_test_log(log: HabitLogCreate, db: Session = Depends(get_db)):
    """Test endpoint to create a habit log without authentication - for testing only"""
    try:
        print(f"🧪 [TEST] Creating test habit log: {log.dict()}")
        
        # Use a fixed test user ID to avoid foreign key issues
        test_user_id = "12345678-1234-1234-1234-123456789012"
        print(f"🧪 [TEST] Using fixed test user ID: {test_user_id}")
        
        # Check if test profile exists, if not create it
        test_profile = db.query(Profile).filter(Profile.id == test_user_id).first()
        if not test_profile:
            print(f"🧪 [TEST] Creating dummy profile with ID: {test_user_id}")
            dummy_profile = Profile(
                id=test_user_id,
                email="test@ritual.com",
                full_name="Test User",
                birth_year=1990,
                gender="other",
                country="US"
            )
            db.add(dummy_profile)
            db.commit()
            print(f"🧪 [TEST] Dummy profile created successfully")
        
        # Convert habit_id to proper UUID if it's a string
        habit_id = log.habit_id
        if not habit_id.startswith('test-habit-'):
            # If it's already a UUID, use it
            habit_uuid = habit_id
        else:
            # Create a proper UUID from the test habit ID
            habit_uuid = str(uuid.uuid4())
        
        print(f"🧪 [TEST] Using habit UUID: {habit_uuid}")
        
        # Check if habit exists, if not create a dummy one
        habit = db.query(Habit).filter(Habit.id == habit_uuid).first()
        if not habit:
            print(f"🧪 [TEST] Creating dummy habit with ID: {habit_uuid}")
            # Create a dummy habit for testing
            dummy_habit = Habit(
                id=habit_uuid,
                user_id=test_user_id,
                name="Deep Work Test",
                category="manual",  # Use valid category: "manual" or "wearable"
                is_custom=True,
                unit_type="duration"
            )
            db.add(dummy_habit)
            db.commit()
            print(f"🧪 [TEST] Dummy habit created successfully")
        
        # Create the log with proper UUIDs
        log_data = log.dict()
        log_data['habit_id'] = habit_uuid
        
        db_log = HabitLog(**log_data, id=str(uuid.uuid4()), user_id=test_user_id)
        db.add(db_log)
        db.commit()
        db.refresh(db_log)
        
        print(f"🧪 [TEST] Habit log created successfully: {db_log.id}")
        return {"message": "Test habit log created successfully", "log_id": str(db_log.id), "habit_id": habit_uuid}
        
    except Exception as e:
        print(f"🧪 [TEST] Error creating test log: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Test endpoint error: {str(e)}")

@router.get("/", response_model=List[HabitLogResponse])
def get_logs(
    habit_id: Optional[str] = Query(None, description="Filter by habit ID"),
    start_date: Optional[date] = Query(None, description="Start date for filtering"),
    end_date: Optional[date] = Query(None, description="End date for filtering"),
    db: Session = Depends(get_db), 
    current_user: Profile = Depends(get_current_user)
):
    query = db.query(HabitLog).filter(HabitLog.user_id == current_user.id)
    
    if habit_id:
        query = query.filter(HabitLog.habit_id == habit_id)
    if start_date:
        query = query.filter(HabitLog.date >= start_date)
    if end_date:
        query = query.filter(HabitLog.date <= end_date)
    
    return query.order_by(HabitLog.date.desc()).all()

@router.post("/", response_model=HabitLogResponse)
def create_log(log: HabitLogCreate, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    # Verify habit belongs to user
    habit = db.query(Habit).filter(Habit.id == log.habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    
    db_log = HabitLog(**log.dict(), id=uuid.uuid4(), user_id=current_user.id)
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log

@router.get("/{log_id}", response_model=HabitLogResponse)
def get_log(log_id: str, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    log = db.query(HabitLog).filter(HabitLog.id == log_id, HabitLog.user_id == current_user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Habit log not found")
    return log

@router.put("/{log_id}", response_model=HabitLogResponse)
def update_log(log_id: str, log_update: HabitLogUpdate, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    log = db.query(HabitLog).filter(HabitLog.id == log_id, HabitLog.user_id == current_user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Habit log not found")
    
    update_data = log_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(log, field, value)
    
    db.commit()
    db.refresh(log)
    return log

@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(log_id: str, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    log = db.query(HabitLog).filter(HabitLog.id == log_id, HabitLog.user_id == current_user.id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Habit log not found")
    db.delete(log)
    db.commit()
    return None