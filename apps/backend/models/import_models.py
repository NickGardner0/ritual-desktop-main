"""
Pydantic models for the robust import system.
Handles import runs, items, previews, and batch operations.

V2 Enhancements:
- Validation rules (dates, negatives, outliers, unit mismatch)
- Confidence tracking with reasons
- Improved undo with rollback package
- Mapping templates
- Semantic duplicate detection
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any, Union
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
    SEMANTIC_DEDUPE = "semantic_dedupe"  # V2: Skip if values are "close enough"


class AggregationPeriod(str, Enum):
    RAW = "raw"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class ValidationStatus(str, Enum):
    OK = "ok"
    WARNING = "warning"
    ERROR = "error"


class ValidationCode(str, Enum):
    """V2: Standardized validation codes for actionable feedback"""
    # Date validations
    INVALID_DATE = "invalid_date"
    FUTURE_DATE = "future_date"
    DATE_OUT_OF_RANGE = "date_out_of_range"
    
    # Value validations
    NEGATIVE_VALUE = "negative_value"
    OUTLIER_HIGH = "outlier_high"
    OUTLIER_LOW = "outlier_low"
    VALUE_MISSING = "value_missing"
    
    # Unit validations
    UNIT_MISMATCH = "unit_mismatch"
    UNIT_MISSING = "unit_missing"
    
    # Mapping validations
    HABIT_NOT_FOUND = "habit_not_found"
    COLUMN_NOT_FOUND = "column_not_found"
    
    # Confidence
    LOW_CONFIDENCE = "low_confidence"
    AI_INFERENCE = "ai_inference"


class MatchReason(str, Enum):
    """V2: Reasons for how a habit was matched"""
    EXACT_NAME = "exact_name"
    EXACT_METRIC_TYPE = "exact_metric_type"
    FUZZY_NAME = "fuzzy_name"
    SYNONYM_MATCH = "synonym_match"
    UNIT_INFERRED = "unit_inferred"
    AI_DETECTED = "ai_detected"
    USER_MAPPED = "user_mapped"
    NEW_HABIT = "new_habit"


# ================================
# VALIDATION RULES (V2)
# ================================

class ValidationRules(BaseModel):
    """V2: Configurable validation rules for imports"""
    # Date validations
    allow_future_dates: bool = False
    max_days_in_future: int = 1  # Allow today + 1 day for timezone issues
    min_date: Optional[str] = None  # YYYY-MM-DD, reject dates before this
    max_date: Optional[str] = None  # YYYY-MM-DD, reject dates after this
    
    # Value validations
    allow_negative_values: bool = False
    allow_zero_values: bool = True
    
    # Outlier detection (values outside these bounds trigger warnings)
    outlier_thresholds: Dict[str, Dict[str, float]] = Field(default_factory=lambda: {
        "steps": {"min": 0, "max": 100000},
        "hours": {"min": 0, "max": 24},
        "minutes": {"min": 0, "max": 1440},
        "calories": {"min": 0, "max": 10000},
        "count": {"min": 0, "max": 1000},
        "bpm": {"min": 20, "max": 250},  # Heart rate
        "ms": {"min": 0, "max": 500},  # HRV
        "percent": {"min": 0, "max": 100},
    })
    
    # Auto-fix options
    auto_fix_negative: bool = False  # Convert to absolute value
    auto_fix_outliers: bool = False  # Clamp to bounds
    auto_convert_units: bool = True  # Try to convert mismatched units


class SemanticDedupeOptions(BaseModel):
    """V2: Options for semantic duplicate detection"""
    enabled: bool = False
    # Percentage tolerance for "close enough" (e.g., 0.01 = 1%)
    percent_tolerance: float = 0.01
    # Absolute tolerance (use whichever is larger)
    absolute_tolerance: float = 1.0
    # For time-based metrics, tolerance in minutes
    time_tolerance_minutes: int = 1


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
    
    # V2: Transform options
    transform: Optional[str] = None  # "divide_60", "multiply_60", "parse_hhmm", "parse_duration"
    default_value: Optional[float] = None  # Use if value is missing/invalid


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
    
    # V2: Validation rules
    validation_rules: Optional[ValidationRules] = None
    
    # V2: Semantic deduplication
    semantic_dedupe: Optional[SemanticDedupeOptions] = None
    
    # V2: Privacy options
    delete_file_after_parse: bool = False  # Don't persist raw file
    
    # V2: Template reference
    template_id: Optional[str] = None  # Reference to saved mapping template


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
    suggested_fix: Optional[str] = None  # V2: How to fix the issue
    auto_fixable: bool = False  # V2: Can be auto-fixed


class ConfidenceInfo(BaseModel):
    """V2: Confidence and explanation for a parsed item"""
    score: float = 1.0  # 0.0 to 1.0
    reasons: List[str] = []  # Human-readable explanations
    match_type: Optional[MatchReason] = None  # How the habit was matched
    inferred_fields: List[str] = []  # Which fields were inferred (not from raw data)


class ConflictDetail(BaseModel):
    """V2: Details about a conflict with existing data"""
    existing_log_id: str
    existing_value: Optional[float] = None
    existing_date: str
    incoming_value: Optional[float] = None
    resolution: str  # What will happen based on policy
    diff_percent: Optional[float] = None  # How different the values are


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
    conflict_status: Optional[str] = None  # null, duplicate, conflict, semantic_duplicate
    existing_log_id: Optional[str] = None
    
    # V2: Confidence tracking
    confidence: Optional[ConfidenceInfo] = None
    
    # V2: Conflict details for diff view
    conflict_detail: Optional[ConflictDetail] = None
    
    # V2: Original value before any transforms
    original_amount: Optional[float] = None
    transform_applied: Optional[str] = None

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
    was_inserted: Optional[bool] = None


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
# MAPPING PRESET MODELS (V2 Enhanced)
# ================================

class MappingPresetCreate(BaseModel):
    """Request to create a mapping preset"""
    name: str
    description: Optional[str] = None  # V2: Description of what this template is for
    source: ImportSource
    mapping: ImportOptions
    # V2: Example sources this template works with
    example_sources: List[str] = []  # e.g., ["iPhone Screen Time", "Apple Health Export"]
    # V2: Tags for filtering
    tags: List[str] = []  # e.g., ["health", "fitness", "apple"]


class MappingPreset(BaseModel):
    """Full mapping preset model"""
    id: str
    user_id: str
    name: str
    description: Optional[str] = None
    source: ImportSource
    mapping: ImportOptions
    example_sources: List[str] = []
    tags: List[str] = []
    use_count: int = 0  # V2: Track how often this template is used
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ================================
# UNDO MODELS (V2 Enhanced)
# ================================

class UndoLogEntry(BaseModel):
    """V2: Details of a log that can be undone"""
    log_id: str
    habit_id: str
    habit_name: str
    date: str
    amount: Optional[float] = None
    action: Literal["created", "updated"]
    # For updated logs, store the previous value for full rollback
    previous_amount: Optional[float] = None
    previous_notes: Optional[str] = None


class UndoPackage(BaseModel):
    """V2: Full rollback package for an import run"""
    import_run_id: str
    created_at: datetime
    expires_at: datetime  # V2: Undo expiration (e.g., 7 days)
    logs_created: List[str] = []  # Log IDs that were created
    logs_updated: List[UndoLogEntry] = []  # Logs that were updated (with previous values)
    habits_created: List[str] = []  # Habit IDs that were created
    total_affected: int = 0


class UndoImportRequest(BaseModel):
    """V2: Request to undo an import"""
    import_run_id: str
    # V2: Partial undo options
    partial: bool = False  # If true, only undo selected items
    log_ids_to_undo: Optional[List[str]] = None  # Specific logs to undo


class UndoImportResponse(BaseModel):
    """Response from undo operation"""
    import_run_id: str
    logs_deleted: int
    logs_restored: int = 0  # V2: Logs restored to previous values
    habits_deleted: int
    status: ImportStatus
    # V2: Export link for debugging
    undo_log_export_url: Optional[str] = None


# ================================
# PREVIEW ENHANCEMENTS (V2)
# ================================

class ValidationSummary(BaseModel):
    """V2: Summary of validation issues"""
    total_errors: int = 0
    total_warnings: int = 0
    errors_by_code: Dict[str, int] = {}  # Code -> count
    warnings_by_code: Dict[str, int] = {}
    auto_fixable_count: int = 0  # How many issues can be auto-fixed


class ImportPreviewSummary(BaseModel):
    """V2: Enhanced preview summary with explanations"""
    total_rows: int = 0
    parsed: int = 0
    will_create: int = 0  # New logs
    will_update: int = 0  # Existing logs to update
    will_skip: int = 0  # Duplicates to skip
    has_warnings: int = 0  # Items with warnings
    has_errors: int = 0  # Items with errors (won't import)
    
    # V2: Confidence summary
    high_confidence: int = 0  # >= 0.9
    medium_confidence: int = 0  # 0.7-0.9
    low_confidence: int = 0  # < 0.7
    
    # V2: What habits will be affected
    habits_affected: List[str] = []  # Names of habits
    new_habits_to_create: List[str] = []  # New habits that will be created


# ================================
# IMPORT HISTORY FILTERS (V2)
# ================================

class ImportHistoryFilters(BaseModel):
    """V2: Filters for import history"""
    source: Optional[ImportSource] = None
    status: Optional[ImportStatus] = None
    date_from: Optional[str] = None  # YYYY-MM-DD
    date_to: Optional[str] = None
    has_errors: Optional[bool] = None
    search: Optional[str] = None  # Search in file_name

