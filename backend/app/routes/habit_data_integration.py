# app/routes/habit_data_integration.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
import uuid

from app.models.habit_data_integration import HabitDataIntegration
from app.schemas.habit_data_integration import HabitDataIntegrationCreate, HabitDataIntegrationResponse
from app.dependencies import get_db, get_current_user
from app.models.user import Profile

router = APIRouter(tags=["Habit Data Integrations"])

@router.get("/", response_model=List[HabitDataIntegrationResponse])
def get_data(db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    return db.query(HabitDataIntegration).filter(HabitDataIntegration.user_id == current_user.id).all()

@router.post("/", response_model=HabitDataIntegrationResponse)
def create_data(entry: HabitDataIntegrationCreate, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    db_entry = HabitDataIntegration(**entry.dict(), id=uuid.uuid4(), user_id=current_user.id)
    db.add(db_entry)
    db.commit()
    db.refresh(db_entry)
    return db_entry