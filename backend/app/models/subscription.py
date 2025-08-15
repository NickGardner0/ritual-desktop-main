from sqlalchemy import Column, String, Boolean, Enum, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .db import Base

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    plan = Column(Enum("free", "trial", "core", name="subscription_plan"), nullable=False)
    status = Column(Enum("active", "expired", "cancelled", name="subscription_status"), nullable=False)
    is_trial = Column(Boolean, default=False)
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
