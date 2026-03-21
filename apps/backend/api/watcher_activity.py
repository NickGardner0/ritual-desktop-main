"""Watcher activity, rollups, exclusions, and sync endpoints."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException

from services.watcher_service import watcher_service
from .watcher_common import (
    ActivityEventCreate,
    AppExclusionRequest,
    DailyRollupRequest,
    ScreenSearchResponse,
    get_current_user,
)

router = APIRouter()
logger = logging.getLogger(__name__)

SYNC_TO_HABIT_COOLDOWN_SECONDS = max(
    0,
    int(os.getenv("RITUAL_SYNC_TO_HABIT_COOLDOWN_SECONDS", "45") or "45"),
)
_sync_to_habit_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, Any]]] = {}
_sync_to_habit_locks: Dict[Tuple[str, str], asyncio.Lock] = {}

@router.post("/devices/{device_id}/events")
async def record_activity_event(
    device_id: str,
    event: ActivityEventCreate,
    current_user = Depends(get_current_user)
):
    """
    Record an activity event from the watcher sidecar.
    """
    try:
        event_id = await watcher_service.record_activity_event(
            device_id=device_id,
            user_id=current_user["id"],
            app_bundle_id=event.app_bundle_id,
            app_name=event.app_name,
            window_title=event.window_title,
            window_owner_pid=event.window_owner_pid,
            is_afk=event.is_afk,
            ts_start=event.ts_start,
            ts_end=event.ts_end
        )
        
        if event_id is None:
            return {"status": "skipped", "reason": "excluded_app"}
        
        return {"status": "created", "event_id": event_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/events")
async def get_recent_events(
    device_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user = Depends(get_current_user)
):
    """
    Get recent activity events for debugging.
    """
    try:
        events = await watcher_service.get_recent_events(
            user_id=current_user["id"],
            device_id=device_id,
            limit=limit,
            offset=offset
        )
        return {"events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


# ============================================================
# DAILY ROLLUPS ENDPOINTS
# ============================================================

@router.post("/rollups/compute")
async def compute_daily_rollups(
    request: DailyRollupRequest,
    device_id: Optional[str] = None,
    force: bool = False,
    current_user = Depends(get_current_user)
):
    """
    Compute daily rollups for a date range.
    """
    try:
        from datetime import datetime, timedelta
        
        start = datetime.strptime(request.start_date, "%Y-%m-%d")
        end = datetime.strptime(request.end_date, "%Y-%m-%d")
        
        results = []
        current = start
        while current <= end:
            day_str = current.strftime("%Y-%m-%d")
            result = await watcher_service.compute_daily_rollup(
                user_id=current_user["id"],
                day=day_str,
                device_id=device_id,
                force_recompute=force
            )
            results.append(result)
            current += timedelta(days=1)
        
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/daily")
async def get_daily_summary(
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily activity summaries for a date range.
    Returns aggregated data by day with top apps.
    """
    try:
        summary = await watcher_service.get_daily_summary(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            device_id=device_id
        )
        return {"days": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/top-apps")
async def get_top_apps(
    start_date: str,
    end_date: str,
    limit: int = 10,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get top apps by active time for a date range.
    """
    try:
        apps = await watcher_service.get_top_apps(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            device_id=device_id
        )
        return {"apps": apps}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


# ============================================================
# APP EXCLUSIONS ENDPOINTS
# ============================================================

@router.get("/exclusions")
async def get_app_exclusions(current_user = Depends(get_current_user)):
    """
    Get all app exclusions for the current user.
    """
    try:
        exclusions = await watcher_service.get_app_exclusions(current_user["id"])
        suggested = watcher_service.get_suggested_exclusions()
        return {
            "exclusions": exclusions,
            "suggested": suggested
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.post("/exclusions")
async def add_app_exclusion(
    request: AppExclusionRequest,
    current_user = Depends(get_current_user)
):
    """
    Add an app to the exclusion list.
    """
    try:
        success = await watcher_service.add_app_exclusion(
            user_id=current_user["id"],
            bundle_id=request.bundle_id,
            app_name=request.app_name,
            reason=request.reason
        )
        return {"status": "added" if success else "already_exists"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.delete("/exclusions/{bundle_id}")
async def remove_app_exclusion(
    bundle_id: str,
    current_user = Depends(get_current_user)
):
    """
    Remove an app from the exclusion list.
    """
    try:
        success = await watcher_service.remove_app_exclusion(
            user_id=current_user["id"],
            bundle_id=bundle_id
        )
        if not success:
            raise HTTPException(status_code=404, detail="Exclusion not found")
        return {"status": "removed"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


# ============================================================
# SCREEN EVIDENCE (fast local OCR query for calendar summaries)
# ============================================================

@router.get("/screen-evidence")
async def get_screen_evidence(
    date: str,
    limit: int = 20,
    current_user=Depends(get_current_user),
):
    """
    Fast endpoint returning OCR window titles and snippets for a specific date.
    Reads directly from local memory.db — no cloud calls, sub-second response.
    """
    import sqlite3 as _sqlite3
    from services.watcher_service_local_db import get_local_memory_db_path_impl

    try:
        db_path = get_local_memory_db_path_impl()
        conn = _sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.0)
        conn.row_factory = _sqlite3.Row

        # Top window titles by frequency
        rows = conn.execute(
            """SELECT app_name, window_title, COUNT(*) as freq
               FROM ocr_frames
               WHERE date(timestamp/1000, 'unixepoch', 'localtime') = ?
                 AND app_name IS NOT NULL AND app_name != ''
               GROUP BY app_name, window_title
               ORDER BY freq DESC
               LIMIT ?""",
            (date, limit),
        ).fetchall()

        window_titles = [
            {
                "app_name": r["app_name"],
                "window_title": r["window_title"] or "",
                "frequency": r["freq"],
            }
            for r in rows
        ]

        # Representative OCR snippets — sample diverse content across the day
        # Strategy: pick up to 3 snippets per window title (best by text length),
        # with 800 chars each for richer context that lets the LLM understand WHAT was done
        snippets = conn.execute(
            """WITH ranked AS (
                 SELECT app_name, window_title,
                        substr(ocr_text, 1, 800) as snippet,
                        timestamp,
                        ROW_NUMBER() OVER (
                          PARTITION BY app_name, window_title
                          ORDER BY length(ocr_text) DESC
                        ) as rn
                 FROM ocr_frames
                 WHERE date(timestamp/1000, 'unixepoch', 'localtime') = ?
                   AND ocr_text IS NOT NULL AND length(ocr_text) > 60
                   AND window_title IS NOT NULL AND window_title != ''
               )
               SELECT app_name, window_title, snippet, timestamp
               FROM ranked
               WHERE rn <= 3
               ORDER BY timestamp ASC
               LIMIT 80""",
            (date,),
        ).fetchall()

        ocr_snippets = [
            {
                "app_name": s["app_name"],
                "window_title": s["window_title"],
                "snippet": (s["snippet"] or "").replace("\n", " ").strip()[:800],
                "time": s["timestamp"],
            }
            for s in snippets
        ]

        conn.close()

        return {
            "success": True,
            "date": date,
            "window_titles": window_titles,
            "ocr_snippets": ocr_snippets,
            "total_captures": sum(r["freq"] for r in rows),
        }
    except Exception as e:
        logger.error(f"Screen evidence error: {e}")
        return {
            "success": False,
            "date": date,
            "window_titles": [],
            "ocr_snippets": [],
            "total_captures": 0,
        }


@router.get("/git-commits")
async def get_git_commits(
    date: str,
    current_user=Depends(get_current_user),
):
    """
    Get git commits from known project directories for a specific date.
    Scans common project locations for repos and returns commit messages.
    """
    import subprocess
    from pathlib import Path

    try:
        # Scan known project directories
        home = Path.home()
        candidate_dirs = [
            home / "Desktop",
            home / "Documents",
            home / "Projects",
            home / "Code",
            home / "dev",
            home / "src",
            home / "repos",
            home / "workspace",
        ]

        commits = []
        seen_repos = set()

        for parent in candidate_dirs:
            if not parent.exists():
                continue
            # Check direct children for .git dirs (depth 1-2)
            for candidate in list(parent.iterdir())[:50]:
                if not candidate.is_dir():
                    continue
                git_dir = candidate / ".git"
                if not git_dir.exists():
                    # Check one level deeper
                    for sub in list(candidate.iterdir())[:20]:
                        if sub.is_dir() and (sub / ".git").exists():
                            git_dir = sub / ".git"
                            candidate = sub
                            break
                    else:
                        continue
                if not git_dir.exists():
                    continue

                repo_path = str(candidate.resolve())
                if repo_path in seen_repos:
                    continue
                seen_repos.add(repo_path)

                try:
                    result = subprocess.run(
                        [
                            "git", "log",
                            f"--since={date}T00:00:00",
                            f"--until={date}T23:59:59",
                            "--format=%H|%aI|%s",
                            "--no-merges",
                        ],
                        capture_output=True,
                        text=True,
                        cwd=repo_path,
                        timeout=3,
                    )
                    if result.returncode != 0 or not result.stdout.strip():
                        continue

                    repo_name = candidate.name
                    for line in result.stdout.strip().split("\n"):
                        parts = line.split("|", 2)
                        if len(parts) >= 3:
                            commits.append({
                                "repo": repo_name,
                                "hash": parts[0][:8],
                                "time": parts[1],
                                "message": parts[2],
                            })
                except Exception:
                    continue

        # Sort by time, most recent first
        commits.sort(key=lambda c: c.get("time", ""), reverse=True)

        return {
            "success": True,
            "date": date,
            "commits": commits[:30],
            "repos_scanned": len(seen_repos),
        }
    except Exception as e:
        logger.error(f"Git commits error: {e}")
        return {"success": False, "date": date, "commits": [], "repos_scanned": 0}


# ============================================================
# COMPUTER ACTIVITY STATS (for Dashboard/Analytics)
# ============================================================

@router.get("/search-screen", response_model=ScreenSearchResponse)
async def search_screen_recordings(
    query: str,
    days_back: Optional[int] = 7,
    limit: Optional[int] = 20,
    current_user = Depends(get_current_user),
):
    """
    Search local screen history (OCR frames + activity fallback) by natural language query.

    Query params:
    - query: natural language text to search for
    - days_back: lookback window in days (default: 7, max: 90)
    - limit: max results to return (default: 20, max: 50)
    """
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    try:
        result = await watcher_service.search_screen_recordings(
            user_id=current_user["id"],
            query=query,
            days_back=days_back or 7,
            limit=limit or 20,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/stats/summary")
async def get_computer_time_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get total computer time summary for a date range.
    Useful for populating a 'Computer Time' habit on the dashboard.
    
    Query params:
    - start_date: YYYY-MM-DD (defaults to today)
    - end_date: YYYY-MM-DD (defaults to today)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        # Default to today if no dates provided
        today = datetime.now().strftime("%Y-%m-%d")
        start = start_date or today
        end = end_date or today
        
        summary = await watcher_service.get_computer_time_summary(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": summary,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/stats/daily")
async def get_daily_computer_time(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily computer time for charting.
    Returns list of {day, active_hours, events_count, apps_count}.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        daily_data = await watcher_service.get_daily_computer_time(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": daily_data,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/stats/top-apps")
async def get_top_apps_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    limit: int = 10,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get top apps by usage time.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - limit: max apps to return (default: 10)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        top_apps = await watcher_service.get_top_apps(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            limit=limit,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": top_apps,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


# ============================================================
# AUTO-SYNC TO HABIT
# ============================================================

@router.post("/sync-to-habit")
async def sync_to_computer_use_habit(
    day: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = None,
    reconcile: Optional[bool] = False,
    tolerance_seconds: Optional[int] = 60,
    current_user = Depends(get_current_user)
):
    """
    Sync computer time to the user's "Computer Time" habit.
    Supports either single-day sync or range backfill.
    
    This endpoint is called hourly by the Tauri app to keep the dashboard updated.
    
    Query params:
    - day: YYYY-MM-DD (single day sync)
    - start_date: YYYY-MM-DD (range sync start)
    - end_date: YYYY-MM-DD (range sync end)
    - days_back: backfill last N days when explicit dates are not provided
    - reconcile: run post-sync projection reconciliation and auto-repair
    - tolerance_seconds: acceptable mismatch before a day is repaired
    """
    try:
        using_range_params = bool(start_date or end_date or days_back)
        user_id = current_user["id"]

        if day and using_range_params:
            raise HTTPException(
                status_code=400,
                detail="Provide either 'day' OR range params ('start_date'/'end_date'/'days_back'), not both."
            )

        if using_range_params:
            cache_scope = (
                f"range:{start_date or ''}:{end_date or ''}:{days_back or 7}:"
                f"{int(bool(reconcile))}:{tolerance_seconds or 60}"
            )
        else:
            effective_day = day or datetime.now().strftime("%Y-%m-%d")
            cache_scope = f"day:{effective_day}"

        cache_key = (user_id, cache_scope)
        now_mono = time.monotonic()
        cached = _sync_to_habit_cache.get(cache_key)
        if (
            SYNC_TO_HABIT_COOLDOWN_SECONDS > 0
            and cached
            and (now_mono - cached[0]) < SYNC_TO_HABIT_COOLDOWN_SECONDS
        ):
            cached_payload = dict(cached[1])
            cached_payload["cached"] = True
            return cached_payload

        lock = _sync_to_habit_locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            now_mono = time.monotonic()
            cached = _sync_to_habit_cache.get(cache_key)
            if (
                SYNC_TO_HABIT_COOLDOWN_SECONDS > 0
                and cached
                and (now_mono - cached[0]) < SYNC_TO_HABIT_COOLDOWN_SECONDS
            ):
                cached_payload = dict(cached[1])
                cached_payload["cached"] = True
                return cached_payload

            if using_range_params:
                result = await watcher_service.sync_to_computer_use_habit_range(
                    user_id=user_id,
                    start_date=start_date,
                    end_date=end_date,
                    days_back=days_back or 7,
                    auto_reconcile=bool(reconcile),
                    tolerance_seconds=tolerance_seconds or 60,
                )
            else:
                result = await watcher_service.sync_to_computer_use_habit(
                    user_id=user_id,
                    day=day
                )

            if result.get("success"):
                _sync_to_habit_cache[cache_key] = (time.monotonic(), dict(result))
                if using_range_params:
                    logger.info(
                        f"✅ Synced computer time range: "
                        f"{result.get('synced_days', 0)}/{result.get('requested_days', 0)} days "
                        f"({result.get('start_date')} to {result.get('end_date')})"
                    )
                else:
                    logger.info(
                        f"✅ Synced computer time to habit: "
                        f"{result.get('amount', 0)} {result.get('unit', 'Hours')} for {result.get('day')}"
                    )
            else:
                logger.warning(f"⚠️ Sync failed: {result.get('error')}")

            return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.post("/reconcile-habit-projection")
async def reconcile_computer_use_habit_projection(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 14,
    auto_repair: Optional[bool] = True,
    tolerance_seconds: Optional[int] = 60,
    current_user = Depends(get_current_user)
):
    """
    Reconcile Computer Time projection rows in habit_logs against local watcher data.

    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start/end when omitted
    - auto_repair: when true, re-sync mismatch days automatically
    - tolerance_seconds: acceptable delta before a day is considered mismatched
    """
    try:
        result = await watcher_service.reconcile_computer_use_projection(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            days_back=days_back or 14,
            auto_repair=bool(auto_repair),
            tolerance_seconds=tolerance_seconds or 60,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/habit-projection-parity")
async def get_computer_use_habit_projection_parity(
    start_date: str,
    end_date: str,
    tolerance_seconds: Optional[int] = 60,
    current_user = Depends(get_current_user)
):
    """
    Validate parity between local Computer Activity totals and projected Computer Time habit totals.

    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - tolerance_seconds: allowed duration delta in seconds before parity fails
    """
    try:
        result = await watcher_service.validate_computer_use_range_parity(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            tolerance_seconds=tolerance_seconds or 60,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")
