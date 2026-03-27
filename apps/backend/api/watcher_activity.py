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
    Fast endpoint returning screen evidence for a specific date.
    Tries Turso replica first (production), then activity.db, then memory.db.
    No external cloud calls, sub-second response.
    """
    import sqlite3 as _sqlite3
    from services.watcher_service_local_db import (
        get_local_memory_db_path_impl,
        get_local_activity_db_path_impl,
        open_activity_connection_for_user,
    )

    try:
        has_context_snapshots = False
        conn = None
        should_close_conn = False
        window_limit = max(8, min(limit, 30))
        snippet_limit = max(80, min(limit, 240))
        activity_db_path = get_local_activity_db_path_impl()

        async with open_activity_connection_for_user(current_user["id"], write=False) as user_activity_conn:
            if user_activity_conn is not None:
                try:
                    check = user_activity_conn.execute(
                        "SELECT COUNT(*) FROM context_snapshots WHERE date(ts/1000, 'unixepoch', 'localtime') = ?",
                        (date,),
                    ).fetchone()
                    if (check[0] or 0) > 0:
                        has_context_snapshots = True
                        conn = user_activity_conn
                except Exception:
                    conn = None

            if conn is None:
                try:
                    activity_conn = _sqlite3.connect(
                        f"file:{activity_db_path}?mode=ro", uri=True, timeout=2.0
                    )
                    activity_conn.row_factory = _sqlite3.Row
                    check = activity_conn.execute(
                        "SELECT COUNT(*) FROM context_snapshots WHERE date(ts/1000, 'unixepoch', 'localtime') = ?",
                        (date,),
                    ).fetchone()
                    if (check[0] or 0) > 0:
                        has_context_snapshots = True
                        conn = activity_conn
                        should_close_conn = True
                    else:
                        activity_conn.close()
                except Exception:
                    pass

            if conn is None:
                db_path = get_local_memory_db_path_impl()
                conn = _sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.0)
                conn.row_factory = _sqlite3.Row
                should_close_conn = True
                try:
                    check = conn.execute(
                        "SELECT COUNT(*) FROM context_snapshots WHERE date(ts/1000, 'unixepoch', 'localtime') = ?",
                        (date,),
                    ).fetchone()
                    has_context_snapshots = (check[0] or 0) > 0
                except Exception:
                    pass

            if has_context_snapshots:
                try:
                    if user_activity_conn is not None and conn is user_activity_conn:
                        from services.memory_semantic_summary_service import process_pending_summaries_conn

                        async with open_activity_connection_for_user(current_user["id"], write=True) as write_conn:
                            if write_conn is not None:
                                await asyncio.to_thread(process_pending_summaries_conn, write_conn, 30)
                    else:
                        from services.memory_semantic_summary_service import process_pending_summaries

                        _jit_db_path = activity_db_path if activity_db_path else get_local_activity_db_path_impl()
                        await asyncio.to_thread(process_pending_summaries, _jit_db_path, 30)
                except Exception:
                    pass

                rows = conn.execute(
                    """SELECT app_name, window_title, COUNT(*) as freq
                       FROM context_snapshots
                       WHERE date(ts/1000, 'unixepoch', 'localtime') = ?
                         AND app_name IS NOT NULL AND app_name != ''
                       GROUP BY app_name, window_title
                       ORDER BY freq DESC
                       LIMIT ?""",
                    (date, window_limit),
                ).fetchall()

                has_semantic = False
                try:
                    conn.execute("SELECT semantic_summary FROM context_snapshots LIMIT 0")
                    has_semantic = True
                except Exception:
                    pass

                semantic_col = "semantic_summary," if has_semantic else "'' as semantic_summary,"
                snippets = conn.execute(
                    f"""WITH ordered AS (
                         SELECT app_name, window_title, document_path,
                                {semantic_col}
                                substr(COALESCE(visible_text_raw, visible_text_norm, ''), 1, 800) as snippet,
                                ts as timestamp,
                                ax_richness_score,
                                LAG(ts) OVER (PARTITION BY app_name, window_title ORDER BY ts) as prev_ts
                         FROM context_snapshots
                         WHERE date(ts/1000, 'unixepoch', 'localtime') = ?
                           AND length(COALESCE(visible_text_raw, visible_text_norm, '')) > 60
                           AND window_title IS NOT NULL AND window_title != ''
                       )
                       SELECT app_name, window_title, document_path, semantic_summary, snippet, timestamp, ax_richness_score
                       FROM ordered
                       WHERE prev_ts IS NULL OR (timestamp - prev_ts) > 180000
                       ORDER BY timestamp ASC
                       LIMIT ?""",
                    (date, snippet_limit),
                ).fetchall()

                ocr_snippets = [
                    {
                        "app_name": s["app_name"],
                        "window_title": s["window_title"],
                        "document_path": s["document_path"] or "",
                        "semantic_summary": s["semantic_summary"] or "",
                        "snippet": (s["snippet"] or "").replace("\n", " ").strip()[:800],
                        "time": s["timestamp"],
                        "ax_richness_score": round(s["ax_richness_score"] or 0.0, 3),
                    }
                    for s in snippets
                ]
            else:
                rows = conn.execute(
                    """SELECT app_name, window_title, COUNT(*) as freq
                       FROM ocr_frames
                       WHERE date(timestamp/1000, 'unixepoch', 'localtime') = ?
                         AND app_name IS NOT NULL AND app_name != ''
                       GROUP BY app_name, window_title
                       ORDER BY freq DESC
                       LIMIT ?""",
                    (date, window_limit),
                ).fetchall()

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
                       LIMIT ?""",
                    (date, snippet_limit),
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

            window_titles = [
                {
                    "app_name": r["app_name"],
                    "window_title": r["window_title"] or "",
                    "frequency": r["freq"],
                }
                for r in rows
            ]

            if should_close_conn and conn is not None:
                conn.close()

            return {
                "success": True,
                "date": date,
                "window_titles": window_titles,
                "ocr_snippets": ocr_snippets,
                "total_captures": sum(r["freq"] for r in rows),
            }
    except Exception as e:
        logger.error(f"Screen evidence local DB error: {e}")
        # --- Fallback: Turbopuffer cloud when local DB is unavailable ---
        # This enables the calendar summary to work from Railway (production)
        # where activity.db doesn't exist on the server filesystem.
        try:
            return await _screen_evidence_from_turbopuffer(date, limit, current_user)
        except Exception as cloud_err:
            logger.error(f"Screen evidence Turbopuffer fallback also failed: {cloud_err}")
            return {
                "success": False,
                "date": date,
                "window_titles": [],
                "ocr_snippets": [],
                "total_captures": 0,
            }


async def _screen_evidence_from_turbopuffer(
    date: str,
    limit: int,
    current_user: dict,
) -> dict:
    """Fallback: fetch screen evidence from Turbopuffer when local DB is unavailable."""
    from datetime import datetime as _dt, timezone as _tz
    from services.memory_turbopuffer_service import TurbopufferService

    tp = TurbopufferService()
    if not tp.configured:
        return {
            "success": False,
            "date": date,
            "window_titles": [],
            "ocr_snippets": [],
            "total_captures": 0,
            "source": "turbopuffer_not_configured",
        }

    # Convert date string to epoch ms range
    day_start = _dt.strptime(date, "%Y-%m-%d").replace(tzinfo=_tz.utc)
    start_ms = int(day_start.timestamp() * 1000)
    end_ms = start_ms + 86_400_000  # +24 hours

    user_id = current_user.get("id", "unknown")
    namespace = tp.namespace_for_user(user_id)

    import httpx
    try:
        async with httpx.AsyncClient(timeout=tp.timeout_seconds) as client:
            resp = await client.post(
                f"{tp.base_url}/v2/namespaces/{namespace}/query",
                headers=tp._headers(),
                json={
                    "queries": [
                        {
                            "top_k": min(limit * 4, 80),
                            "rank_by": ["contextual_text_compact", "BM25", date],
                            "filters": {
                                "chunk_start_ts": [["Gte", start_ms]],
                                "chunk_end_ts": [["Lte", end_ms]],
                                "active": [["Eq", 1]],
                            },
                            "include_attributes": [
                                "app_name", "window_title", "document_title",
                                "document_path", "browser_domain",
                                "raw_visible_text", "contextual_retrieval_text",
                                "chunk_start_ts", "chunk_end_ts",
                                "ax_richness_score", "capture_quality",
                            ],
                        }
                    ]
                },
            )
        if resp.status_code >= 400:
            logger.warning(f"Turbopuffer screen-evidence query failed: {resp.status_code}")
            return {
                "success": False, "date": date,
                "window_titles": [], "ocr_snippets": [], "total_captures": 0,
            }

        data = resp.json()
        results = []
        for query_result in data if isinstance(data, list) else [data]:
            for row in query_result.get("data", []):
                attrs = row.get("attributes", {})
                results.append(attrs)

        # Build window_titles (app frequency)
        app_freq: dict = {}
        for r in results:
            key = (r.get("app_name", ""), r.get("window_title", ""))
            app_freq[key] = app_freq.get(key, 0) + 1
        window_titles = [
            {"app_name": k[0], "window_title": k[1], "frequency": v}
            for k, v in sorted(app_freq.items(), key=lambda x: -x[1])
        ][:limit]

        # Build ocr_snippets (chronological)
        results.sort(key=lambda r: int(r.get("chunk_start_ts") or 0))
        ocr_snippets = [
            {
                "app_name": r.get("app_name", ""),
                "window_title": r.get("window_title", ""),
                "document_path": r.get("document_path", ""),
                "snippet": str(r.get("raw_visible_text") or r.get("contextual_retrieval_text") or "")
                    .replace("\n", " ").strip()[:800],
                "time": int(r.get("chunk_start_ts") or 0),
                "ax_richness_score": round(float(r.get("ax_richness_score") or 0.0), 3),
            }
            for r in results
            if len(str(r.get("raw_visible_text") or r.get("contextual_retrieval_text") or "")) > 30
        ][:80]

        return {
            "success": True,
            "date": date,
            "window_titles": window_titles,
            "ocr_snippets": ocr_snippets,
            "total_captures": len(results),
            "source": "turbopuffer",
        }
    except Exception as exc:
        raise exc


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


# ============================================================
# SEMANTIC SUMMARY PROCESSING
# ============================================================

@router.post("/process-semantic-summaries")
async def process_semantic_summaries(
    batch_size: int = 20,
    current_user=Depends(get_current_user),
):
    """
    Process a batch of context snapshots that need semantic summaries.
    Call periodically to backfill summaries for captured screen data.
    Uses activity.db where the watcher writes context_snapshots.
    """
    from services.memory_semantic_summary_service import process_pending_summaries_conn
    from services.watcher_service_local_db import open_activity_connection_for_user

    try:
        async with open_activity_connection_for_user(current_user["id"], write=True) as conn:
            if conn is None:
                raise RuntimeError("No activity database is available for this user")
            result = await asyncio.to_thread(
                process_pending_summaries_conn,
                conn,
                min(batch_size, 50),
            )
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Semantic summary processing error: {e}")
        return {"success": False, "error": str(e)}
