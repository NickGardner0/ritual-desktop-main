# app/routes/predefined_habit.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.models.predefined_habit import PredefinedHabit
from app.schemas.predefined_habit import PredefinedHabitResponse
from app.dependencies import get_db

router = APIRouter(tags=["Predefined Habits"])

@router.get("/", response_model=List[PredefinedHabitResponse])
def get_predefined_habits(db: Session = Depends(get_db)):
    return db.query(PredefinedHabit).all()