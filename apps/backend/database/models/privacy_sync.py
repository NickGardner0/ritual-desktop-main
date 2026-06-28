"""Zero-knowledge private sync envelope and device models."""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text

from database.models.base import Base, _utcnow_naive


class PrivateSyncEnvelopeDB(Base):
    """Client-encrypted vault record envelope for optional Private Sync."""

    __tablename__ = "private_sync_envelopes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    envelope_id = Column(String, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    collection = Column(String, nullable=False)
    record_id = Column(String, nullable=False)
    record_type = Column(String, nullable=False)
    revision = Column(Integer, nullable=False)
    server_revision = Column(Integer, nullable=False)
    key_version = Column(Integer, nullable=False, default=1)
    algorithm = Column(String, nullable=False)
    nonce = Column(Text, nullable=False)
    ciphertext = Column(Text, nullable=False)
    aad = Column(Text, nullable=False)
    ciphertext_sha256 = Column(String, nullable=False)
    tombstone = Column(Boolean, nullable=False, default=False)
    client_updated_at = Column(String, nullable=True)
    client_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    __table_args__ = (
        Index("idx_private_sync_envelopes_user_envelope", "user_id", "envelope_id", unique=True),
        Index("idx_private_sync_envelopes_user_server_revision", "user_id", "server_revision"),
        Index("idx_private_sync_envelopes_user_collection", "user_id", "collection", "record_id"),
    )


class PrivateSyncDeviceDB(Base):
    """Per-user trusted device metadata for optional Private Sync."""

    __tablename__ = "private_sync_devices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_name = Column(String, nullable=False)
    platform = Column(String, nullable=True)
    public_key = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="pending")
    registered_at = Column(DateTime, default=_utcnow_naive)
    trusted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    __table_args__ = (
        Index("idx_private_sync_devices_user_device", "user_id", "device_id", unique=True),
        Index("idx_private_sync_devices_user_status", "user_id", "status"),
    )


class PrivateSyncKeyGrantDB(Base):
    """Opaque encrypted key grant from one trusted device to another."""

    __tablename__ = "private_sync_key_grants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    grant_id = Column(String, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sender_device_id = Column(String, nullable=False)
    recipient_device_id = Column(String, nullable=False)
    key_version = Column(Integer, nullable=False)
    algorithm = Column(String, nullable=False)
    nonce = Column(Text, nullable=False)
    ciphertext = Column(Text, nullable=False)
    aad = Column(Text, nullable=False)
    ciphertext_sha256 = Column(String, nullable=False)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    __table_args__ = (
        Index("idx_private_sync_key_grants_user_grant", "user_id", "grant_id", unique=True),
        Index("idx_private_sync_key_grants_user_recipient", "user_id", "recipient_device_id"),
    )
