"""Import API router extracted from main.py."""

import asyncio
import logging
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from models.habit_models import HabitCreate

logger = logging.getLogger(__name__)


def create_imports_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
    habits_service: Any,
    tinybird_service: Any,
) -> APIRouter:
    router = APIRouter(tags=["imports"])

    # ROBUST IMPORT SYSTEM ENDPOINTS
    # ================================
    
    from services.import_service import import_service
    from models.import_models import (
        ImportSource, ImportStatus, ConflictPolicy, AggregationPeriod,
        ImportOptions, ImportRunCreate, ImportRunSummary, ImportRun,
        ImportItem, ImportPreviewResponse, BatchLogsRequest, BatchLogsResponse,
        ChunkIngestRequest, ChunkIngestResponse, UndoImportResponse
    )
    
    # In-process background import task registry.
    # This keeps long-running imports off the request path.
    _import_tasks: Dict[str, asyncio.Task] = {}
    _import_tasks_lock = asyncio.Lock()
    
    
    class ImportRunCreateRequest(BaseModel):
        """Request to create a new import run"""
        source: str  # csv, screenshot, apple_health, whoop, oura, garmin
        file_name: Optional[str] = None
        options: Optional[dict] = None
    
    
    @router.post("/api/import/runs")
    async def create_import_run(
        request: ImportRunCreateRequest,
        current_user = Depends(get_current_user)
    ):
        """
        Create a new import run.
        This initializes the import job without processing any data.
        """
        try:
            source = ImportSource(request.source)
            options = None
            if request.options:
                options = ImportOptions(**request.options)
            
            run = await import_service.create_import_run(
                user_id=current_user["id"],
                source=source,
                file_name=request.file_name,
                options=options
            )
            
            return run.model_dump()
            
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Invalid source value.")
        except Exception as e:
            logger.error(f"❌ Create import run error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/import/runs/{run_id}")
    async def get_import_run(
        run_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        Get an import run by ID.
        """
        try:
            run = await import_service.get_import_run(run_id, current_user["id"])
            
            if not run:
                raise HTTPException(status_code=404, detail="Import run not found")
            
            return run.model_dump()
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Get import run error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/import/runs")
    async def list_import_runs(
        limit: int = 20,
        offset: int = 0,
        current_user = Depends(get_current_user)
    ):
        """
        Get import history for the user.
        """
        try:
            runs = await import_service.get_import_history(
                current_user["id"],
                limit=limit,
                offset=offset
            )
            
            return {
                "runs": [run.model_dump() for run in runs],
                "count": len(runs)
            }
            
        except Exception as e:
            logger.error(f"❌ List import runs error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    class BatchLogsApiRequest(BaseModel):
        """API request for batch log creation"""
        import_run_id: Optional[str] = None
        conflict_policy: str = "skip_existing"  # skip_existing, overwrite_existing, merge_sum, merge_avg
        logs: List[dict]
    
    
    @router.post("/api/habits/logs/batch")
    @limiter.limit("30/minute")
    async def create_logs_batch(
        request: Request,
        batch_request: BatchLogsApiRequest,
        current_user = Depends(get_current_user)
    ):
        """
        Create habit logs in batch with conflict resolution.
        
        This endpoint:
        1. Validates all habits belong to the user
        2. Generates dedupe keys for each log
        3. Applies conflict resolution policy
        4. Performs bulk insert/upsert
        5. Returns detailed results per log
        """
        try:
            from models.import_models import BatchLogCreate, BatchLogsRequest as BatchRequest
            
            # Validate batch size
            if len(batch_request.logs) > 2000:
                raise HTTPException(status_code=400, detail="Maximum 2000 logs per batch")
            
            # Parse conflict policy
            try:
                conflict_policy = ConflictPolicy(batch_request.conflict_policy)
            except ValueError:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Invalid conflict_policy. Must be one of: skip_existing, overwrite_existing, merge_sum, merge_avg"
                )
            
            # Convert logs to BatchLogCreate objects
            logs = []
            for i, log_dict in enumerate(batch_request.logs):
                try:
                    logs.append(BatchLogCreate(**log_dict))
                except Exception as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid log at index {i}."
                    )
            
            # Create request object
            batch_req = BatchRequest(
                import_run_id=batch_request.import_run_id,
                conflict_policy=conflict_policy,
                logs=logs
            )
            
            # Process batch
            result = await import_service.create_logs_batch(
                user_id=current_user["id"],
                request=batch_req
            )
            
            return result.model_dump()
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Batch log creation error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.post("/api/import/runs/{run_id}/undo")
    async def undo_import_run(
        run_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        Undo an import run by deleting all logs it created.
        Also deletes any habits that were created by this import and now have no logs.
        """
        try:
            result = await import_service.undo_import_run(run_id, current_user["id"])
            return result.model_dump()
            
        except HTTPException:
            raise
        except Exception as e:
            if "not found" in str(e).lower():
                raise HTTPException(status_code=404, detail="Request could not be processed.")
            if "cannot be undone" in str(e).lower():
                raise HTTPException(status_code=400, detail="Request could not be processed.")
            logger.error(f"❌ Undo import error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    class ImportPreviewApiRequest(BaseModel):
        """API request for import preview"""
        source: str
        file_content: Optional[str] = None  # Base64 encoded file content
        options: Optional[dict] = None
    
    
    # Configuration for preview limits
    PREVIEW_PARSE_LIMIT = 500  # Max rows to parse for preview
    PREVIEW_SAMPLE_SIZE = 50   # Sample items to return in response
    PREVIEW_DEDUPE_CHECK_LIMIT = 100  # Items to check for duplicates
    PREVIEW_STAGE_LIMIT = 50   # Items to stage (reduced from 500)
    
    
    @router.post("/api/import/preview")
    @limiter.limit("20/minute")
    async def preview_import(
        request: Request,
        file: UploadFile = File(...),
        source: str = Form(None),
        options: str = Form(None),  # JSON string of options (moved from header)
        current_user = Depends(get_current_user)
    ):
        """
        OPTIMIZED Preview endpoint - returns in <300ms for CSV.
        
        Accepts FormData with:
        - file: The file to import
        - source: Import source type (csv, screenshot, etc.)
        - options: JSON string of import options (replaces X-Import-Options header)
        
        Performance optimizations:
        - Idempotent: Returns existing run if same file hash exists
        - Bulk queries for duplicate checking
        - Only stages sample items (50 instead of 500)
        - Screenshot AI runs asynchronously (returns immediately with status="parsing")
        
        Returns:
        - Summary counts (total, new, duplicates, conflicts)
        - Sample of items that will be imported
        - Validation issues
        - Detected columns/metrics
        """
        import json
        import csv
        import io
        import hashlib
        from services.import_service import parse_date_flexible
        
        try:
            # Get file content from upload
            file_content = await file.read()
            file_name = file.filename
            
            if not file_content:
                raise HTTPException(status_code=400, detail="No file provided")
            
            # Parse options from FormData body OR header (backward compatible)
            options_dict = {}
            if options:
                try:
                    options_dict = json.loads(options)
                except json.JSONDecodeError:
                    pass
            
            # Fallback to header for backward compatibility
            if not options_dict:
                import_options_header = request.headers.get("X-Import-Options")
                if import_options_header:
                    try:
                        header_data = json.loads(import_options_header)
                        source = source or header_data.get("source")
                        options_dict = header_data.get("options", {})
                    except json.JSONDecodeError:
                        pass
            
            if not source:
                raise HTTPException(status_code=400, detail="Source is required")
            
            # Parse source enum
            try:
                source_enum = ImportSource(source)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid source: {source}")
            
            # Parse options
            import_options = None
            if options_dict:
                try:
                    import_options = ImportOptions(**options_dict)
                except Exception as e:
                    logger.warning(f"⚠️ Could not parse import options: {e}")
            
            # OPTIMIZATION: Check for existing run with same file hash (idempotent)
            file_hash = hashlib.sha256(file_content).hexdigest()
            existing_run = await import_service.find_existing_run_by_hash(
                current_user["id"],
                file_hash,
                source_enum
            )
            
            if existing_run:
                logger.info(f"♻️ Resuming existing import run: {existing_run.id}")
                # Return cached preview data
                existing_items = await import_service.get_import_items(existing_run.id, limit=PREVIEW_SAMPLE_SIZE)
                
                return {
                    "import_run_id": existing_run.id,
                    "source": source_enum.value,
                    "resumed": True,
                    "summary": existing_run.summary.model_dump() if existing_run.summary else {
                        "total_rows": 0, "parsed": 0, "new_items": 0, "duplicates": 0, "conflicts": 0
                    },
                    "sample_items": [item.model_dump() for item in existing_items],
                    "validation_issues": [item.model_dump() for item in existing_items if item.validation_status != "ok"][:20],
                    "dedupe_estimate": {"total_items": 0, "new_items": 0, "duplicates": 0, "conflicts": 0},
                    "detected_columns": None,
                    "detected_metrics": None
                }
            
            # Create import run for preview
            run = await import_service.create_import_run(
                user_id=current_user["id"],
                source=source_enum,
                file_name=file_name,
                file_content=file_content,
                options=import_options
            )
            
            # OPTIMIZATION: Pre-fetch and cache habits once
            habits = await import_service.get_cached_habits(current_user["id"])
            
            items = []
            detected_columns = None
            detected_metrics = None
            total_rows_in_file = 0
            
            if source_enum == ImportSource.CSV:
                # Parse CSV with streaming (don't load entire file structure)
                text_content = file_content.decode('utf-8')
                reader = csv.DictReader(io.StringIO(text_content))
                detected_columns = reader.fieldnames
                
                for i, row in enumerate(reader):
                    total_rows_in_file += 1
                    if i >= PREVIEW_PARSE_LIMIT:  # Limit for preview
                        continue  # Still count total rows
                    
                    # Parse date - try multiple columns
                    date_col = (import_options.date_column if import_options else None)
                    date_val = None
                    for col_name in [date_col, 'date', 'Date', 'DATE', 'timestamp', 'Timestamp', 'day', 'Day']:
                        if col_name and col_name in row:
                            date_val = row.get(col_name)
                            if date_val:
                                break
                    
                    parsed_date = parse_date_flexible(date_val) if date_val else None
                    
                    # Get value columns from mapping or auto-detect
                    if import_options and import_options.column_mappings:
                        for mapping in import_options.column_mappings:
                            val = row.get(mapping.source_column)
                            try:
                                amount = float(val) if val else None
                            except:
                                amount = None
                            
                            items.append(ImportItem(
                                habit_key=mapping.habit_key or f"csv:{mapping.habit_name}",
                                habit_name=mapping.habit_name,
                                date=parsed_date or date_val or '',
                                amount=amount,
                                unit_type=mapping.unit_type,
                                raw_json=row,
                                row_index=i
                            ))
                    else:
                        # Auto-detect value columns (non-date numeric columns)
                        for col, val in row.items():
                            if col.lower() in ['date', 'time', 'datetime', 'timestamp', 'day']:
                                continue
                            try:
                                amount = float(val)
                                items.append(ImportItem(
                                    habit_key=f"csv:{col}",
                                    habit_name=col,
                                    date=parsed_date or '',
                                    amount=amount,
                                    raw_json=row,
                                    row_index=i
                                ))
                            except:
                                pass
            
            elif source_enum == ImportSource.SCREENSHOT:
                # Check for OpenAI key
                openai_key = os.getenv("OPENAI_API_KEY")
                if not openai_key:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "OPENAI_KEY_MISSING",
                            "message": "Screenshot import requires an OpenAI API key configured on the server."
                        }
                    )
                
                # OPTIMIZATION: For screenshots, we still analyze synchronously since it's a single item
                # but we could move to async with status polling for better UX
                from services.screenshot_analyzer import analyze_screenshot_for_habits
                
                habits_for_analysis = [
                    {"id": h.id, "name": h.name, "unit_type": h.unit_type}
                    for h in habits
                ]
                
                analysis = analyze_screenshot_for_habits(file_content, habits_for_analysis)
                
                if analysis:
                    confidence = analysis.get("confidence", 0.5)
                    validation_status = "ok" if confidence >= 0.75 else "warning"
                    
                    items.append(ImportItem(
                        habit_key=f"screenshot:{analysis.get('detected_type', 'unknown')}",
                        habit_name=analysis.get("habit_name", "Unknown"),
                        date=datetime.utcnow().strftime("%Y-%m-%d"),
                        amount=analysis.get("value"),
                        unit_type=analysis.get("unit"),
                        validation_status=validation_status,
                        raw_json=analysis
                    ))
                    
                    detected_metrics = [{
                        "name": analysis.get("habit_name"),
                        "value": analysis.get("value"),
                        "unit": analysis.get("unit"),
                        "confidence": confidence,
                        "detected_type": analysis.get("detected_type")
                    }]
                
                total_rows_in_file = len(items)
            
            # V2: Apply validation rules to all items
            from services.import_validator import (
                ImportValidator, calculate_confidence, ValidationRules, MatchReason
            )
            
            validation_rules = import_options.validation_rules if import_options else None
            validator = ImportValidator(validation_rules or ValidationRules())
            
            # Validate all items and add confidence scores
            for item in items:
                validator.validate_item(item)
                
                # Calculate confidence based on how the item was matched
                match_type = MatchReason.EXACT_NAME  # Default for CSV
                inferred_fields = []
                
                if not item.date or item.date == '':
                    inferred_fields.append("date")
                if not item.unit_type:
                    inferred_fields.append("unit")
                if source_enum == ImportSource.SCREENSHOT:
                    match_type = MatchReason.AI_DETECTED
                
                item.confidence = calculate_confidence(item, match_type, inferred_fields)
            
            # OPTIMIZATION: Bulk duplicate check (2 queries instead of N+1)
            dedupe_estimate = await import_service.check_duplicates_bulk(
                current_user["id"],
                items[:PREVIEW_DEDUPE_CHECK_LIMIT],
                habits=habits
            )
            
            # OPTIMIZATION: Only stage sample items (50 instead of 500)
            # Full staging happens when user clicks "Start Import"
            await import_service.add_import_items_bulk(run.id, items[:PREVIEW_STAGE_LIMIT])
            
            # V2: Calculate validation summary
            validation_issues = [item for item in items[:PREVIEW_SAMPLE_SIZE] if item.validation_status != "ok"]
            errors_count = sum(1 for item in items if item.validation_status == "error")
            warnings_count = sum(1 for item in items if item.validation_status == "warning")
            auto_fixable = sum(
                1 for item in items 
                if any(m.auto_fixable for m in item.validation_messages)
            )
            
            # V2: Calculate confidence summary
            high_conf = sum(1 for item in items if item.confidence and item.confidence.score >= 0.9)
            med_conf = sum(1 for item in items if item.confidence and 0.7 <= item.confidence.score < 0.9)
            low_conf = sum(1 for item in items if item.confidence and item.confidence.score < 0.7)
            
            # Update run status with accurate counts
            await import_service.update_import_run_status(
                run.id,
                ImportStatus.READY,
                summary=ImportRunSummary(
                    total_rows=total_rows_in_file or len(items),
                    parsed=len(items),
                    errors=errors_count
                )
            )
            
            return {
                "import_run_id": run.id,
                "source": source_enum.value,
                "summary": {
                    "total_rows": total_rows_in_file or len(items),
                    "parsed": len(items),
                    "imported": 0,
                    "skipped": 0,
                    "updated": 0,
                    "duplicates": dedupe_estimate.duplicates,
                    "errors": errors_count,
                    # V2: Enhanced summary
                    "will_create": dedupe_estimate.new_items,
                    "will_update": dedupe_estimate.conflicts,
                    "will_skip": dedupe_estimate.duplicates,
                    "has_warnings": warnings_count,
                    "has_errors": errors_count,
                    "auto_fixable": auto_fixable,
                },
                "sample_items": [item.model_dump() for item in items[:PREVIEW_SAMPLE_SIZE]],
                "validation_issues": [item.model_dump() for item in validation_issues[:20]],
                "dedupe_estimate": dedupe_estimate.model_dump(),
                "detected_columns": detected_columns,
                "detected_metrics": detected_metrics,
                # V2: Confidence summary
                "confidence_summary": {
                    "high": high_conf,
                    "medium": med_conf,
                    "low": low_conf
                },
                # V2: Validation summary
                "validation_summary": {
                    "total_errors": errors_count,
                    "total_warnings": warnings_count,
                    "auto_fixable_count": auto_fixable
                }
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Import preview error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    class ImportStartRequest(BaseModel):
        """Request to start importing"""
        import_run_id: Optional[str] = None
        conflict_policy: str = "skip_existing"
        create_habits: bool = True  # Whether to auto-create habits that don't exist
    
    
    @router.post("/api/import/runs/{run_id}/start")
    async def start_import(
        run_id: str,
        start_request: ImportStartRequest,
        current_user = Depends(get_current_user)
    ):
        """
        Start the actual import process.
        Uses chunked processing for large imports.
        """
        try:
            run = await import_service.get_import_run(run_id, current_user["id"])
            if not run:
                raise HTTPException(status_code=404, detail="Import run not found")
    
            if start_request.import_run_id and start_request.import_run_id != run_id:
                raise HTTPException(status_code=400, detail="Path run_id and payload import_run_id do not match")
    
            if run.status == ImportStatus.IMPORTING:
                async with _import_tasks_lock:
                    task = _import_tasks.get(run_id)
                    if task and not task.done():
                        return JSONResponse(
                            status_code=202,
                            content={
                                "status": "importing",
                                "import_run_id": run_id,
                                "message": "Import is already running in the background",
                            },
                        )
    
            if run.status not in [ImportStatus.READY, ImportStatus.IMPORTING]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Import run is not ready. Current status: {run.status.value}"
                )
    
            if run.status == ImportStatus.READY:
                await import_service.update_import_run_status(run_id, ImportStatus.IMPORTING)
    
            async with _import_tasks_lock:
                existing = _import_tasks.get(run_id)
                if existing and not existing.done():
                    return JSONResponse(
                        status_code=202,
                        content={
                            "status": "importing",
                            "import_run_id": run_id,
                            "message": "Import is already running in the background",
                        },
                    )
    
                _import_tasks[run_id] = asyncio.create_task(
                    _run_import_job(
                        run_id=run_id,
                        user_id=current_user["id"],
                        conflict_policy_raw=start_request.conflict_policy,
                        create_habits=start_request.create_habits,
                    )
                )
    
            return JSONResponse(
                status_code=202,
                content={
                    "status": "importing",
                    "import_run_id": run_id,
                    "message": "Import started in background",
                },
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Start import error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    async def _run_import_job(
        run_id: str,
        user_id: str,
        conflict_policy_raw: str,
        create_habits: bool
    ) -> None:
        """
        Execute a long-running import in a background task.
        """
        try:
            run = await import_service.get_import_run(run_id, user_id)
            if not run:
                return
    
            items = await import_service.get_import_items(run_id, limit=10000)
            total_items = len(items)
    
            if total_items == 0:
                await import_service.update_import_run_status(
                    run_id,
                    ImportStatus.COMPLETED,
                    summary=ImportRunSummary()
                )
                return
    
            await import_service.update_import_progress(run_id, 0, total_items)
    
            try:
                conflict_policy = ConflictPolicy(conflict_policy_raw)
            except ValueError:
                conflict_policy = ConflictPolicy.SKIP_EXISTING
    
            from collections import defaultdict
            items_by_habit = defaultdict(list)
            for item in items:
                items_by_habit[item.habit_key].append(item)
    
            from models.import_models import BatchLogCreate, BatchLogsRequest as BatchRequest
    
            summary = ImportRunSummary(total_rows=total_items)
            created_habit_ids = []
            existing_habits = await habits_service.get_habits(user_id)
    
            def fuzzy_match_habit(csv_name: str, existing_habits: list) -> tuple:
                SYNONYMS = {
                    "sleep": ["sleep", "rest", "slept", "sleeping", "bed", "nap"],
                    "duration": ["duration", "time", "hours", "length", "total"],
                    "steps": ["steps", "step", "walking", "walk", "walked", "footsteps"],
                    "workout": ["workout", "exercise", "training", "gym", "fitness"],
                    "run": ["run", "running", "jog", "jogging"],
                    "caffeine": ["caffeine", "coffee", "tea", "espresso", "energy"],
                    "water": ["water", "hydration", "drink", "fluid", "h2o"],
                    "calories": ["calories", "cal", "kcal", "energy", "food"],
                    "meditation": ["meditation", "meditate", "mindfulness", "mindful", "zen", "calm"],
                    "reading": ["reading", "read", "book", "pages", "literature"],
                    "screen": ["screen", "screentime", "phone", "device", "digital"],
                    "heart": ["heart", "hr", "heartrate", "pulse", "bpm"],
                    "weight": ["weight", "mass", "kg", "lbs", "pounds"],
                }
    
                UNIT_INFERENCE = {
                    "_mg": "Milligrams", "mg": "Milligrams", "milligrams": "Milligrams",
                    "_hours": "Hours", "hours": "Hours", "_hrs": "Hours", "hrs": "Hours",
                    "_minutes": "Minutes", "minutes": "Minutes", "_mins": "Minutes", "mins": "Minutes",
                    "_min": "Minutes",
                    "_seconds": "Seconds", "seconds": "Seconds", "_secs": "Seconds",
                    "_count": "Count", "count": "Count", "_num": "Count",
                    "_pages": "Pages", "pages": "Pages",
                    "_miles": "Miles", "miles": "Miles", "_mi": "Miles",
                    "_km": "Kilometers", "kilometers": "Kilometers",
                    "_glasses": "Glasses", "glasses": "Glasses", "_cups": "Cups", "cups": "Cups",
                    "_cal": "Calories", "_kcal": "Calories", "calories": "Calories",
                    "_bpm": "BPM", "bpm": "BPM",
                    "_kg": "Kilograms", "kg": "Kilograms",
                    "_lbs": "Pounds", "lbs": "Pounds", "pounds": "Pounds",
                }
    
                def get_synonym_group(word: str) -> set:
                    result = {word}
                    for key, synonyms in SYNONYMS.items():
                        if word in synonyms or key == word:
                            result.update(synonyms)
                            result.add(key)
                    return result
    
                def infer_unit(name: str) -> str:
                    name_lower = name.lower()
                    for pattern, unit in UNIT_INFERENCE.items():
                        if name_lower.endswith(pattern) or pattern in name_lower.split("_"):
                            return unit
                    return "Count"
    
                def tokenize(name: str) -> set:
                    import re
                    name = name.replace("_", " ").replace("-", " ").replace(".", " ")
                    name = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
                    return {w.lower() for w in name.split() if len(w) >= 2}
    
                def calculate_match_score(csv_words: set, habit_words: set) -> float:
                    if not csv_words or not habit_words:
                        return 0
    
                    csv_expanded = set()
                    for w in csv_words:
                        csv_expanded.update(get_synonym_group(w))
    
                    habit_expanded = set()
                    for w in habit_words:
                        habit_expanded.update(get_synonym_group(w))
    
                    direct_overlap = csv_words & habit_words
                    if direct_overlap:
                        return 0.95
    
                    synonym_overlap = csv_expanded & habit_expanded
                    if synonym_overlap:
                        return 0.85
    
                    for cw in csv_words:
                        for hw in habit_words:
                            if len(cw) >= 4 and len(hw) >= 4:
                                min_len = min(len(cw), len(hw))
                                prefix_len = 0
                                for i in range(min_len):
                                    if cw[i] == hw[i]:
                                        prefix_len += 1
                                    else:
                                        break
                                if prefix_len >= 4:
                                    return 0.75
    
                    return 0
    
                csv_words = tokenize(csv_name)
                inferred_unit = infer_unit(csv_name)
                best_match = None
                best_score = 0
    
                for h in existing_habits:
                    habit_words = tokenize(h.name)
    
                    if csv_name.lower().replace("_", " ") == h.name.lower():
                        return (h.id, 1.0, inferred_unit)
    
                    score = calculate_match_score(csv_words, habit_words)
                    if h.unit_type and inferred_unit.lower() == h.unit_type.lower():
                        score = min(score + 0.05, 1.0)
    
                    if score > best_score:
                        best_match = h.id
                        best_score = score
    
                return (best_match, best_score, inferred_unit) if best_score >= 0.5 else (None, 0, inferred_unit)
    
            for habit_key, habit_items in items_by_habit.items():
                latest_run = await import_service.get_import_run(run_id, user_id)
                if latest_run and latest_run.status == ImportStatus.CANCELED:
                    return
    
                habit_name = habit_items[0].habit_name or habit_key.split(":")[-1]
                unit_type = habit_items[0].unit_type
                habit_id = None
    
                for h in existing_habits:
                    if h.metric_type and h.metric_type == habit_key.split(":")[-1]:
                        habit_id = h.id
                        logger.info(f"✅ Matched '{habit_name}' to existing habit '{h.name}' by metric_type")
                        break
    
                if not habit_id:
                    matched_id, confidence, inferred_unit = fuzzy_match_habit(habit_name, existing_habits)
                    if matched_id:
                        habit_id = matched_id
                        matched_habit = next((h for h in existing_habits if h.id == matched_id), None)
                        logger.info(f"✅ Fuzzy matched '{habit_name}' to existing habit '{matched_habit.name}' (confidence: {confidence:.0%})")
                    elif not unit_type:
                        unit_type = inferred_unit
                        logger.info(f"📋 Inferred unit '{inferred_unit}' for new habit '{habit_name}'")
    
                if not habit_id and create_habits:
                    source_prefix = habit_key.split(":")[0] if ":" in habit_key else "csv"
                    metric_type = habit_key.split(":")[-1] if ":" in habit_key else None
    
                    category_map = {
                        "steps": "health", "hr": "health", "hrv": "health",
                        "sleep": "health", "active_energy": "health",
                        "screen_time": "wellness", "meetings": "productivity"
                    }
                    category = category_map.get(metric_type, "other")
    
                    new_habit = await habits_service.create_habit(
                        HabitCreate(
                            name=habit_name,
                            category=category,
                            unit_type=unit_type or "count",
                            is_custom=True,
                            integration_source=source_prefix if source_prefix in ["apple_health", "whoop", "oura", "garmin"] else "import",
                            metric_type=metric_type
                        ),
                        user_id
                    )
                    habit_id = new_habit.id
                    created_habit_ids.append(habit_id)
    
                if not habit_id:
                    summary.skipped += len(habit_items)
                    continue
    
                logs = [
                    BatchLogCreate(
                        habit_id=habit_id,
                        date=item.date,
                        amount=item.amount,
                        unit_type=item.unit_type,
                        source=f"{run.source.value}_import",
                        dedupe_key=item.dedupe_key
                    )
                    for item in habit_items
                    if item.date
                ]
    
                if logs:
                    batch_req = BatchRequest(
                        import_run_id=run_id,
                        conflict_policy=conflict_policy,
                        logs=logs
                    )
    
                    result = await import_service.create_logs_batch(user_id, batch_req)
    
                    summary.imported += result.inserted
                    summary.updated += result.updated
                    summary.skipped += result.skipped
                    summary.errors += result.errors
    
                    habit_for_tinybird = await habits_service.get_habit_by_id(habit_id, user_id)
                    if habit_for_tinybird and tinybird_service:
                        tinybird_payloads: List[Dict[str, Any]] = []
                        for log_result in result.results:
                            if log_result.status in ["inserted", "updated"] and log_result.log_id:
                                log_data = logs[log_result.index] if log_result.index < len(logs) else None
                                if log_data:
                                    tinybird_payloads.append({
                                            'id': log_result.log_id,
                                            'habit_id': habit_id,
                                            'habit_name': habit_for_tinybird.name,
                                            'user_id': user_id,
                                            'date': log_data.date,
                                            'duration': log_data.duration or 0,
                                            'amount': log_data.amount or 0,
                                            'unit': habit_for_tinybird.unit_type or 'count',
                                            'status': 'completed',
                                            'notes': log_data.notes or '',
                                            'completed_at': datetime.utcnow().isoformat(),
                                            'source': log_data.source or f'{run.source.value}_import'
                                        })

                        if tinybird_payloads:
                            try:
                                sync_result = await tinybird_service.ingest_habit_logs_batch(tinybird_payloads)
                                synced_count = int(sync_result.get("total_ingested") or 0)
                                if not sync_result.get("success"):
                                    logger.warning(
                                        f"⚠️ Tinybird batch sync had errors for habit '{habit_for_tinybird.name}': "
                                        f"{sync_result.get('errors') or sync_result.get('error')}"
                                    )
                                if synced_count > 0:
                                    logger.info(f"📊 Synced {synced_count} logs to Tinybird for habit '{habit_for_tinybird.name}'")
                            except Exception as tb_err:
                                logger.warning(f"⚠️ Tinybird batch sync error for import habit '{habit_for_tinybird.name}': {tb_err}")
    
                processed = summary.imported + summary.updated + summary.skipped + summary.errors
                await import_service.update_import_progress(run_id, processed, total_items)
    
            summary.created_habit_ids = created_habit_ids
            await import_service.update_import_run_status(
                run_id,
                ImportStatus.COMPLETED,
                summary=summary
            )
    
        except asyncio.CancelledError:
            await import_service.update_import_run_status(run_id, ImportStatus.CANCELED)
            raise
        except Exception as e:
            await import_service.update_import_run_status(
                run_id,
                ImportStatus.FAILED,
                errors=[{"error": str(e)}]
            )
            logger.error(f"❌ Import background job failed ({run_id}): {str(e)}")
        finally:
            async with _import_tasks_lock:
                _import_tasks.pop(run_id, None)
    
    
    @router.post("/api/import/runs/{run_id}/cancel")
    async def cancel_import(
        run_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        Cancel an in-progress import.
        """
        try:
            run = await import_service.get_import_run(run_id, current_user["id"])
            if not run:
                raise HTTPException(status_code=404, detail="Import run not found")
            
            if run.status not in [ImportStatus.CREATED, ImportStatus.PARSING, ImportStatus.READY, ImportStatus.IMPORTING]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot cancel import in status: {run.status.value}"
                )
    
            task_canceled = False
            async with _import_tasks_lock:
                task = _import_tasks.get(run_id)
                if task and not task.done():
                    task.cancel()
                    task_canceled = True
            
            await import_service.update_import_run_status(run_id, ImportStatus.CANCELED)
            
            return {
                "status": "canceled",
                "import_run_id": run_id,
                "task_canceled": task_canceled
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Cancel import error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # ================================
    # V2: MAPPING TEMPLATES ENDPOINTS
    # ================================
    
    from models.import_models import MappingPresetCreate, MappingPreset, ImportHistoryFilters
    
    
    @router.post("/api/import/templates")
    async def create_mapping_template(
        template: MappingPresetCreate,
        current_user = Depends(get_current_user)
    ):
        """
        V2: Create a reusable mapping template for imports.
        Templates can be saved and reused across multiple imports.
        """
        try:
            import uuid
            import json
            from database.connection import get_db_session
            from database.models import ImportMappingPresetDB
            
            template_id = str(uuid.uuid4())
            
            async with get_db_session() as session:
                preset_db = ImportMappingPresetDB(
                    id=template_id,
                    user_id=current_user["id"],
                    name=template.name,
                    source=template.source.value,
                    mapping_json=json.dumps({
                        "description": template.description,
                        "mapping": template.mapping.model_dump(),
                        "example_sources": template.example_sources,
                        "tags": template.tags
                    }),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                session.add(preset_db)
                await session.commit()
            
            return {
                "id": template_id,
                "name": template.name,
                "source": template.source.value,
                "created_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Create template error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/import/templates")
    async def list_mapping_templates(
        source: Optional[str] = None,
        current_user = Depends(get_current_user)
    ):
        """
        V2: List all mapping templates for the user.
        Optionally filter by source type.
        """
        try:
            import json
            from database.connection import get_db_session
            from database.models import ImportMappingPresetDB
            from sqlalchemy import select, and_
            
            async with get_db_session() as session:
                query = select(ImportMappingPresetDB).where(
                    ImportMappingPresetDB.user_id == current_user["id"]
                )
                
                if source:
                    query = query.where(ImportMappingPresetDB.source == source)
                
                query = query.order_by(ImportMappingPresetDB.updated_at.desc())
                
                result = await session.execute(query)
                presets = result.scalars().all()
                
                templates = []
                for preset in presets:
                    mapping_data = json.loads(preset.mapping_json) if preset.mapping_json else {}
                    templates.append({
                        "id": preset.id,
                        "name": preset.name,
                        "source": preset.source,
                        "description": mapping_data.get("description"),
                        "example_sources": mapping_data.get("example_sources", []),
                        "tags": mapping_data.get("tags", []),
                        "created_at": preset.created_at.isoformat() if preset.created_at else None,
                        "updated_at": preset.updated_at.isoformat() if preset.updated_at else None
                    })
                
                return {"templates": templates}
            
        except Exception as e:
            logger.error(f"❌ List templates error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/import/templates/{template_id}")
    async def get_mapping_template(
        template_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        V2: Get a specific mapping template.
        """
        try:
            import json
            from database.connection import get_db_session
            from database.models import ImportMappingPresetDB
            from sqlalchemy import select, and_
            
            async with get_db_session() as session:
                result = await session.execute(
                    select(ImportMappingPresetDB).where(
                        and_(
                            ImportMappingPresetDB.id == template_id,
                            ImportMappingPresetDB.user_id == current_user["id"]
                        )
                    )
                )
                preset = result.scalar_one_or_none()
                
                if not preset:
                    raise HTTPException(status_code=404, detail="Template not found")
                
                mapping_data = json.loads(preset.mapping_json) if preset.mapping_json else {}
                
                return {
                    "id": preset.id,
                    "name": preset.name,
                    "source": preset.source,
                    "description": mapping_data.get("description"),
                    "mapping": mapping_data.get("mapping"),
                    "example_sources": mapping_data.get("example_sources", []),
                    "tags": mapping_data.get("tags", []),
                    "created_at": preset.created_at.isoformat() if preset.created_at else None,
                    "updated_at": preset.updated_at.isoformat() if preset.updated_at else None
                }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Get template error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.delete("/api/import/templates/{template_id}")
    async def delete_mapping_template(
        template_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        V2: Delete a mapping template.
        """
        try:
            from database.connection import get_db_session
            from database.models import ImportMappingPresetDB
            from sqlalchemy import select, and_
            
            async with get_db_session() as session:
                result = await session.execute(
                    select(ImportMappingPresetDB).where(
                        and_(
                            ImportMappingPresetDB.id == template_id,
                            ImportMappingPresetDB.user_id == current_user["id"]
                        )
                    )
                )
                preset = result.scalar_one_or_none()
                
                if not preset:
                    raise HTTPException(status_code=404, detail="Template not found")
                
                await session.delete(preset)
                await session.commit()
                
                return {"deleted": True, "id": template_id}
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Delete template error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # ================================
    # V2: AUTO-FIX ENDPOINT
    # ================================
    
    @router.post("/api/import/runs/{run_id}/auto-fix")
    async def auto_fix_import_items(
        run_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        V2: Apply auto-fixes to all fixable validation issues in an import run.
        Returns summary of fixes applied.
        """
        try:
            from services.import_validator import ImportValidator
            
            # Get the import run
            run = await import_service.get_import_run(run_id, current_user["id"])
            if not run:
                raise HTTPException(status_code=404, detail="Import run not found")
            
            # Get all items with validation issues
            items = await import_service.get_import_items(run_id, limit=10000)
            
            # Initialize validator with rules from import options
            rules = run.options.validation_rules if run.options else None
            validator = ImportValidator(rules)
            
            # Apply auto-fixes
            fixed_count = 0
            for item in items:
                if any(m.auto_fixable for m in item.validation_messages):
                    validator.auto_fix_item(item)
                    fixed_count += 1
            
            # Update staged items
            await import_service.clear_import_items(run_id)
            await import_service.add_import_items_bulk(run_id, items[:500])
            
            return {
                "import_run_id": run_id,
                "items_fixed": fixed_count,
                "total_items": len(items)
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Auto-fix error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # ================================
    # V2: ENHANCED IMPORT HISTORY
    # ================================
    
    @router.get("/api/import/history")
    async def get_import_history_filtered(
        source: Optional[str] = None,
        status: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        has_errors: Optional[bool] = None,
        search: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
        current_user = Depends(get_current_user)
    ):
        """
        V2: Get import history with advanced filtering.
        """
        try:
            import json
            from database.connection import get_db_session
            from database.models import ImportRunDB
            from sqlalchemy import select, and_, or_
            
            async with get_db_session() as session:
                query = select(ImportRunDB).where(ImportRunDB.user_id == current_user["id"])
                
                # Apply filters
                conditions = []
                
                if source:
                    conditions.append(ImportRunDB.source == source)
                
                if status:
                    conditions.append(ImportRunDB.status == status)
                
                if date_from:
                    conditions.append(ImportRunDB.created_at >= datetime.fromisoformat(date_from))
                
                if date_to:
                    conditions.append(ImportRunDB.created_at <= datetime.fromisoformat(date_to + "T23:59:59"))
                
                if search:
                    conditions.append(ImportRunDB.file_name.ilike(f"%{search}%"))
                
                if conditions:
                    query = query.where(and_(*conditions))
                
                # Order by most recent first
                query = query.order_by(ImportRunDB.created_at.desc())
                query = query.offset(offset).limit(limit)
                
                result = await session.execute(query)
                runs = result.scalars().all()
                
                # Format response
                history = []
                for run in runs:
                    summary = json.loads(run.summary_json) if run.summary_json else {}
                    
                    # Filter by has_errors if specified
                    if has_errors is not None:
                        run_has_errors = summary.get("errors", 0) > 0
                        if has_errors != run_has_errors:
                            continue
                    
                    history.append({
                        "id": run.id,
                        "source": run.source,
                        "file_name": run.file_name,
                        "status": run.status,
                        "created_at": run.created_at.isoformat() if run.created_at else None,
                        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                        "summary": summary,
                        "undo_available": run.undo_available,
                        "progress_current": run.progress_current,
                        "progress_total": run.progress_total
                    })
                
                return {
                    "runs": history,
                    "total": len(history),
                    "offset": offset,
                    "limit": limit
                }
            
        except Exception as e:
            logger.error(f"❌ Get history error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/import/runs/{run_id}/export")
    async def export_import_run_data(
        run_id: str,
        format: str = "json",  # json or csv
        current_user = Depends(get_current_user)
    ):
        """
        V2: Export parsed data from an import run for debugging.
        """
        try:
            import json
            
            # Get the import run
            run = await import_service.get_import_run(run_id, current_user["id"])
            if not run:
                raise HTTPException(status_code=404, detail="Import run not found")
            
            # Get all items
            items = await import_service.get_import_items(run_id, limit=10000)
            
            if format == "csv":
                import io
                import csv
                
                output = io.StringIO()
                writer = csv.writer(output)
                
                # Header
                writer.writerow([
                    "habit_key", "habit_name", "date", "amount", "unit_type",
                    "validation_status", "conflict_status", "row_index"
                ])
                
                # Data
                for item in items:
                    writer.writerow([
                        item.habit_key,
                        item.habit_name,
                        item.date,
                        item.amount,
                        item.unit_type,
                        item.validation_status,
                        item.conflict_status,
                        item.row_index
                    ])
                
                return {
                    "format": "csv",
                    "data": output.getvalue(),
                    "filename": f"import_{run_id}.csv"
                }
            
            else:  # JSON
                return {
                    "format": "json",
                    "import_run": run.model_dump(),
                    "items": [item.model_dump() for item in items],
                    "filename": f"import_{run_id}.json"
                }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Export error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # ================================

    return router
