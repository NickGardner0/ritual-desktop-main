# app/routes/habit_unit.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.models.habit_unit import HabitUnit
from app.schemas.habit_unit import HabitUnitResponse
from app.dependencies import get_db

router = APIRouter(tags=["Habit Units"])

@router.get("/", response_model=List[HabitUnitResponse])
def get_units(db: Session = Depends(get_db)):
    return db.query(HabitUnit).all()