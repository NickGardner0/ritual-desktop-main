"""
Service layer for TrackableItem CRUD operations.
"""

from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models.db.trackable_item import TrackableItem as DBTrackableItem
from app.models.trackable_item import TrackableItemCreate, TrackableItemUpdate, TrackableItemResponse

class TrackableItemService:
    def __init__(self, db: Session):
        self.db = db

    async def create_trackable_item(
        self, 
        item_in: TrackableItemCreate, 
        user_id: str
    ) -> DBTrackableItem:
        """Create a new trackable item for a user."""
        db_item = DBTrackableItem(**item_in.model_dump(), user_id=user_id)
        self.db.add(db_item)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item

    async def get_trackable_items_by_user(
        self, 
        user_id: str, 
        skip: int = 0, 
        limit: int = 100
    ) -> List[DBTrackableItem]:
        """Retrieve all trackable items for a specific user with pagination."""
        return self.db.query(DBTrackableItem).filter(DBTrackableItem.user_id == user_id).offset(skip).limit(limit).all()

    async def get_trackable_item(
        self, 
        item_id: str, 
        user_id: str
    ) -> Optional[DBTrackableItem]:
        """Retrieve a single trackable item by ID, ensuring it belongs to the user."""
        item = self.db.query(DBTrackableItem).filter(DBTrackableItem.id == item_id, DBTrackableItem.user_id == user_id).first()
        return item

    async def update_trackable_item(
        self, 
        item_id: str, 
        item_in: TrackableItemUpdate, 
        user_id: str
    ) -> Optional[DBTrackableItem]:
        """Update an existing trackable item."""
        db_item = await self.get_trackable_item(item_id, user_id)
        if not db_item:
            return None

        update_data = item_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_item, key, value)
        
        self.db.add(db_item)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item

    async def delete_trackable_item(
        self, 
        item_id: str, 
        user_id: str
    ) -> Optional[DBTrackableItem]:
        """Delete a trackable item."""
        db_item = await self.get_trackable_item(item_id, user_id)
        if not db_item:
            return None
        
        self.db.delete(db_item)
        self.db.commit()
        return db_item 