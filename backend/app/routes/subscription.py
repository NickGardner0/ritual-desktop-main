# app/routes/subscription.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
import uuid

from app.models.subscription import Subscription
from app.schemas.subscription import SubscriptionCreate, SubscriptionResponse
from app.dependencies import get_db, get_current_user
from app.models.user import Profile

router = APIRouter(tags=["Subscriptions"])

@router.get("/", response_model=List[SubscriptionResponse])
def get_subscriptions(db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    return db.query(Subscription).filter(Subscription.user_id == current_user.id).all()

@router.post("/", response_model=SubscriptionResponse)
def create_subscription(sub: SubscriptionCreate, db: Session = Depends(get_db), current_user: Profile = Depends(get_current_user)):
    db_sub = Subscription(**sub.dict(), id=uuid.uuid4(), user_id=current_user.id)
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    return db_sub