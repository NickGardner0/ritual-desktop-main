"""SQLAlchemy model for computed behavior baselines used by ambient scoring."""

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive


class BehaviorBaselineSnapshotDB(Base):
    """Computed behavior baselines used to score ambient interventions."""
    __tablename__ = "behavior_baseline_snapshots"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    metric_key = Column(String, nullable=False)
    lookback_days = Column(Integer, nullable=False, default=14)
    baseline_json = Column(Text, nullable=False)
    computed_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")
