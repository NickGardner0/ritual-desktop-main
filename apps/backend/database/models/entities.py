"""Entity Protocol persistence: authored references between addressable objects."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive


class EntityReferenceDB(Base):
    """User or agent authored reference between two addressable entities."""

    __tablename__ = "entity_references"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source_type = Column(String, nullable=False)
    source_id = Column(String, nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    relationship = Column(String, nullable=False, default="references")
    provenance = Column(String, nullable=False, default="user")
    anchor_json = Column(Text, nullable=True)
    client_event_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    deleted_at = Column(DateTime, nullable=True)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_entity_references_user_source", "user_id", "source_type", "source_id"),
        Index("idx_entity_references_user_target", "user_id", "target_type", "target_id"),
        Index(
            "idx_entity_references_user_client_event",
            "user_id",
            "client_event_id",
            unique=True,
            sqlite_where=text("client_event_id IS NOT NULL"),
        ),
    )
