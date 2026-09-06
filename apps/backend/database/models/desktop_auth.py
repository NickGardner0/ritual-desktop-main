"""Channel-bound desktop authentication handoffs."""

from sqlalchemy import Column, DateTime, Index, String, Text

from database.models.base import Base, _utcnow_naive


class DesktopAuthHandoffDB(Base):
    """One short-lived, one-time browser-to-native authentication handoff."""

    __tablename__ = "desktop_auth_handoffs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    nonce_hash = Column(String, nullable=False)
    channel = Column(String, nullable=False)
    protocol = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    failure_code = Column(String, nullable=True)
    native_metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    __table_args__ = (
        Index("idx_desktop_auth_handoff_user_created", "user_id", "created_at"),
        Index("idx_desktop_auth_handoff_status_expiry", "status", "expires_at"),
    )
