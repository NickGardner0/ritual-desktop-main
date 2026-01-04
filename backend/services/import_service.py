"""
Import Service - Robust data import system with:
- Duplicate detection + idempotency
- Batch ingestion (OPTIMIZED: bulk queries + bulk inserts)
- Progress tracking
- Validation + preview
- Conflict resolution
- Undo/rollback support

Performance optimizations:
- Bulk duplicate checking (2 queries instead of N+1)
- Bulk insert for staging items
- Habit caching per import run
- File hash-based resume for idempotent imports
"""

import uuid
import hashlib
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple, Set
from sqlalchemy import select, and_, or_, func, insert
from sqlalchemy.exc import SQLAlchemyError

from database.connection import get_db_session
from database.models import (
    ImportRunDB, ImportItemDB, ImportMappingPresetDB,
    HabitDB, HabitLogDB
)
from models.import_models import (
    ImportSource, ImportStatus, ConflictPolicy, AggregationPeriod,
    ValidationStatus, ImportOptions, ImportRunCreate, ImportRunSummary,
    ImportRun, ImportItem, ImportPreviewResponse, DedupeEstimate,
    BatchLogCreate, BatchLogsRequest, BatchLogsResponse, BatchLogResult,
    ChunkIngestResponse, UndoImportResponse, ValidationMessage
)


def generate_dedupe_key(
    user_id: str,
    habit_id: str,
    date: str,
    amount: Optional[float],
    unit_type: Optional[str],
    source: str,
    source_id: Optional[str] = None
) -> str:
    """
    Generate a stable deduplication key for a habit log.
    This allows detecting true duplicates across import runs.
    """
    # Normalize amount to avoid floating point issues
    amount_str = f"{amount:.6f}" if amount is not None else "null"
    unit_str = unit_type or "none"
    source_id_str = source_id or ""
    
    key_parts = f"{user_id}:{habit_id}:{date}:{amount_str}:{unit_str}:{source}:{source_id_str}"
    return hashlib.sha256(key_parts.encode()).hexdigest()[:32]


def parse_date_flexible(date_str: str) -> Optional[str]:
    """
    Parse dates from various formats and return YYYY-MM-DD.
    Supports: ISO, US formats, human readable, timestamps.
    """
    if not date_str:
        return None
    
    date_str = str(date_str).strip()
    
    # Try common formats
    formats = [
        "%Y-%m-%d",           # ISO: 2024-01-15
        "%Y/%m/%d",           # 2024/01/15
        "%m/%d/%Y",           # US: 01/15/2024
        "%m-%d-%Y",           # US: 01-15-2024
        "%d/%m/%Y",           # EU: 15/01/2024
        "%d-%m-%Y",           # EU: 15-01-2024
        "%B %d, %Y",          # January 15, 2024
        "%b %d, %Y",          # Jan 15, 2024
        "%d %B %Y",           # 15 January 2024
        "%d %b %Y",           # 15 Jan 2024
        "%Y-%m-%dT%H:%M:%S",  # ISO with time
        "%Y-%m-%dT%H:%M:%SZ", # ISO with Z
        "%Y-%m-%d %H:%M:%S",  # ISO with space
    ]
    
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    
    # Try ISO timestamp with timezone
    try:
        if "T" in date_str:
            # Remove timezone suffix and parse
            base = date_str.split("+")[0].split("Z")[0]
            if "." in base:
                base = base.split(".")[0]
            dt = datetime.fromisoformat(base)
            return dt.strftime("%Y-%m-%d")
    except (ValueError, IndexError):
        pass
    
    return None


def get_aggregation_bucket(date_str: str, aggregation: AggregationPeriod) -> str:
    """
    Get the bucket date for a given date and aggregation period.
    """
    if aggregation == AggregationPeriod.RAW or aggregation == AggregationPeriod.DAILY:
        return date_str
    
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        
        if aggregation == AggregationPeriod.WEEKLY:
            # Start of week (Monday)
            start = dt - timedelta(days=dt.weekday())
            return start.strftime("%Y-%m-%d")
        
        elif aggregation == AggregationPeriod.MONTHLY:
            # First of month
            return dt.strftime("%Y-%m-01")
    except ValueError:
        pass
    
    return date_str


class ImportService:
    """Service for robust data import operations"""
    
    def __init__(self):
        """Initialize import service"""
        # In-memory cache for habits during an import session
        self._habit_cache: Dict[str, Dict[str, Any]] = {}
        self._habit_cache_user: Optional[str] = None
        self._habit_cache_time: Optional[datetime] = None
        self._habit_cache_ttl = 120  # seconds
    
    # ================================
    # HABIT CACHING (Performance optimization)
    # ================================
    
    async def get_cached_habits(self, user_id: str, force_refresh: bool = False) -> List[HabitDB]:
        """
        Get habits with caching. Cache is per-user and expires after TTL.
        """
        now = datetime.utcnow()
        
        # Check if cache is valid
        cache_valid = (
            not force_refresh and
            self._habit_cache_user == user_id and
            self._habit_cache_time and
            (now - self._habit_cache_time).total_seconds() < self._habit_cache_ttl
        )
        
        if cache_valid and self._habit_cache:
            return list(self._habit_cache.values())
        
        # Refresh cache
        async with get_db_session() as session:
            result = await session.execute(
                select(HabitDB).where(HabitDB.user_id == user_id)
            )
            habits = result.scalars().all()
            
            self._habit_cache = {h.id: h for h in habits}
            self._habit_cache_user = user_id
            self._habit_cache_time = now
            
            return habits
    
    def invalidate_habit_cache(self):
        """Invalidate habit cache (call after creating new habits)"""
        self._habit_cache = {}
        self._habit_cache_user = None
        self._habit_cache_time = None
    
    # ================================
    # IMPORT RUN LIFECYCLE
    # ================================
    
    async def create_import_run(
        self,
        user_id: str,
        source: ImportSource,
        file_name: Optional[str] = None,
        file_content: Optional[bytes] = None,
        options: Optional[ImportOptions] = None
    ) -> ImportRun:
        """
        Create a new import run.
        """
        async with get_db_session() as session:
            try:
                # Calculate file hash if content provided
                file_hash = None
                file_size = None
                if file_content:
                    file_hash = hashlib.sha256(file_content).hexdigest()
                    file_size = len(file_content)
                
                run_id = str(uuid.uuid4())
                
                run_db = ImportRunDB(
                    id=run_id,
                    user_id=user_id,
                    source=source.value,
                    file_name=file_name,
                    file_hash_sha256=file_hash,
                    file_size=file_size,
                    status=ImportStatus.CREATED.value,
                    options_json=json.dumps(options.model_dump()) if options else None,
                    summary_json=json.dumps(ImportRunSummary().model_dump()),
                    created_at=datetime.utcnow()
                )
                
                session.add(run_db)
                await session.commit()
                await session.refresh(run_db)
                
                return self._db_to_model(run_db)
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to create import run: {str(e)}")
    
    async def find_existing_run_by_hash(
        self,
        user_id: str,
        file_hash: str,
        source: ImportSource
    ) -> Optional[ImportRun]:
        """
        Find an existing import run with the same file hash (for idempotent imports).
        Returns the run if it exists and is in a resumable state.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ImportRunDB).where(
                    and_(
                        ImportRunDB.user_id == user_id,
                        ImportRunDB.file_hash_sha256 == file_hash,
                        ImportRunDB.source == source.value,
                        ImportRunDB.status.in_([
                            ImportStatus.CREATED.value,
                            ImportStatus.READY.value
                        ])
                    )
                ).order_by(ImportRunDB.created_at.desc()).limit(1)
            )
            run_db = result.scalar_one_or_none()
            
            if run_db:
                return self._db_to_model(run_db)
            return None
    
    async def get_import_run(self, run_id: str, user_id: str) -> Optional[ImportRun]:
        """
        Get an import run by ID.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ImportRunDB).where(
                    and_(
                        ImportRunDB.id == run_id,
                        ImportRunDB.user_id == user_id
                    )
                )
            )
            run_db = result.scalar_one_or_none()
            
            if not run_db:
                return None
            
            return self._db_to_model(run_db)
    
    async def update_import_run_status(
        self,
        run_id: str,
        status: ImportStatus,
        summary: Optional[ImportRunSummary] = None,
        errors: Optional[List[Dict[str, Any]]] = None
    ) -> None:
        """
        Update import run status and optionally summary/errors.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ImportRunDB).where(ImportRunDB.id == run_id)
            )
            run_db = result.scalar_one_or_none()
            
            if not run_db:
                raise Exception("Import run not found")
            
            run_db.status = status.value
            
            if status == ImportStatus.IMPORTING and not run_db.started_at:
                run_db.started_at = datetime.utcnow()
            
            if status in [ImportStatus.COMPLETED, ImportStatus.FAILED, ImportStatus.CANCELED]:
                run_db.completed_at = datetime.utcnow()
                run_db.undo_available = status == ImportStatus.COMPLETED
            
            if summary:
                run_db.summary_json = json.dumps(summary.model_dump())
            
            if errors:
                run_db.error_json = json.dumps(errors)
            
            await session.commit()
    
    async def update_import_progress(
        self,
        run_id: str,
        current: int,
        total: int
    ) -> None:
        """
        Update import progress counters.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ImportRunDB).where(ImportRunDB.id == run_id)
            )
            run_db = result.scalar_one_or_none()
            
            if run_db:
                run_db.progress_current = current
                run_db.progress_total = total
                await session.commit()
    
    # ================================
    # IMPORT ITEMS (STAGING) - BULK OPTIMIZED
    # ================================
    
    async def add_import_items_bulk(
        self,
        run_id: str,
        items: List[ImportItem]
    ) -> int:
        """
        Add items to the staging table using BULK INSERT.
        Much faster than inserting one-by-one.
        Returns count of items added.
        """
        if not items:
            return 0
        
        async with get_db_session() as session:
            try:
                # Prepare values for bulk insert
                values = []
                for item in items:
                    values.append({
                        "id": str(uuid.uuid4()),
                        "import_run_id": run_id,
                        "habit_key": item.habit_key,
                        "habit_name": item.habit_name,
                        "date": item.date,
                        "amount": item.amount,
                        "unit_type": item.unit_type,
                        "raw_json": json.dumps(item.raw_json) if item.raw_json else None,
                        "row_index": item.row_index,
                        "validation_status": item.validation_status.value if hasattr(item.validation_status, 'value') else item.validation_status,
                        "validation_messages": json.dumps([m.model_dump() for m in item.validation_messages]) if item.validation_messages else None,
                        "dedupe_key": item.dedupe_key,
                        "conflict_status": item.conflict_status,
                        "existing_log_id": item.existing_log_id
                    })
                
                # Bulk insert using SQLAlchemy Core
                if values:
                    await session.execute(insert(ImportItemDB), values)
                    await session.commit()
                
                return len(values)
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to add import items: {str(e)}")
    
    # Legacy method for backward compatibility
    async def add_import_items(
        self,
        run_id: str,
        items: List[ImportItem]
    ) -> int:
        """
        Add items to the staging table for preview.
        Now uses bulk insert internally.
        """
        return await self.add_import_items_bulk(run_id, items)
    
    async def get_import_items(
        self,
        run_id: str,
        limit: int = 50,
        offset: int = 0,
        validation_status: Optional[ValidationStatus] = None
    ) -> List[ImportItem]:
        """
        Get import items for preview.
        """
        async with get_db_session() as session:
            query = select(ImportItemDB).where(ImportItemDB.import_run_id == run_id)
            
            if validation_status:
                query = query.where(ImportItemDB.validation_status == validation_status.value)
            
            query = query.offset(offset).limit(limit)
            
            result = await session.execute(query)
            items_db = result.scalars().all()
            
            return [self._item_db_to_model(item) for item in items_db]
    
    async def count_import_items(
        self,
        run_id: str,
        validation_status: Optional[ValidationStatus] = None
    ) -> int:
        """
        Count import items.
        """
        async with get_db_session() as session:
            query = select(func.count(ImportItemDB.id)).where(
                ImportItemDB.import_run_id == run_id
            )
            
            if validation_status:
                query = query.where(ImportItemDB.validation_status == validation_status.value)
            
            result = await session.execute(query)
            return result.scalar() or 0
    
    async def clear_import_items(self, run_id: str) -> None:
        """
        Clear all staging items for an import run.
        """
        async with get_db_session() as session:
            await session.execute(
                ImportItemDB.__table__.delete().where(
                    ImportItemDB.import_run_id == run_id
                )
            )
            await session.commit()
    
    # ================================
    # DEDUPLICATION & CONFLICT DETECTION - BULK OPTIMIZED
    # ================================
    
    async def check_duplicates_bulk(
        self,
        user_id: str,
        items: List[ImportItem],
        habits: Optional[List[HabitDB]] = None
    ) -> DedupeEstimate:
        """
        OPTIMIZED: Check duplicates using only 2 bulk queries instead of N+1.
        
        Query 1: Fetch all existing logs by dedupe_key IN (...)
        Query 2: Fetch all existing logs by (habit_id, date) pairs
        
        Then annotate items in-memory.
        """
        if not items:
            return DedupeEstimate(total_items=0, new_items=0, duplicates=0, conflicts=0)
        
        async with get_db_session() as session:
            total = len(items)
            duplicates = 0
            conflicts = 0
            
            # Get habits if not provided (use cache)
            if habits is None:
                habits = await self.get_cached_habits(user_id)
            
            # Build habit lookup maps
            habits_by_metric = {h.metric_type: h.id for h in habits if h.metric_type}
            habits_by_name = {h.name.lower(): h.id for h in habits}
            
            # Resolve habit_ids for all items
            for item in items:
                metric_key = item.habit_key.split(":")[-1] if ":" in item.habit_key else item.habit_key
                item._resolved_habit_id = (
                    habits_by_metric.get(metric_key) or 
                    habits_by_name.get(metric_key.lower()) or
                    habits_by_name.get(item.habit_name.lower() if item.habit_name else "")
                )
            
            # Collect dedupe keys for bulk query
            dedupe_keys = [i.dedupe_key for i in items if i.dedupe_key]
            
            # Collect (habit_id, date) pairs for bulk query
            pairs: Set[Tuple[str, str]] = set()
            for item in items:
                if item._resolved_habit_id and item.date:
                    pairs.add((item._resolved_habit_id, item.date))
            
            # Query 1: Bulk fetch by dedupe_key
            existing_by_key: Dict[str, str] = {}
            if dedupe_keys:
                # SQLite IN clause limit is ~1000, chunk if needed
                for i in range(0, len(dedupe_keys), 900):
                    chunk = dedupe_keys[i:i+900]
                    result = await session.execute(
                        select(HabitLogDB.dedupe_key, HabitLogDB.id)
                        .where(HabitLogDB.dedupe_key.in_(chunk))
                    )
                    for row in result:
                        existing_by_key[row[0]] = row[1]
            
            # Query 2: Bulk fetch by (habit_id, date) - V2: Include amount for diff view
            # SQLite doesn't support tuple IN, so we use OR conditions
            existing_by_pair: Dict[Tuple[str, str], Dict[str, Any]] = {}
            if pairs:
                pairs_list = list(pairs)
                # Chunk to avoid query size limits
                for i in range(0, len(pairs_list), 100):
                    chunk = pairs_list[i:i+100]
                    conditions = [
                        and_(HabitLogDB.habit_id == h, HabitLogDB.date == d)
                        for h, d in chunk
                    ]
                    result = await session.execute(
                        select(HabitLogDB.habit_id, HabitLogDB.date, HabitLogDB.id, HabitLogDB.amount)
                        .where(or_(*conditions))
                    )
                    for row in result:
                        existing_by_pair[(row[0], row[1])] = {
                            "id": row[2],
                            "amount": row[3]
                        }
            
            # Annotate items in-memory
            for item in items:
                habit_id = getattr(item, '_resolved_habit_id', None)
                
                # Check for exact duplicate (same dedupe_key)
                if item.dedupe_key and item.dedupe_key in existing_by_key:
                    item.conflict_status = "duplicate"
                    item.existing_log_id = existing_by_key[item.dedupe_key]
                    duplicates += 1
                    continue
                
                # Check for same habit+date conflict
                if habit_id and item.date:
                    pair_key = (habit_id, item.date)
                    if pair_key in existing_by_pair:
                        existing_data = existing_by_pair[pair_key]
                        item.conflict_status = "conflict"
                        item.existing_log_id = existing_data["id"]
                        
                        # V2: Add conflict details for diff view
                        from models.import_models import ConflictDetail
                        from services.import_validator import is_semantic_duplicate
                        
                        existing_value = existing_data.get("amount")
                        diff_percent = None
                        if existing_value and item.amount and existing_value != 0:
                            diff_percent = abs(item.amount - existing_value) / abs(existing_value) * 100
                        
                        # V2: Check for semantic duplicate (values close enough)
                        # Default semantic dedupe: 1% tolerance or ±1 absolute
                        from models.import_models import SemanticDedupeOptions
                        default_semantic_opts = SemanticDedupeOptions(
                            enabled=True,
                            percent_tolerance=0.01,
                            absolute_tolerance=1.0
                        )
                        
                        if is_semantic_duplicate(item.amount, existing_value, default_semantic_opts):
                            item.conflict_status = "semantic_duplicate"
                            duplicates += 1  # Count as duplicate, not conflict
                            item.existing_log_id = existing_data["id"]
                            item.conflict_detail = ConflictDetail(
                                existing_log_id=existing_data["id"],
                                existing_value=existing_value,
                                existing_date=item.date,
                                incoming_value=item.amount,
                                resolution="Values are close enough - treating as duplicate",
                                diff_percent=diff_percent
                            )
                            continue  # Don't count as conflict
                        
                        item.conflict_detail = ConflictDetail(
                            existing_log_id=existing_data["id"],
                            existing_value=existing_value,
                            existing_date=item.date,
                            incoming_value=item.amount,
                            resolution="will depend on conflict policy",
                            diff_percent=diff_percent
                        )
                        conflicts += 1
            
            return DedupeEstimate(
                total_items=total,
                new_items=total - duplicates - conflicts,
                duplicates=duplicates,
                conflicts=conflicts
            )
    
    # Legacy method for backward compatibility
    async def check_duplicates(
        self,
        user_id: str,
        items: List[ImportItem]
    ) -> DedupeEstimate:
        """
        Check how many items would be duplicates or conflicts.
        Now uses bulk optimization internally.
        """
        return await self.check_duplicates_bulk(user_id, items)
    
    # ================================
    # BATCH LOG CREATION - BULK OPTIMIZED
    # ================================
    
    async def create_logs_batch(
        self,
        user_id: str,
        request: BatchLogsRequest
    ) -> BatchLogsResponse:
        """
        Create habit logs in batch with conflict resolution.
        OPTIMIZED: Uses bulk queries for duplicate checking and bulk inserts.
        V2: Tracks undo package for enhanced rollback support.
        """
        async with get_db_session() as session:
            try:
                results: List[BatchLogResult] = []
                inserted = 0
                updated = 0
                skipped = 0
                errors = 0
                
                # V2: Track undo package data
                logs_created: List[str] = []
                logs_updated: List[Dict[str, Any]] = []  # Stores previous values
                
                # Validate all habits belong to user (single query)
                habit_ids = list(set(log.habit_id for log in request.logs))
                habit_query = select(HabitDB).where(
                    and_(
                        HabitDB.id.in_(habit_ids),
                        HabitDB.user_id == user_id
                    )
                )
                result = await session.execute(habit_query)
                valid_habits = {h.id: h for h in result.scalars().all()}
                
                # Collect dedupe keys and (habit_id, date) pairs for bulk checking
                dedupe_keys = []
                pairs = []
                for log_data in request.logs:
                    if log_data.dedupe_key:
                        dedupe_keys.append(log_data.dedupe_key)
                    else:
                        # Generate dedupe key
                        dk = generate_dedupe_key(
                            user_id=user_id,
                            habit_id=log_data.habit_id,
                            date=log_data.date,
                            amount=log_data.amount,
                            unit_type=log_data.unit_type,
                            source=log_data.source or "import",
                            source_id=log_data.source_id
                        )
                        log_data.dedupe_key = dk
                        dedupe_keys.append(dk)
                    
                    if log_data.habit_id and log_data.date:
                        pairs.append((log_data.habit_id, log_data.date))
                
                # Bulk query for existing logs by dedupe_key
                existing_by_key: Dict[str, str] = {}
                if dedupe_keys:
                    for i in range(0, len(dedupe_keys), 900):
                        chunk = dedupe_keys[i:i+900]
                        dk_result = await session.execute(
                            select(HabitLogDB.dedupe_key, HabitLogDB.id)
                            .where(HabitLogDB.dedupe_key.in_(chunk))
                        )
                        for row in dk_result:
                            existing_by_key[row[0]] = row[1]
                
                # Bulk query for existing logs by (habit_id, date)
                existing_by_pair: Dict[Tuple[str, str], HabitLogDB] = {}
                if pairs:
                    unique_pairs = list(set(pairs))
                    for i in range(0, len(unique_pairs), 100):
                        chunk = unique_pairs[i:i+100]
                        conditions = [
                            and_(HabitLogDB.habit_id == h, HabitLogDB.date == d)
                            for h, d in chunk
                        ]
                        pair_result = await session.execute(
                            select(HabitLogDB).where(or_(*conditions))
                        )
                        for log in pair_result.scalars():
                            existing_by_pair[(log.habit_id, log.date)] = log
                
                # Prepare bulk insert list and process each log
                new_logs_to_insert = []
                
                for i, log_data in enumerate(request.logs):
                    try:
                        # Validate habit ownership
                        if log_data.habit_id not in valid_habits:
                            results.append(BatchLogResult(
                                index=i,
                                status="error",
                                error="Habit not found or not authorized"
                            ))
                            errors += 1
                            continue
                        
                        habit = valid_habits[log_data.habit_id]
                        dedupe_key = log_data.dedupe_key
                        
                        # Check for exact duplicate by dedupe_key
                        if dedupe_key in existing_by_key:
                            results.append(BatchLogResult(
                                index=i,
                                status="skipped",
                                error="Exact duplicate"
                            ))
                            skipped += 1
                            continue
                        
                        # Check for existing log with same habit+date
                        pair_key = (log_data.habit_id, log_data.date)
                        existing_log = existing_by_pair.get(pair_key)
                        
                        if existing_log:
                            # Apply conflict policy
                            if request.conflict_policy == ConflictPolicy.SKIP_EXISTING:
                                results.append(BatchLogResult(
                                    index=i,
                                    status="skipped",
                                    log_id=existing_log.id
                                ))
                                skipped += 1
                                continue
                            
                            elif request.conflict_policy == ConflictPolicy.OVERWRITE_EXISTING:
                                # V2: Store previous values for rollback
                                logs_updated.append({
                                    "log_id": existing_log.id,
                                    "habit_id": existing_log.habit_id,
                                    "date": existing_log.date,
                                    "previous_amount": existing_log.amount,
                                    "previous_duration": existing_log.duration,
                                    "previous_notes": existing_log.notes,
                                    "previous_source": existing_log.source,
                                })
                                
                                existing_log.amount = log_data.amount
                                existing_log.duration = log_data.duration
                                existing_log.source = log_data.source
                                existing_log.source_id = log_data.source_id
                                existing_log.notes = log_data.notes
                                existing_log.dedupe_key = dedupe_key
                                existing_log.import_run_id = request.import_run_id
                                
                                results.append(BatchLogResult(
                                    index=i,
                                    status="updated",
                                    log_id=existing_log.id
                                ))
                                updated += 1
                                continue
                            
                            elif request.conflict_policy == ConflictPolicy.MERGE_SUM:
                                existing_log.amount = (existing_log.amount or 0) + (log_data.amount or 0)
                                existing_log.import_run_id = request.import_run_id
                                
                                results.append(BatchLogResult(
                                    index=i,
                                    status="updated",
                                    log_id=existing_log.id
                                ))
                                updated += 1
                                continue
                            
                            elif request.conflict_policy == ConflictPolicy.MERGE_AVG:
                                existing_log.amount = log_data.amount
                                existing_log.import_run_id = request.import_run_id
                                
                                results.append(BatchLogResult(
                                    index=i,
                                    status="updated",
                                    log_id=existing_log.id
                                ))
                                updated += 1
                                continue
                        
                        # Prepare for bulk insert
                        log_id = str(uuid.uuid4())
                        new_logs_to_insert.append({
                            "id": log_id,
                            "habit_id": log_data.habit_id,
                            "habit_name": habit.name,
                            "amount": log_data.amount,
                            "duration": log_data.duration,
                            "date": log_data.date,
                            "completed_at": datetime.utcnow().isoformat(),
                            "status": "completed",
                            "notes": log_data.notes,
                            "source": log_data.source or "import",
                            "source_id": log_data.source_id,
                            "dedupe_key": dedupe_key,
                            "import_run_id": request.import_run_id
                        })
                        
                        # V2: Track created log for undo
                        logs_created.append(log_id)
                        
                        results.append(BatchLogResult(
                            index=i,
                            status="inserted",
                            log_id=log_id
                        ))
                        inserted += 1
                        
                        # Track in existing_by_key to prevent duplicates within same batch
                        existing_by_key[dedupe_key] = log_id
                        
                    except Exception as e:
                        results.append(BatchLogResult(
                            index=i,
                            status="error",
                            error=str(e)
                        ))
                        errors += 1
                
                # Bulk insert all new logs
                if new_logs_to_insert:
                    await session.execute(insert(HabitLogDB), new_logs_to_insert)
                
                # V2: Update import run with undo package
                if request.import_run_id and (logs_created or logs_updated):
                    undo_package = {
                        "logs_created": logs_created,
                        "logs_updated": logs_updated,
                        "total_affected": len(logs_created) + len(logs_updated),
                        "created_at": datetime.utcnow().isoformat()
                    }
                    
                    # Get existing undo package and merge
                    run_result = await session.execute(
                        select(ImportRunDB).where(ImportRunDB.id == request.import_run_id)
                    )
                    run_db = run_result.scalar_one_or_none()
                    if run_db:
                        # Merge with existing undo package if any
                        existing_package = json.loads(run_db.undo_package_json) if run_db.undo_package_json else {"logs_created": [], "logs_updated": []}
                        existing_package["logs_created"].extend(logs_created)
                        existing_package["logs_updated"].extend(logs_updated)
                        existing_package["total_affected"] = len(existing_package["logs_created"]) + len(existing_package["logs_updated"])
                        
                        run_db.undo_package_json = json.dumps(existing_package)
                        run_db.undo_available = True
                        # V2: Set expiration to 7 days from now
                        run_db.undo_expires_at = datetime.utcnow() + timedelta(days=7)
                
                await session.commit()
                
                return BatchLogsResponse(
                    import_run_id=request.import_run_id,
                    inserted=inserted,
                    updated=updated,
                    skipped=skipped,
                    errors=errors,
                    results=results
                )
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Batch log creation failed: {str(e)}")
    
    # ================================
    # UNDO IMPORT
    # ================================
    
    async def undo_import_run(
        self,
        run_id: str,
        user_id: str
    ) -> UndoImportResponse:
        """
        V2: Enhanced undo with rollback package support.
        - Deletes logs that were created
        - Restores previous values for logs that were updated
        - Respects undo expiration (7 days)
        """
        async with get_db_session() as session:
            try:
                # Verify import run exists and belongs to user
                run_result = await session.execute(
                    select(ImportRunDB).where(
                        and_(
                            ImportRunDB.id == run_id,
                            ImportRunDB.user_id == user_id
                        )
                    )
                )
                run_db = run_result.scalar_one_or_none()
                
                if not run_db:
                    raise Exception("Import run not found")
                
                if not run_db.undo_available:
                    raise Exception("This import cannot be undone")
                
                # V2: Check undo expiration
                if run_db.undo_expires_at and datetime.utcnow() > run_db.undo_expires_at:
                    raise Exception(f"Undo expired on {run_db.undo_expires_at.strftime('%Y-%m-%d')}")
                
                # Get summary to find created habits
                summary = json.loads(run_db.summary_json) if run_db.summary_json else {}
                created_habit_ids = summary.get("created_habit_ids", [])
                
                # V2: Get undo package for enhanced rollback
                undo_package = json.loads(run_db.undo_package_json) if run_db.undo_package_json else None
                logs_restored = 0
                
                if undo_package:
                    # V2: Restore updated logs to their previous values
                    logs_to_restore = undo_package.get("logs_updated", [])
                    for log_entry in logs_to_restore:
                        log_id = log_entry.get("log_id")
                        if log_id:
                            log_result = await session.execute(
                                select(HabitLogDB).where(HabitLogDB.id == log_id)
                            )
                            log_db = log_result.scalar_one_or_none()
                            if log_db:
                                # Restore previous values
                                if "previous_amount" in log_entry:
                                    log_db.amount = log_entry["previous_amount"]
                                if "previous_duration" in log_entry:
                                    log_db.duration = log_entry["previous_duration"]
                                if "previous_notes" in log_entry:
                                    log_db.notes = log_entry["previous_notes"]
                                if "previous_source" in log_entry:
                                    log_db.source = log_entry["previous_source"]
                                # Clear import run reference since we restored original
                                log_db.import_run_id = None
                                logs_restored += 1
                
                # Delete all logs that were CREATED (not updated) by this import run
                logs_result = await session.execute(
                    select(func.count(HabitLogDB.id)).where(
                        HabitLogDB.import_run_id == run_id
                    )
                )
                logs_to_delete = logs_result.scalar() or 0
                
                await session.execute(
                    HabitLogDB.__table__.delete().where(
                        HabitLogDB.import_run_id == run_id
                    )
                )
                
                # Check which created habits now have no logs
                habits_deleted = 0
                for habit_id in created_habit_ids:
                    log_count_result = await session.execute(
                        select(func.count(HabitLogDB.id)).where(
                            HabitLogDB.habit_id == habit_id
                        )
                    )
                    log_count = log_count_result.scalar() or 0
                    
                    if log_count == 0:
                        await session.execute(
                            HabitDB.__table__.delete().where(
                                HabitDB.id == habit_id
                            )
                        )
                        habits_deleted += 1
                
                # Update import run status
                run_db.status = ImportStatus.UNDONE.value
                run_db.undone_at = datetime.utcnow()
                run_db.undo_available = False
                
                await session.commit()
                
                # Invalidate habit cache
                self.invalidate_habit_cache()
                
                return UndoImportResponse(
                    import_run_id=run_id,
                    logs_deleted=logs_to_delete,
                    logs_restored=logs_restored,  # V2: Track restored logs
                    habits_deleted=habits_deleted,
                    status=ImportStatus.UNDONE
                )
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to undo import: {str(e)}")
    
    # ================================
    # IMPORT HISTORY
    # ================================
    
    async def get_import_history(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0
    ) -> List[ImportRun]:
        """
        Get import history for a user.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(ImportRunDB)
                .where(ImportRunDB.user_id == user_id)
                .order_by(ImportRunDB.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
            runs = result.scalars().all()
            return [self._db_to_model(run) for run in runs]
    
    # ================================
    # HELPERS
    # ================================
    
    def _db_to_model(self, db: ImportRunDB) -> ImportRun:
        """Convert DB model to Pydantic model"""
        options = None
        if db.options_json:
            try:
                options = ImportOptions(**json.loads(db.options_json))
            except:
                pass
        
        summary = None
        if db.summary_json:
            try:
                summary = ImportRunSummary(**json.loads(db.summary_json))
            except:
                pass
        
        errors = None
        if db.error_json:
            try:
                errors = json.loads(db.error_json)
            except:
                pass
        
        return ImportRun(
            id=db.id,
            user_id=db.user_id,
            source=ImportSource(db.source),
            file_name=db.file_name,
            file_hash_sha256=db.file_hash_sha256,
            file_size=db.file_size,
            status=ImportStatus(db.status),
            created_at=db.created_at,
            started_at=db.started_at,
            completed_at=db.completed_at,
            options=options,
            summary=summary,
            errors=errors,
            progress_current=db.progress_current or 0,
            progress_total=db.progress_total or 0,
            undo_available=db.undo_available or False,
            undone_at=db.undone_at
        )
    
    def _item_db_to_model(self, db: ImportItemDB) -> ImportItem:
        """Convert DB import item to Pydantic model"""
        raw_json = None
        if db.raw_json:
            try:
                raw_json = json.loads(db.raw_json)
            except:
                pass
        
        validation_messages = []
        if db.validation_messages:
            try:
                msgs = json.loads(db.validation_messages)
                validation_messages = [ValidationMessage(**m) for m in msgs]
            except:
                pass
        
        return ImportItem(
            id=db.id,
            habit_key=db.habit_key,
            habit_name=db.habit_name,
            date=db.date,
            amount=db.amount,
            unit_type=db.unit_type,
            raw_json=raw_json,
            row_index=db.row_index,
            validation_status=ValidationStatus(db.validation_status),
            validation_messages=validation_messages,
            dedupe_key=db.dedupe_key,
            conflict_status=db.conflict_status,
            existing_log_id=db.existing_log_id
        )


# Global service instance
import_service = ImportService()
