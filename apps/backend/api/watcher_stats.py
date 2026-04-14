"""Watcher analytics and breakdown endpoints.

These routes are the product-facing computer activity read surface for both
desktop and web. They should remain the canonical UI API for watcher/computer
activity, with the service layer deciding whether the read is satisfied from
the per-user activity DB/Turso path, Tinybird fallback, or legacy local data.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from database.connection import force_local_replica_sync
from services.watcher_service import watcher_service
from .watcher_common import get_current_user

router = APIRouter()


def _resolve_date_range(
    *,
    start_date: Optional[str],
    end_date: Optional[str],
    days_back: Optional[int],
) -> tuple[str, str]:
    today = datetime.now()
    if start_date and end_date:
        return start_date, end_date

    resolved_end = today.strftime("%Y-%m-%d")
    resolved_start = (today - timedelta(days=days_back or 30)).strftime("%Y-%m-%d")
    return resolved_start, resolved_end


async def _maybe_force_fresh_read(request: Request):
    if request.headers.get("x-ritual-force-fresh") == "1":
        await force_local_replica_sync()


@router.get("/stats/summary")
async def get_computer_time_summary(
    request: Request,
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
        await _maybe_force_fresh_read(request)
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
    request: Request,
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
        await _maybe_force_fresh_read(request)
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


@router.get("/stats/aggregate")
async def get_computer_activity_aggregate(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    limit: int = 10,
    device_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    """Return summary, daily totals, top apps, and top domains for a single range."""
    try:
        await _maybe_force_fresh_read(request)
        start, end = _resolve_date_range(
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
        )
        snapshot = await watcher_service.get_computer_activity_snapshot(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            limit=limit,
            device_id=device_id,
        )
        return {
            "success": True,
            "data": snapshot,
            "start_date": start,
            "end_date": end,
        }
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/stats/top-apps")
async def get_top_apps_stats(
    request: Request,
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
        await _maybe_force_fresh_read(request)
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
@router.get("/stats/top-domains")
async def get_top_domains(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    limit: int = 10,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get top domains by usage time (browser tracking).
    
    Returns domains like "github.com", "twitter.com" with time spent.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - limit: max domains to return (default: 10)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        await _maybe_force_fresh_read(request)
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        domains = await watcher_service.get_top_domains(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            limit=limit,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": domains,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/stats/browser-summary")
async def get_browser_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get overall browser usage summary including total time and top domains.
    
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
        
        summary = await watcher_service.get_browser_summary(
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


@router.get("/stats/domain/{domain}")
async def get_domain_details(
    domain: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily breakdown for a specific domain.
    
    Path params:
    - domain: The domain to get details for (e.g., "github.com")
    
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
        
        breakdown = await watcher_service.get_domain_daily_breakdown(
            user_id=current_user["id"],
            domain=domain,
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        # Calculate totals
        total_ms = sum(d["active_ms"] for d in breakdown)
        
        return {
            "success": True,
            "domain": domain,
            "data": breakdown,
            "total_ms": total_ms,
            "total_hours": round(total_ms / (1000 * 60 * 60), 2),
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


# ============================================================
# USAGE BREAKDOWN ENDPOINTS
# ============================================================

@router.get("/breakdown")
async def get_usage_breakdown(
    request: Request,
    kind: str,
    key: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily usage breakdown for a specific app or website.
    
    Query params:
    - kind: "app" or "website"
    - key: app bundle id or domain
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - device_id: optional device filter (unused for local DB)
    """
    if kind not in ["app", "website"]:
        raise HTTPException(status_code=400, detail="Invalid kind, must be 'app' or 'website'")
    
    if not key:
        raise HTTPException(status_code=400, detail="Missing key")
    
    try:
        await _maybe_force_fresh_read(request)
        breakdown = await watcher_service.get_usage_daily_breakdown(
            user_id=current_user["id"],
            kind=kind,
            key=key,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id
        )
        
        total_ms = sum(d.get("active_ms", 0) for d in breakdown)
        
        return {
            "success": True,
            "kind": kind,
            "key": key,
            "data": breakdown,
            "total_ms": total_ms,
            "total_hours": round(total_ms / (1000 * 60 * 60), 2),
            "start_date": start_date,
            "end_date": end_date
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


# ============================================================
# AFK ANALYTICS ENDPOINTS (V2)
# ============================================================

@router.get("/stats/afk")
async def get_afk_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 7,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get AFK (Away From Keyboard) vs active time summary.
    
    Returns breakdown of active vs idle time.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 7)
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
        
        summary = await watcher_service.get_afk_summary(
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
