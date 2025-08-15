"""
SQLAlchemy ORM model for Trackable Items on the Index page
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
# from sqlalchemy.orm import relationship # If you plan to have relationships later
from app.utils.database import Base

class TrackableItem(Base):
    __tablename__ = "trackable_items"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False) # Assuming this is the Supabase user ID
    name = Column(String, nullable=False, index=True)
    metrics_description = Column(Text, nullable=True) # The free-form text for stats/metrics

    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.now)

    # If you add relationships, for example, to a User table defined elsewhere:
    # owner = relationship("User", back_populates="trackable_items")

    def __repr__(self):
        return f"<TrackableItem(id='{self.id}', name='{self.name}', user_id='{self.user_id}')>" 