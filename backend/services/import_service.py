"""
Import Service - Robust data import system with:
- Duplicate detection + idempotency
- Batch ingestion
- Progress tracking
- Validation + preview
- Conflict resolution
- Undo/rollback support
"""

import uuid
import hashlib
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy import select, and_, or_, func
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
    
    date_str = date_str.strip()
    
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
        pass
    
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
    # IMPORT ITEMS (STAGING)
    # ================================
    
    async def add_import_items(
        self,
        run_id: str,
        items: List[ImportItem]
    ) -> int:
        """
        Add items to the staging table for preview.
        Returns count of items added.
        """
        async with get_db_session() as session:
            try:
                count = 0
                for item in items:
                    item_db = ImportItemDB(
                        id=str(uuid.uuid4()),
                        import_run_id=run_id,
                        habit_key=item.habit_key,
                        habit_name=item.habit_name,
                        date=item.date,
                        amount=item.amount,
                        unit_type=item.unit_type,
                        raw_json=json.dumps(item.raw_json) if item.raw_json else None,
                        row_index=item.row_index,
                        validation_status=item.validation_status.value,
                        validation_messages=json.dumps([m.model_dump() for m in item.validation_messages]) if item.validation_messages else None,
                        dedupe_key=item.dedupe_key,
                        conflict_status=item.conflict_status,
                        existing_log_id=item.existing_log_id
                    )
                    session.add(item_db)
                    count += 1
                
                await session.commit()
                return count
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to add import items: {str(e)}")
    
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
    # DEDUPLICATION & CONFLICT DETECTION
    # ================================
    
    async def check_duplicates(
        self,
        user_id: str,
        items: List[ImportItem]
    ) -> DedupeEstimate:
        """
        Check how many items would be duplicates or conflicts.
        """
        async with get_db_session() as session:
            total = len(items)
            duplicates = 0
            conflicts = 0
            
            # Build lookup of existing logs
            dates = list(set(item.date for item in items))
            habit_keys = list(set(item.habit_key for item in items))
            
            # Get existing habit IDs for these keys
            habit_query = select(HabitDB).where(
                and_(
                    HabitDB.user_id == user_id,
                    or_(
                        HabitDB.metric_type.in_([k.split(":")[-1] for k in habit_keys]),
                        HabitDB.name.in_([k.split(":")[-1] for k in habit_keys])
                    )
                )
            )
            result = await session.execute(habit_query)
            habits = {h.metric_type or h.name: h.id for h in result.scalars().all()}
            
            # Check for existing logs
            for item in items:
                metric_key = item.habit_key.split(":")[-1]
                habit_id = habits.get(metric_key)
                
                if not habit_id:
                    continue
                
                # Check for exact duplicate (same dedupe_key) or conflict (same habit+date)
                if item.dedupe_key:
                    existing = await session.execute(
                        select(HabitLogDB).where(
                            HabitLogDB.dedupe_key == item.dedupe_key
                        ).limit(1)
                    )
                    if existing.scalar_one_or_none():
                        duplicates += 1
                        item.conflict_status = "duplicate"
                        continue
                
                # Check for same habit+date conflict
                existing = await session.execute(
                    select(HabitLogDB).where(
                        and_(
                            HabitLogDB.habit_id == habit_id,
                            HabitLogDB.date == item.date
                        )
                    ).limit(1)
                )
                log = existing.scalar_one_or_none()
                if log:
                    conflicts += 1
                    item.conflict_status = "conflict"
                    item.existing_log_id = log.id
            
            return DedupeEstimate(
                total_items=total,
                new_items=total - duplicates - conflicts,
                duplicates=duplicates,
                conflicts=conflicts
            )
    
    # ================================
    # BATCH LOG CREATION
    # ================================
    
    async def create_logs_batch(
        self,
        user_id: str,
        request: BatchLogsRequest
    ) -> BatchLogsResponse:
        """
        Create habit logs in batch with conflict resolution.
        """
        async with get_db_session() as session:
            try:
                results: List[BatchLogResult] = []
                inserted = 0
                updated = 0
                skipped = 0
                errors = 0
                
                # Validate all habits belong to user
                habit_ids = list(set(log.habit_id for log in request.logs))
                habit_query = select(HabitDB).where(
                    and_(
                        HabitDB.id.in_(habit_ids),
                        HabitDB.user_id == user_id
                    )
                )
                result = await session.execute(habit_query)
                valid_habits = {h.id: h for h in result.scalars().all()}
                
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
                        
                        # Generate dedupe key
                        dedupe_key = log_data.dedupe_key or generate_dedupe_key(
                            user_id=user_id,
                            habit_id=log_data.habit_id,
                            date=log_data.date,
                            amount=log_data.amount,
                            unit_type=log_data.unit_type,
                            source=log_data.source or "import",
                            source_id=log_data.source_id
                        )
                        
                        # Check for existing log with same dedupe_key
                        existing_by_key = await session.execute(
                            select(HabitLogDB).where(
                                HabitLogDB.dedupe_key == dedupe_key
                            ).limit(1)
                        )
                        if existing_by_key.scalar_one_or_none():
                            # Exact duplicate - always skip
                            results.append(BatchLogResult(
                                index=i,
                                status="skipped",
                                error="Exact duplicate"
                            ))
                            skipped += 1
                            continue
                        
                        # Check for existing log with same habit+date
                        existing_by_date = await session.execute(
                            select(HabitLogDB).where(
                                and_(
                                    HabitLogDB.habit_id == log_data.habit_id,
                                    HabitLogDB.date == log_data.date
                                )
                            ).limit(1)
                        )
                        existing_log = existing_by_date.scalar_one_or_none()
                        
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
                                # For average, we'd need sample_count; for now just overwrite
                                existing_log.amount = log_data.amount
                                existing_log.import_run_id = request.import_run_id
                                
                                results.append(BatchLogResult(
                                    index=i,
                                    status="updated",
                                    log_id=existing_log.id
                                ))
                                updated += 1
                                continue
                        
                        # Create new log
                        log_id = str(uuid.uuid4())
                        new_log = HabitLogDB(
                            id=log_id,
                            habit_id=log_data.habit_id,
                            habit_name=habit.name,
                            amount=log_data.amount,
                            duration=log_data.duration,
                            date=log_data.date,
                            completed_at=datetime.utcnow().isoformat(),
                            status="completed",
                            notes=log_data.notes,
                            source=log_data.source or "import",
                            source_id=log_data.source_id,
                            dedupe_key=dedupe_key,
                            import_run_id=request.import_run_id
                        )
                        session.add(new_log)
                        
                        results.append(BatchLogResult(
                            index=i,
                            status="inserted",
                            log_id=log_id
                        ))
                        inserted += 1
                        
                    except Exception as e:
                        results.append(BatchLogResult(
                            index=i,
                            status="error",
                            error=str(e)
                        ))
                        errors += 1
                
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
        Undo an import run by deleting all logs created by it.
        Optionally deletes habits that were created and have no other logs.
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
                
                # Get summary to find created habits
                summary = json.loads(run_db.summary_json) if run_db.summary_json else {}
                created_habit_ids = summary.get("created_habit_ids", [])
                
                # Delete all logs from this import run
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
                
                return UndoImportResponse(
                    import_run_id=run_id,
                    logs_deleted=logs_to_delete,
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

