"""
Pydantic models for the robust import system.
Handles import runs, items, previews, and batch operations.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any
from datetime import datetime
from enum import Enum


# ================================
# ENUMS
# ================================

class ImportSource(str, Enum):
    CSV = "csv"
    SCREENSHOT = "screenshot"
    APPLE_HEALTH = "apple_health"
    WHOOP = "whoop"
    OURA = "oura"
    GARMIN = "garmin"
    FITBIT = "fitbit"


class ImportStatus(str, Enum):
    CREATED = "created"
    PARSING = "parsing"
    READY = "ready"
    IMPORTING = "importing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    UNDONE = "undone"


class ConflictPolicy(str, Enum):
    SKIP_EXISTING = "skip_existing"
    OVERWRITE_EXISTING = "overwrite_existing"
    MERGE_SUM = "merge_sum"
    MERGE_AVG = "merge_avg"


class AggregationPeriod(str, Enum):
    RAW = "raw"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class ValidationStatus(str, Enum):
    OK = "ok"
    WARNING = "warning"
    ERROR = "error"


# ================================
# IMPORT OPTIONS
# ================================

class ColumnMapping(BaseModel):
    """Mapping configuration for a single column in CSV import"""
    source_column: str
    habit_name: str
    habit_key: Optional[str] = None
    unit_type: Optional[str] = None
    metric_type: Optional[str] = None  # For wearable metrics
    is_cumulative: bool = True  # True for steps/calories, False for HR/SpO2


class ImportOptions(BaseModel):
    """Configuration options for an import run"""
    conflict_policy: ConflictPolicy = ConflictPolicy.SKIP_EXISTING
    aggregation: AggregationPeriod = AggregationPeriod.DAILY
    date_range_start: Optional[str] = None  # YYYY-MM-DD
    date_range_end: Optional[str] = None  # YYYY-MM-DD
    
    # CSV-specific
    date_column: Optional[str] = None
    column_mappings: Optional[List[ColumnMapping]] = None
    
    # Wearable-specific
    selected_metrics: Optional[List[str]] = None
    
    # Screenshot-specific
    min_confidence: float = 0.75  # Minimum confidence threshold


# ================================
# IMPORT RUN MODELS
# ================================

class ImportRunCreate(BaseModel):
    """Request to create a new import run"""
    source: ImportSource
    options: Optional[ImportOptions] = None


class ImportRunSummary(BaseModel):
    """Summary statistics for an import run"""
    total_rows: int = 0
    parsed: int = 0
    imported: int = 0
    skipped: int = 0
    updated: int = 0
    duplicates: int = 0
    errors: int = 0
    created_habit_ids: List[str] = []


class ImportRun(BaseModel):
    """Full import run model"""
    id: str
    user_id: str
    source: ImportSource
    file_name: Optional[str] = None
    file_hash_sha256: Optional[str] = None
    file_size: Optional[int] = None
    status: ImportStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    options: Optional[ImportOptions] = None
    summary: Optional[ImportRunSummary] = None
    errors: Optional[List[Dict[str, Any]]] = None
    progress_current: int = 0
    progress_total: int = 0
    undo_available: bool = False
    undone_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ImportRunStatus(BaseModel):
    """Status response for an import run"""
    id: str
    status: ImportStatus
    progress_current: int
    progress_total: int
    summary: Optional[ImportRunSummary] = None
    errors: Optional[List[Dict[str, Any]]] = None


# ================================
# IMPORT ITEM MODELS
# ================================

class ValidationMessage(BaseModel):
    """A single validation message"""
    type: Literal["error", "warning", "info"]
    code: str
    message: str
    field: Optional[str] = None


class ImportItem(BaseModel):
    """A single item to be imported"""
    id: Optional[str] = None
    habit_key: str
    habit_name: Optional[str] = None
    date: str  # YYYY-MM-DD
    amount: Optional[float] = None
    unit_type: Optional[str] = None
    raw_json: Optional[Dict[str, Any]] = None
    row_index: Optional[int] = None
    validation_status: ValidationStatus = ValidationStatus.OK
    validation_messages: List[ValidationMessage] = []
    dedupe_key: Optional[str] = None
    conflict_status: Optional[str] = None  # null, duplicate, conflict
    existing_log_id: Optional[str] = None

    class Config:
        from_attributes = True


# ================================
# PREVIEW MODELS
# ================================

class DedupeEstimate(BaseModel):
    """Deduplication estimate for preview"""
    total_items: int
    new_items: int
    duplicates: int
    conflicts: int  # Items that would update existing logs


class ImportPreviewRequest(BaseModel):
    """Request for import preview"""
    import_run_id: str
    sample_size: int = 50


class ImportPreviewResponse(BaseModel):
    """Response for import preview"""
    import_run_id: str
    source: ImportSource
    summary: ImportRunSummary
    sample_items: List[ImportItem]
    validation_issues: List[ImportItem]  # Items with warnings/errors
    dedupe_estimate: DedupeEstimate
    detected_columns: Optional[List[str]] = None  # For CSV
    detected_metrics: Optional[List[Dict[str, Any]]] = None  # For wearables


# ================================
# BATCH IMPORT MODELS
# ================================

class BatchLogCreate(BaseModel):
    """Single log entry for batch creation"""
    habit_id: str
    date: str  # YYYY-MM-DD
    amount: Optional[float] = None
    duration: Optional[int] = None
    unit_type: Optional[str] = None
    source: Optional[str] = None
    source_id: Optional[str] = None
    notes: Optional[str] = None
    dedupe_key: Optional[str] = None


class BatchLogsRequest(BaseModel):
    """Request to create logs in batch"""
    import_run_id: Optional[str] = None
    conflict_policy: ConflictPolicy = ConflictPolicy.SKIP_EXISTING
    logs: List[BatchLogCreate]


class BatchLogResult(BaseModel):
    """Result for a single log in batch operation"""
    index: int
    status: Literal["inserted", "updated", "skipped", "error"]
    log_id: Optional[str] = None
    error: Optional[str] = None


class BatchLogsResponse(BaseModel):
    """Response from batch log creation"""
    import_run_id: Optional[str] = None
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    results: List[BatchLogResult] = []


# ================================
# CHUNK INGEST MODELS
# ================================

class ChunkIngestRequest(BaseModel):
    """Request to ingest a chunk of items"""
    cursor: int = 0  # Starting position
    chunk_size: int = 500  # Items per chunk


class ChunkIngestResponse(BaseModel):
    """Response from chunk ingestion"""
    import_run_id: str
    processed: int
    next_cursor: Optional[int] = None  # None if complete
    is_complete: bool
    summary: ImportRunSummary


# ================================
# MAPPING PRESET MODELS
# ================================

class MappingPresetCreate(BaseModel):
    """Request to create a mapping preset"""
    name: str
    source: ImportSource
    mapping: ImportOptions


class MappingPreset(BaseModel):
    """Full mapping preset model"""
    id: str
    user_id: str
    name: str
    source: ImportSource
    mapping: ImportOptions
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ================================
# UNDO MODELS
# ================================

class UndoImportResponse(BaseModel):
    """Response from undo operation"""
    import_run_id: str
    logs_deleted: int
    habits_deleted: int
    status: ImportStatus

