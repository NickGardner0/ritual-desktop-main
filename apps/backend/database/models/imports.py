"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



# ================================
# IMPORT SYSTEM - Robust Import Infrastructure
# ================================

class ImportRunDB(Base):
    """
    Tracks every import as a first-class object for undo, progress tracking, and audit.
    """
    __tablename__ = "import_runs"
    
    id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    
    # Source info
    source = Column(String, nullable=False)  # csv, screenshot, apple_health, whoop, oura, garmin
    file_name = Column(String, nullable=True)
    file_hash_sha256 = Column(String, nullable=True)  # For duplicate file detection
    file_size = Column(Integer, nullable=True)
    
    # Status tracking
    status = Column(String, nullable=False, default="created")  # created, parsing, ready, importing, completed, failed, canceled, undone
    
    # Timestamps
    created_at = Column(DateTime, default=_utcnow_naive)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Configuration
    options_json = Column(Text, nullable=True)  # JSON: {aggregation, conflict_policy, date_range, mapping, etc.}
    
    # Results
    summary_json = Column(Text, nullable=True)  # JSON: {total_rows, imported, skipped, updated, duplicates, errors, created_habit_ids}
    error_json = Column(Text, nullable=True)  # JSON: structured error list
    
    # Progress tracking
    progress_current = Column(Integer, default=0)
    progress_total = Column(Integer, default=0)
    
    # Undo support
    undo_available = Column(Boolean, default=False)
    undone_at = Column(DateTime, nullable=True)
    # V2: Enhanced undo with expiration and rollback package
    undo_expires_at = Column(DateTime, nullable=True)  # When undo expires (e.g., 7 days)
    undo_package_json = Column(Text, nullable=True)  # JSON: {logs_created, logs_updated, habits_created}
    
    # Relationships
    user = orm_relationship("UserDB")
    items = orm_relationship("ImportItemDB", back_populates="import_run", cascade="all, delete-orphan")
    logs = orm_relationship("HabitLogDB", back_populates="import_run")





class ImportItemDB(Base):
    """
    Staging table for import preview - stores normalized items that WOULD be imported.
    Allows user to review exactly what will be written before confirming.
    """
    __tablename__ = "import_items"
    
    id = Column(String, primary_key=True)  # UUID
    import_run_id = Column(String, ForeignKey("import_runs.id", ondelete="CASCADE"), nullable=False)
    
    # Data
    habit_key = Column(String, nullable=False)  # Stable key: integration_source:metric_type or csv:habit_name
    habit_name = Column(String, nullable=True)  # Display name
    date = Column(String, nullable=False)  # YYYY-MM-DD
    amount = Column(Float, nullable=True)
    unit_type = Column(String, nullable=True)
    
    # Original data
    raw_json = Column(Text, nullable=True)  # JSON string of original row/record
    row_index = Column(Integer, nullable=True)  # Original row number for CSV
    
    # Validation
    validation_status = Column(String, default="ok")  # ok, warning, error
    validation_messages = Column(Text, nullable=True)  # JSON array of validation messages
    
    # Deduplication
    dedupe_key = Column(String, nullable=True)  # For conflict detection
    conflict_status = Column(String, nullable=True)  # null, duplicate, conflict
    existing_log_id = Column(String, nullable=True)  # ID of existing log if conflict
    
    # Relationships
    import_run = orm_relationship("ImportRunDB", back_populates="items")





class ImportMappingPresetDB(Base):
    """
    User-saved mapping presets for wearable and CSV imports.
    Allows users to reuse column mappings across multiple imports.
    """
    __tablename__ = "import_mapping_presets"
    
    id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    
    # Preset info
    name = Column(String, nullable=False)
    source = Column(String, nullable=False)  # csv, whoop, oura, garmin, etc.
    
    # Mapping configuration
    mapping_json = Column(Text, nullable=False)  # JSON: column mappings, units, aggregation settings
    
    # Timestamps
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    
    # Relationships
    user = orm_relationship("UserDB")



