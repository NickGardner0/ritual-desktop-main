"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class FinancialConnectionDB(Base):
    """Canonical connection state for a financial provider."""
    __tablename__ = "financial_connections"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    provider = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")  # active, paused, error, revoked
    access_token = Column(Text, nullable=True)
    item_id = Column(String, nullable=True)
    institution_id = Column(String, nullable=True)
    institution_name = Column(String, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_successful_sync_at = Column(DateTime, nullable=True)
    last_error_json = Column(Text, nullable=True)
    settings_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_financial_connections_user_provider", "user_id", "provider", unique=True),
    )





class FinancialAccountDB(Base):
    """Normalized financial accounts for a provider connection."""
    __tablename__ = "financial_accounts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=False)
    provider_account_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    official_name = Column(String, nullable=True)
    mask = Column(String, nullable=True)
    account_type = Column(String, nullable=False)
    account_subtype = Column(String, nullable=True)
    currency = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    connection = orm_relationship("FinancialConnectionDB")

    __table_args__ = (
        Index("idx_financial_accounts_user_provider_account", "user_id", "provider_account_id", unique=True),
        Index("idx_financial_accounts_connection_active", "connection_id", "is_active"),
    )





class FinancialTransactionDB(Base):
    """Raw normalized transactions used for financial rollups."""
    __tablename__ = "financial_transactions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=False)
    account_id = Column(String, ForeignKey("financial_accounts.id"), nullable=False)
    provider_transaction_id = Column(String, nullable=False)
    transaction_date = Column(String, nullable=False)
    authorized_at = Column(DateTime, nullable=True)
    posted_at = Column(DateTime, nullable=True)
    name = Column(String, nullable=False)
    merchant_name = Column(String, nullable=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=True)
    direction = Column(String, nullable=False)  # outflow, inflow
    pending = Column(Boolean, default=False)
    raw_category_json = Column(Text, nullable=True)
    raw_transaction_code = Column(String, nullable=True)
    counts_toward_spending = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    connection = orm_relationship("FinancialConnectionDB")
    account = orm_relationship("FinancialAccountDB")

    __table_args__ = (
        Index(
            "idx_financial_transactions_user_provider_transaction",
            "user_id",
            "provider_transaction_id",
            unique=True,
        ),
        Index("idx_financial_transactions_user_date", "user_id", "transaction_date"),
        Index("idx_financial_transactions_user_spending", "user_id", "counts_toward_spending", "transaction_date"),
    )





class FinancialSyncCursorDB(Base):
    """Per-connection cursor state for financial syncs."""
    __tablename__ = "financial_sync_cursors"

    id = Column(String, primary_key=True)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=False)
    cursor_key = Column(String, nullable=False)
    cursor_value = Column(Text, nullable=False)
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    connection = orm_relationship("FinancialConnectionDB")

    __table_args__ = (
        Index("idx_financial_sync_cursors_connection_key", "connection_id", "cursor_key", unique=True),
    )





class FinancialSyncRunDB(Base):
    """Observable sync runs for financial provider troubleshooting."""
    __tablename__ = "financial_sync_runs"

    id = Column(String, primary_key=True)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=True)
    provider = Column(String, nullable=False)
    trigger = Column(String, nullable=False)  # manual, backfill, scheduled
    status = Column(String, nullable=False, default="running")  # running, success, partial, failed
    started_at = Column(DateTime, default=_utcnow_naive)
    completed_at = Column(DateTime, nullable=True)
    items_seen = Column(Integer, default=0)
    items_written = Column(Integer, default=0)
    items_updated = Column(Integer, default=0)
    items_deleted = Column(Integer, default=0)
    error_json = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

    connection = orm_relationship("FinancialConnectionDB")



