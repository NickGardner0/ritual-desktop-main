# app/routes/user.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.models.user import Profile
from app.dependencies import get_db, get_current_user  # assuming you have these
import uuid

router = APIRouter(
    prefix="/users",
    tags=["Users"]
)

@router.get("/me", response_model=UserResponse)
def get_my_profile(current_user: Profile = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserResponse)
def update_my_profile(
    user_update: UserUpdate,
    db: Session = Depends(get_db),
    current_user: Profile = Depends(get_current_user)
):
    for key, value in user_update.dict(exclude_unset=True).items():
        setattr(current_user, key, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/register", response_model=UserResponse)
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = Profile(
        id=uuid.uuid4(),
        email=user.email,
        full_name=user.full_name,
        birth_year=user.birth_year,
        gender=user.gender,
        country=user.country
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
