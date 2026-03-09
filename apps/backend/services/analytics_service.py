"""
Analytics Service - Single source of truth for all habit statistics calculations

This service handles:
- Habit statistics (total, average per day, min, max, variance)
- Daily breakdowns
- Correlation analysis between habits
- Trend calculations

All calculations follow the rule: Average = Total / Days with Data (not per entry)
"""

import math
import logging
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any, Tuple
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB

logger = logging.getLogger(__name__)


class AnalyticsService:
    """
    Centralized analytics calculations for habit data.
    Single source of truth - used by Dashboard, Analytics page, and AI Chat.
    """

    def _completed_log_filter(self):
        """Include completed logs and legacy rows where status is null."""
        return or_(HabitLogDB.status == "completed", HabitLogDB.status.is_(None))

    def _use_max_duration_per_day(self, habit: HabitDB) -> bool:
        """
        Sleep-like habits should use MAX duration per day.
        Most duration habits (e.g. Computer Use, Coding) should SUM sessions.
        """
        habit_name = (habit.name or "").strip().lower()
        category = (habit.category or "").strip().lower()
        metric_type = (habit.metric_type or "").strip().lower()
        integration_source = (habit.integration_source or "").strip().lower()

        if metric_type in {"sleep", "sleep_session", "sleep_duration", "in_bed"}:
            return True

        # Preserve legacy sleep behavior for common wearable sleep habits.
        if "sleep" in habit_name:
            return True
        if "sleep" in category and integration_source in {"whoop", "oura", "apple_health", "fitbit", "garmin"}:
            return True

        return False
    
    # ====================
    # CORE STATISTICS
    # ====================
    
    async def get_habit_stats(
        self,
        user_id: str,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 30
    ) -> Dict[str, Any]:
        """
        Get comprehensive statistics for one or all habits.
        
        Returns per habit:
        - total: Sum of all values
        - average: Total / Days with data (NOT per entry)
        - min, max: Min/max daily values
        - variance, std_dev: Statistical spread
        - days_with_data: Unique days tracked
        - total_entries: Raw log count
        """
        async with get_db_session() as session:
            # Calculate date range
            if end_date:
                end_dt = datetime.strptime(end_date, '%Y-%m-%d').date()
            else:
                end_dt = datetime.utcnow().date()
                
            if start_date:
                start_dt = datetime.strptime(start_date, '%Y-%m-%d').date()
            else:
                start_dt = end_dt - timedelta(days=days_back)
            
            # Get habits
            habits_query = select(HabitDB).where(HabitDB.user_id == user_id)
            if habit_id:
                habits_query = habits_query.where(HabitDB.id == habit_id)
            
            habits_result = await session.execute(habits_query)
            habits = habits_result.scalars().all()
            
            # Filter by name if provided
            if habit_name and not habit_id:
                habits = self._find_habits_by_name(habits, habit_name)
            
            if not habits:
                return {
                    "success": False,
                    "error": f"No habit found matching '{habit_name or habit_id}'",
                    "available_habits": await self._get_habit_names(session, user_id)
                }
            
            # Get logs for date range
            # Note: HabitLogDB doesn't have user_id - we filter by habit_ids which are already user-scoped
            habit_ids = [h.id for h in habits]
            logs_query = select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id.in_(habit_ids),
                    self._completed_log_filter(),
                    HabitLogDB.date >= str(start_dt),
                    HabitLogDB.date <= str(end_dt)
                )
            )
            logs_result = await session.execute(logs_query)
            all_logs = logs_result.scalars().all()
            
            # Calculate stats per habit
            stats = []
            for habit in habits:
                habit_logs = [l for l in all_logs if l.habit_id == habit.id]
                habit_stats = self._calculate_habit_stats(habit, habit_logs)
                stats.append(habit_stats)
            
            return {
                "success": True,
                "date_range": {
                    "start": str(start_dt),
                    "end": str(end_dt),
                    "days": (end_dt - start_dt).days + 1
                },
                "habits": stats
            }
    
    async def get_daily_breakdown(
        self,
        user_id: str,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 30,
        timezone: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get day-by-day breakdown for a habit.
        Returns list of {date, value, unit} sorted chronologically.
        
        Args:
            timezone: User's timezone (e.g., 'America/New_York') for time conversion
        """
        async with get_db_session() as session:
            # Use explicit dates if provided, otherwise fall back to days_back
            if start_date and end_date:
                start_dt = date.fromisoformat(start_date)
                end_dt = date.fromisoformat(end_date)
            else:
                end_dt = datetime.utcnow().date()
                start_dt = end_dt - timedelta(days=days_back)
            
            # Find habit
            habit = await self._find_habit(session, user_id, habit_id, habit_name)
            if not habit:
                return {
                    "success": False,
                    "error": f"No habit found matching '{habit_name or habit_id}'",
                    "available_habits": await self._get_habit_names(session, user_id)
                }
            
            # Get logs (habit is already user-scoped, so no need to filter by user_id)
            query_start = start_dt - timedelta(days=1) if timezone else start_dt
            query_end = end_dt + timedelta(days=1) if timezone else end_dt

            logs_query = select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id == habit.id,
                    self._completed_log_filter(),
                    HabitLogDB.date >= str(query_start),
                    HabitLogDB.date <= str(query_end)
                )
            )
            logs_result = await session.execute(logs_query)
            logs = logs_result.scalars().all()
            
            # Aggregate by date
            daily_data = self._aggregate_by_date(habit, logs)
            
            # Set up timezone conversion if provided
            user_tz = None
            if timezone:
                try:
                    from zoneinfo import ZoneInfo
                    user_tz = ZoneInfo(timezone)
                except:
                    try:
                        import pytz
                        user_tz = pytz.timezone(timezone)
                    except:
                        pass
            
            # Group individual log entries by LOCAL date (after timezone conversion)
            # This is critical - we must use the local date, not the UTC date
            logs_by_local_date: Dict[str, List[Dict[str, Any]]] = {}
            local_date_mapping: Dict[str, str] = {}  # Maps UTC date to local date
            
            for log in logs:
                log_time = None
                local_date = log.date  # Default to stored date
                
                if log.completed_at:
                    try:
                        from datetime import datetime as dt
                        # Parse the ISO datetime
                        completed_dt = dt.fromisoformat(log.completed_at.replace('Z', '+00:00'))
                        
                        # Convert to user's timezone if available
                        if user_tz:
                            try:
                                from zoneinfo import ZoneInfo
                                utc = ZoneInfo('UTC')
                                if completed_dt.tzinfo is None:
                                    completed_dt = completed_dt.replace(tzinfo=utc)
                                completed_dt = completed_dt.astimezone(user_tz)
                            except:
                                try:
                                    import pytz
                                    utc = pytz.UTC
                                    if completed_dt.tzinfo is None:
                                        completed_dt = utc.localize(completed_dt)
                                    completed_dt = completed_dt.astimezone(user_tz)
                                except:
                                    pass
                        
                        # Extract the LOCAL date after timezone conversion
                        local_date = completed_dt.strftime('%Y-%m-%d')
                        
                        # Format as 12-hour time with AM/PM (e.g., "5:32pm")
                        hour = completed_dt.hour
                        minute = completed_dt.minute
                        period = "am" if hour < 12 else "pm"
                        display_hour = hour % 12
                        if display_hour == 0:
                            display_hour = 12
                        log_time = f"{display_hour}:{minute:02d}{period}"
                    except Exception as e:
                        logger.info(f"Time parsing error: {e}")
                        pass
                
                # Keep only requested local date range when timezone conversion is applied.
                try:
                    local_date_obj = date.fromisoformat(local_date)
                    if local_date_obj < start_dt or local_date_obj > end_dt:
                        continue
                except Exception:
                    continue

                # Group by LOCAL date
                if local_date not in logs_by_local_date:
                    logs_by_local_date[local_date] = []
                
                # Parse metadata for sleep start/end times
                sleep_start = None
                sleep_end = None
                if log.log_metadata:
                    try:
                        import json
                        metadata = json.loads(log.log_metadata) if isinstance(log.log_metadata, str) else log.log_metadata
                        sleep_start_raw = metadata.get('sleep_onset')
                        sleep_end_raw = metadata.get('sleep_end')
                        
                        # Convert sleep times to user's timezone if available
                        if sleep_start_raw and user_tz:
                            try:
                                from datetime import datetime as dt
                                sleep_start_dt = dt.fromisoformat(sleep_start_raw.replace('Z', '+00:00'))
                                if sleep_start_dt.tzinfo is None:
                                    from zoneinfo import ZoneInfo
                                    sleep_start_dt = sleep_start_dt.replace(tzinfo=ZoneInfo('UTC'))
                                sleep_start_dt = sleep_start_dt.astimezone(user_tz)
                                hour = sleep_start_dt.hour
                                minute = sleep_start_dt.minute
                                period = "am" if hour < 12 else "pm"
                                display_hour = hour % 12 or 12
                                sleep_start = f"{display_hour}:{minute:02d}{period}"
                            except:
                                sleep_start = sleep_start_raw
                        elif sleep_start_raw:
                            sleep_start = sleep_start_raw
                            
                        if sleep_end_raw and user_tz:
                            try:
                                from datetime import datetime as dt
                                sleep_end_dt = dt.fromisoformat(sleep_end_raw.replace('Z', '+00:00'))
                                if sleep_end_dt.tzinfo is None:
                                    from zoneinfo import ZoneInfo
                                    sleep_end_dt = sleep_end_dt.replace(tzinfo=ZoneInfo('UTC'))
                                sleep_end_dt = sleep_end_dt.astimezone(user_tz)
                                hour = sleep_end_dt.hour
                                minute = sleep_end_dt.minute
                                period = "am" if hour < 12 else "pm"
                                display_hour = hour % 12 or 12
                                sleep_end = f"{display_hour}:{minute:02d}{period}"
                            except:
                                sleep_end = sleep_end_raw
                        elif sleep_end_raw:
                            sleep_end = sleep_end_raw
                    except:
                        pass
                
                logs_by_local_date[local_date].append({
                    "time": log_time,
                    "amount": log.amount,
                    "duration_seconds": log.duration,
                    "notes": log.notes,
                    "sleep_start": sleep_start,
                    "sleep_end": sleep_end,
                })
                
                # Track mapping from UTC date to local date
                local_date_mapping[log.date] = local_date
            
            # Sort logs within each day by time
            for date_key in logs_by_local_date:
                logs_by_local_date[date_key].sort(key=lambda x: x["time"] or "00:00")
            
            # Reaggregate by LOCAL date instead of UTC date
            # This ensures dates match the timezone-converted times
            local_daily_data: Dict[str, Dict[str, Any]] = {}
            use_max_duration = self._use_max_duration_per_day(habit)
            for local_date, entries in logs_by_local_date.items():
                if local_date not in local_daily_data:
                    local_daily_data[local_date] = {
                        "duration_seconds": 0,
                        "amount": 0,
                        "count": 0,
                        "value": 0
                    }
                
                for entry in entries:
                    if entry.get("duration_seconds") and entry["duration_seconds"] > 0:
                        if use_max_duration:
                            local_daily_data[local_date]["duration_seconds"] = max(
                                local_daily_data[local_date]["duration_seconds"],
                                entry["duration_seconds"]
                            )
                        else:
                            local_daily_data[local_date]["duration_seconds"] += entry["duration_seconds"]
                    if entry.get("amount") is not None:
                        local_daily_data[local_date]["amount"] += entry["amount"]
                    local_daily_data[local_date]["count"] += 1
                
                # Calculate value based on habit type
                unit = (habit.unit_type or "").lower()
                data = local_daily_data[local_date]
                if "hour" in unit:
                    data["value"] = data["duration_seconds"] / 3600 if data["duration_seconds"] > 0 else data["amount"]
                elif "minute" in unit:
                    data["value"] = data["duration_seconds"] / 60 if data["duration_seconds"] > 0 else data["amount"]
                elif data["amount"] > 0:
                    data["value"] = data["amount"]
                elif data["duration_seconds"] > 0:
                    data["value"] = data["duration_seconds"] / 3600
                else:
                    data["value"] = data["count"]
            
            # Sort chronologically by local date
            sorted_days = sorted(local_daily_data.items(), key=lambda x: x[0])
            
            # Calculate stats
            values = [v["value"] for v in local_daily_data.values()]
            total = sum(values) if values else 0
            avg = total / len(values) if values else 0
            
            # Determine if this is a duration-based habit (hours) or amount-based
            is_duration = any(d.get("duration_seconds", 0) > 0 for d in local_daily_data.values())
            
            return {
                "success": True,
                "habit": {
                    "id": habit.id,
                    "name": habit.name,
                    "unit": habit.unit_type or "sessions",
                    "category": habit.category
                },
                "date_range": {
                    "start": str(start_dt),
                    "end": str(end_dt),
                },
                "days_with_data": len(local_daily_data),
                "total": round(total, 2),
                "average_per_day": round(avg, 2),
                "data": [
                    {
                        "date": local_date_str,
                        "total_hours": round(data.get("duration_seconds", 0) / 3600, 2) if is_duration else None,
                        "total_duration_seconds": data.get("duration_seconds", 0) if is_duration else None,
                        "total_amount": data.get("amount", 0) if not is_duration else None,
                        "value": round(data["value"], 2),
                        "unit": habit.unit_type or "sessions",
                        "entries": logs_by_local_date.get(local_date_str, [])  # Individual log entries with times
                    }
                    for local_date_str, data in sorted_days
                ]
            }
    
    async def get_correlation(
        self,
        user_id: str,
        habit1_id: Optional[str] = None,
        habit1_name: Optional[str] = None,
        habit2_id: Optional[str] = None,
        habit2_name: Optional[str] = None,
        days_back: int = 30
    ) -> Dict[str, Any]:
        """
        Calculate Pearson correlation coefficient between two habits.
        Returns correlation value (-1 to 1) and interpretation.
        """
        async with get_db_session() as session:
            end_dt = datetime.utcnow().date()
            start_dt = end_dt - timedelta(days=days_back)
            
            # Find both habits
            habit1 = await self._find_habit(session, user_id, habit1_id, habit1_name)
            habit2 = await self._find_habit(session, user_id, habit2_id, habit2_name)
            
            if not habit1 or not habit2:
                missing = []
                if not habit1:
                    missing.append(habit1_name or habit1_id)
                if not habit2:
                    missing.append(habit2_name or habit2_id)
                return {
                    "success": False,
                    "error": f"Habits not found: {', '.join(missing)}",
                    "available_habits": await self._get_habit_names(session, user_id)
                }
            
            # Get logs for both habits (habits are already user-scoped)
            logs_query = select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id.in_([habit1.id, habit2.id]),
                    self._completed_log_filter(),
                    HabitLogDB.date >= str(start_dt),
                    HabitLogDB.date <= str(end_dt)
                )
            )
            logs_result = await session.execute(logs_query)
            all_logs = logs_result.scalars().all()
            
            # Aggregate by date for each habit
            habit1_logs = [l for l in all_logs if l.habit_id == habit1.id]
            habit2_logs = [l for l in all_logs if l.habit_id == habit2.id]
            
            daily1 = self._aggregate_by_date(habit1, habit1_logs)
            daily2 = self._aggregate_by_date(habit2, habit2_logs)
            
            # Find overlapping dates
            overlapping_dates = set(daily1.keys()) & set(daily2.keys())
            
            if len(overlapping_dates) < 3:
                return {
                    "success": False,
                    "error": f"Not enough overlapping data. Need at least 3 days, found {len(overlapping_dates)}.",
                    "habit1_days": len(daily1),
                    "habit2_days": len(daily2),
                    "overlapping_days": len(overlapping_dates)
                }
            
            # Calculate Pearson correlation
            x = [daily1[d]["value"] for d in overlapping_dates]
            y = [daily2[d]["value"] for d in overlapping_dates]
            
            correlation, strength, direction = self._calculate_pearson_correlation(x, y)
            
            return {
                "success": True,
                "habits": {
                    "habit1": {"id": habit1.id, "name": habit1.name, "unit": habit1.unit_type},
                    "habit2": {"id": habit2.id, "name": habit2.name, "unit": habit2.unit_type}
                },
                "date_range": {
                    "start": str(start_dt),
                    "end": str(end_dt)
                },
                "correlation": {
                    "coefficient": round(correlation, 3),
                    "strength": strength,
                    "direction": direction,
                    "interpretation": self._interpret_correlation(correlation, habit1.name, habit2.name)
                },
                "data_points": {
                    "habit1_days": len(daily1),
                    "habit2_days": len(daily2),
                    "overlapping_days": len(overlapping_dates)
                },
                "habit1_stats": {
                    "mean": round(sum(x) / len(x), 2),
                    "total": round(sum(x), 2)
                },
                "habit2_stats": {
                    "mean": round(sum(y) / len(y), 2),
                    "total": round(sum(y), 2)
                }
            }
    
    async def list_habits(self, user_id: str) -> Dict[str, Any]:
        """
        List all habits for a user with basic info.
        """
        async with get_db_session() as session:
            habits_result = await session.execute(
                select(HabitDB).where(HabitDB.user_id == user_id)
            )
            habits = habits_result.scalars().all()
            
            by_category = defaultdict(list)
            for h in habits:
                category = h.category or "Uncategorized"
                by_category[category].append({
                    "id": h.id,
                    "name": h.name,
                    "unit": h.unit_type,
                    "integration_source": h.integration_source
                })
            
            return {
                "success": True,
                "total_habits": len(habits),
                "by_category": dict(by_category),
                "habits": [
                    {
                        "id": h.id,
                        "name": h.name,
                        "category": h.category,
                        "unit": h.unit_type,
                        "integration_source": h.integration_source
                    }
                    for h in habits
                ]
            }
    
    # ====================
    # PHASE 3: PROACTIVE INSIGHTS
    # ====================
    
    async def get_habit_trends(
        self,
        user_id: str,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        window_days: int = 30
    ) -> Dict[str, Any]:
        """
        Compare current period vs previous period to identify trends.
        
        Returns per habit:
        - current_avg, previous_avg (per day with data)
        - absolute_change, percent_change
        - direction: up | down | flat
        - confidence: high | medium | low (based on data availability)
        
        Confidence rules:
        - high: both periods have >= 10 days with data
        - medium: both periods have >= 5 days with data
        - low: otherwise
        """
        async with get_db_session() as session:
            # Calculate date ranges
            end_dt = datetime.utcnow().date()
            current_start = end_dt - timedelta(days=window_days)
            previous_end = current_start - timedelta(days=1)
            previous_start = previous_end - timedelta(days=window_days)
            
            # Get habits
            habits_query = select(HabitDB).where(HabitDB.user_id == user_id)
            if habit_id:
                habits_query = habits_query.where(HabitDB.id == habit_id)
            
            habits_result = await session.execute(habits_query)
            habits = habits_result.scalars().all()
            
            # Filter by name if provided
            if habit_name and not habit_id:
                habits = self._find_habits_by_name(habits, habit_name)
            
            if not habits:
                return {
                    "success": False,
                    "error": f"No habit found matching '{habit_name or habit_id}'",
                    "available_habits": await self._get_habit_names(session, user_id)
                }
            
            # Get logs for both periods
            habit_ids = [h.id for h in habits]
            logs_query = select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id.in_(habit_ids),
                    self._completed_log_filter(),
                    HabitLogDB.date >= str(previous_start),
                    HabitLogDB.date <= str(end_dt)
                )
            )
            logs_result = await session.execute(logs_query)
            all_logs = logs_result.scalars().all()
            
            # Calculate trends per habit
            trends = []
            for habit in habits:
                habit_logs = [l for l in all_logs if l.habit_id == habit.id]
                
                # Split logs by period
                current_logs = [l for l in habit_logs if l.date >= str(current_start)]
                previous_logs = [l for l in habit_logs if l.date < str(current_start)]
                
                # Aggregate by date
                current_daily = self._aggregate_by_date(habit, current_logs)
                previous_daily = self._aggregate_by_date(habit, previous_logs)
                
                # Calculate averages (per day with data)
                current_values = [v["value"] for v in current_daily.values()]
                previous_values = [v["value"] for v in previous_daily.values()]
                
                days_current = len(current_values)
                days_previous = len(previous_values)
                
                current_avg = sum(current_values) / days_current if days_current > 0 else 0
                previous_avg = sum(previous_values) / days_previous if days_previous > 0 else 0
                
                # Calculate change
                absolute_change = current_avg - previous_avg
                if previous_avg > 0:
                    percent_change = ((current_avg - previous_avg) / previous_avg) * 100
                elif current_avg > 0:
                    percent_change = 100.0  # Went from 0 to something
                else:
                    percent_change = 0.0
                
                # Determine direction (threshold: 5% change)
                if percent_change > 5:
                    direction = "up"
                elif percent_change < -5:
                    direction = "down"
                else:
                    direction = "flat"
                
                # Determine confidence
                if days_current >= 10 and days_previous >= 10:
                    confidence = "high"
                elif days_current >= 5 and days_previous >= 5:
                    confidence = "medium"
                else:
                    confidence = "low"
                
                trends.append({
                    "habit_id": habit.id,
                    "habit_name": habit.name,
                    "unit": habit.unit_type or "sessions",
                    "category": habit.category,
                    "window_days": window_days,
                    "current_avg": round(current_avg, 2),
                    "previous_avg": round(previous_avg, 2),
                    "absolute_change": round(absolute_change, 2),
                    "percent_change": round(percent_change, 1),
                    "days_with_data_current": days_current,
                    "days_with_data_previous": days_previous,
                    "direction": direction,
                    "confidence": confidence,
                })
            
            # Sort by absolute percent change (most changed first)
            trends.sort(key=lambda x: abs(x["percent_change"]), reverse=True)
            
            # Generate suggested follow-ups based on results
            suggested_followups = self._generate_trend_followups(trends)
            
            return {
                "success": True,
                "window_days": window_days,
                "current_period": {
                    "start": str(current_start),
                    "end": str(end_dt)
                },
                "previous_period": {
                    "start": str(previous_start),
                    "end": str(previous_end)
                },
                "trends": trends,
                "summary": {
                    "total_habits": len(trends),
                    "improving": len([t for t in trends if t["direction"] == "up"]),
                    "declining": len([t for t in trends if t["direction"] == "down"]),
                    "stable": len([t for t in trends if t["direction"] == "flat"]),
                },
                "suggested_followups": suggested_followups
            }
    
    def _generate_trend_followups(self, trends: List[Dict[str, Any]]) -> List[str]:
        """Generate suggested follow-up questions based on trend results."""
        followups = []
        
        # Find most changed habits
        significant_changes = [t for t in trends if abs(t["percent_change"]) > 10 and t["confidence"] != "low"]
        
        if significant_changes:
            # Suggest anomaly check for biggest change
            biggest = significant_changes[0]
            followups.append(f"Show anomalies for {biggest['habit_name']}")
        
        # Find habits with good data for correlation
        high_data_habits = [t for t in trends if t["days_with_data_current"] >= 15]
        if len(high_data_habits) >= 2:
            h1, h2 = high_data_habits[0], high_data_habits[1]
            followups.append(f"Compare {h1['habit_name']} vs {h2['habit_name']} (correlation)")
        
        # Suggest breakdown for a specific habit
        if trends:
            top = trends[0]
            followups.append(f"Break down {top['habit_name']} by day for the last 30 days")
        
        return followups[:3]  # Max 3 suggestions
    
    async def get_habit_anomalies(
        self,
        user_id: str,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 30,
        z_threshold: float = 2.0,
        max_results: int = 5
    ) -> Dict[str, Any]:
        """
        Identify unusual days (spikes/drops) for a habit using z-score analysis.
        
        Returns:
        - baseline_avg, baseline_std_dev
        - anomalies: list of unusual days with date, value, z_score, type (spike/drop)
        """
        async with get_db_session() as session:
            # Calculate date range
            if end_date:
                end_dt = datetime.strptime(end_date, '%Y-%m-%d').date()
            else:
                end_dt = datetime.utcnow().date()
                
            if start_date:
                start_dt = datetime.strptime(start_date, '%Y-%m-%d').date()
            else:
                start_dt = end_dt - timedelta(days=days_back)
            
            # Find the habit
            habit = await self._find_habit(session, user_id, habit_id, habit_name)
            if not habit:
                return {
                    "success": False,
                    "error": f"No habit found matching '{habit_name or habit_id}'",
                    "available_habits": await self._get_habit_names(session, user_id)
                }
            
            # Get logs
            logs_query = select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id == habit.id,
                    self._completed_log_filter(),
                    HabitLogDB.date >= str(start_dt),
                    HabitLogDB.date <= str(end_dt)
                )
            )
            logs_result = await session.execute(logs_query)
            logs = logs_result.scalars().all()
            
            # Aggregate by date
            daily_data = self._aggregate_by_date(habit, logs)
            
            if len(daily_data) < 3:
                return {
                    "success": False,
                    "error": f"Not enough data for anomaly detection. Need at least 3 days, found {len(daily_data)}.",
                    "habit": {"id": habit.id, "name": habit.name, "unit": habit.unit_type}
                }
            
            # Calculate baseline statistics
            values = [v["value"] for v in daily_data.values()]
            mean = sum(values) / len(values)
            variance = sum((v - mean) ** 2 for v in values) / len(values)
            std_dev = math.sqrt(variance)
            
            if std_dev == 0:
                return {
                    "success": True,
                    "habit": {"id": habit.id, "name": habit.name, "unit": habit.unit_type or "sessions"},
                    "date_range": {"start": str(start_dt), "end": str(end_dt)},
                    "baseline_avg": round(mean, 2),
                    "baseline_std_dev": 0,
                    "anomalies": [],
                    "message": "No variance in data - all values are the same",
                    "suggested_followups": []
                }
            
            # Find anomalies
            anomalies = []
            for date_str, data in daily_data.items():
                value = data["value"]
                z_score = (value - mean) / std_dev
                
                if abs(z_score) >= z_threshold:
                    anomalies.append({
                        "date": date_str,
                        "value": round(value, 2),
                        "z_score": round(z_score, 2),
                        "type": "spike" if z_score > 0 else "drop",
                        "entries_count": data.get("entries", 1),
                        "deviation_from_avg": round(value - mean, 2)
                    })
            
            # Sort by absolute z-score and limit results
            anomalies.sort(key=lambda x: abs(x["z_score"]), reverse=True)
            anomalies = anomalies[:max_results]
            
            # Generate follow-ups
            suggested_followups = self._generate_anomaly_followups(habit.name, anomalies)
            
            return {
                "success": True,
                "habit": {"id": habit.id, "name": habit.name, "unit": habit.unit_type or "sessions"},
                "date_range": {"start": str(start_dt), "end": str(end_dt)},
                "days_analyzed": len(daily_data),
                "baseline_avg": round(mean, 2),
                "baseline_std_dev": round(std_dev, 2),
                "z_threshold": z_threshold,
                "anomalies": anomalies,
                "summary": {
                    "total_anomalies": len(anomalies),
                    "spikes": len([a for a in anomalies if a["type"] == "spike"]),
                    "drops": len([a for a in anomalies if a["type"] == "drop"])
                },
                "suggested_followups": suggested_followups
            }
    
    def _generate_anomaly_followups(self, habit_name: str, anomalies: List[Dict[str, Any]]) -> List[str]:
        """Generate suggested follow-up questions based on anomaly results."""
        followups = []
        
        if anomalies:
            # Suggest trends to see overall pattern
            followups.append(f"Show trends for {habit_name} over the last 90 days")
            
            # Suggest correlation if there are significant anomalies
            if len(anomalies) >= 2:
                followups.append(f"What habits might be affecting my {habit_name}?")
        else:
            followups.append(f"Show me my {habit_name} breakdown by day")
        
        return followups[:3]
    
    # ====================
    # HELPER METHODS
    # ====================
    
    def _calculate_habit_stats(self, habit: HabitDB, logs: List[HabitLogDB]) -> Dict[str, Any]:
        """
        Calculate comprehensive stats for a single habit.
        Aggregates by date first, then calculates stats from daily values.
        """
        # Aggregate by date
        daily_data = self._aggregate_by_date(habit, logs)
        daily_values = [v["value"] for v in daily_data.values()]
        
        days_with_data = len(daily_values)
        total_entries = len(logs)
        
        if days_with_data == 0:
            return {
                "id": habit.id,
                "name": habit.name,
                "category": habit.category,
                "unit": habit.unit_type or "sessions",
                "total": 0,
                "average": 0,
                "min": 0,
                "max": 0,
                "variance": 0,
                "std_dev": 0,
                "days_with_data": 0,
                "total_entries": 0,
                "summary": "No data for this period"
            }
        
        total = sum(daily_values)
        avg = total / days_with_data  # Average per DAY with data
        min_val = min(daily_values)
        max_val = max(daily_values)
        variance = sum((v - avg) ** 2 for v in daily_values) / days_with_data
        std_dev = math.sqrt(variance)
        
        # Determine unit display
        unit = habit.unit_type or "sessions"
        
        return {
            "id": habit.id,
            "name": habit.name,
            "category": habit.category,
            "unit": unit,
            "total": round(total, 2),
            "average": round(avg, 2),
            "min": round(min_val, 2),
            "max": round(max_val, 2),
            "variance": round(variance, 2),
            "std_dev": round(std_dev, 2),
            "days_with_data": days_with_data,
            "total_entries": total_entries,
            "summary": f"{round(total, 1)} {unit} total, {round(avg, 1)} {unit}/day avg over {days_with_data} days"
        }
    
    def _aggregate_by_date(self, habit: HabitDB, logs: List[HabitLogDB]) -> Dict[str, Dict[str, Any]]:
        """
        Aggregate logs by date.
        - For sleep-like duration habits: takes MAX per day
        - For most duration habits: SUM per day (e.g., computer use, coding)
        - For amount-based habits: SUM per day (e.g., steps, pages)
        - For session-based: COUNT per day
        """
        by_date: Dict[str, Dict[str, Any]] = {}
        unit = (habit.unit_type or "").lower()
        use_max_duration = self._use_max_duration_per_day(habit)
        
        for log in logs:
            date = log.date
            if date not in by_date:
                by_date[date] = {"duration": 0, "amount": 0, "count": 0}
            
            # Track all metrics
            if log.duration and log.duration > 0:
                if use_max_duration:
                    by_date[date]["duration"] = max(by_date[date]["duration"], log.duration)
                else:
                    by_date[date]["duration"] += log.duration
            if log.amount is not None:
                by_date[date]["amount"] += log.amount
            by_date[date]["count"] += 1
        
        # Convert to single value based on habit type
        result: Dict[str, Dict[str, Any]] = {}
        for date, data in by_date.items():
            if "hour" in unit:
                # Duration in hours
                value = data["duration"] / 3600 if data["duration"] > 0 else data["amount"]
            elif "minute" in unit:
                # Duration in minutes
                value = data["duration"] / 60 if data["duration"] > 0 else data["amount"]
            elif data["amount"] > 0:
                # Amount-based (miles, pages, etc.)
                value = data["amount"]
            elif data["duration"] > 0:
                # Default duration to hours
                value = data["duration"] / 3600
            else:
                # Session count
                value = data["count"]
            
            result[date] = {
                "value": value, 
                "entries": data["count"],
                "duration_seconds": data["duration"],
                "amount": data["amount"]
            }
        
        return result
    
    def _calculate_pearson_correlation(self, x: List[float], y: List[float]) -> Tuple[float, str, str]:
        """
        Calculate Pearson correlation coefficient.
        Returns (coefficient, strength, direction)
        """
        n = len(x)
        if n < 2:
            return 0, "insufficient_data", ""
        
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(xi * yi for xi, yi in zip(x, y))
        sum_x2 = sum(xi ** 2 for xi in x)
        sum_y2 = sum(yi ** 2 for yi in y)
        
        numerator = n * sum_xy - sum_x * sum_y
        denominator = math.sqrt((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2))
        
        if denominator == 0:
            return 0, "no_variance", ""
        
        r = numerator / denominator
        
        # Interpret strength
        abs_r = abs(r)
        if abs_r >= 0.7:
            strength = "strong"
        elif abs_r >= 0.4:
            strength = "moderate"
        elif abs_r >= 0.2:
            strength = "weak"
        else:
            strength = "negligible"
        
        # Interpret direction
        if r > 0.1:
            direction = "positive"
        elif r < -0.1:
            direction = "negative"
        else:
            direction = "none"
        
        return r, strength, direction
    
    def _interpret_correlation(self, r: float, habit1_name: str, habit2_name: str) -> str:
        """Generate human-readable interpretation of correlation."""
        abs_r = abs(r)
        
        if abs_r < 0.2:
            return f"No significant relationship found between {habit1_name} and {habit2_name}."
        
        strength = "strong" if abs_r >= 0.7 else "moderate" if abs_r >= 0.4 else "weak"
        
        if r > 0:
            return f"There is a {strength} positive correlation (r={r:.2f}). On days with more {habit1_name}, you tend to have more {habit2_name}."
        else:
            return f"There is a {strength} negative correlation (r={r:.2f}). On days with more {habit1_name}, you tend to have less {habit2_name}."
    
    async def _find_habit(
        self,
        session: AsyncSession,
        user_id: str,
        habit_id: Optional[str],
        habit_name: Optional[str]
    ) -> Optional[HabitDB]:
        """Find a habit by ID or name with flexible matching."""
        if habit_id:
            result = await session.execute(
                select(HabitDB).where(
                    and_(HabitDB.id == habit_id, HabitDB.user_id == user_id)
                )
            )
            return result.scalars().first()
        
        if habit_name:
            result = await session.execute(
                select(HabitDB).where(HabitDB.user_id == user_id)
            )
            habits = result.scalars().all()
            matches = self._find_habits_by_name(habits, habit_name)
            return matches[0] if matches else None
        
        return None
    
    def _find_habits_by_name(self, habits: List[HabitDB], search_name: str) -> List[HabitDB]:
        """
        Flexible habit name matching:
        1. Exact match
        2. Contains match
        3. Reverse contains
        4. Common variations
        """
        search = search_name.lower().strip()
        
        # 1. Exact match
        for h in habits:
            if h.name.lower() == search:
                return [h]
        
        # 2. Contains (search in habit name)
        for h in habits:
            if search in h.name.lower():
                return [h]
        
        # 3. Reverse contains (habit name in search)
        for h in habits:
            if h.name.lower() in search:
                return [h]
        
        # 4. Common variations
        variations = {
            'workout': ['workout', 'exercise', 'gym', 'training', 'morning workout', 'evening workout'],
            'sleep': ['sleep', 'rest', 'sleep duration', 'night sleep'],
            'meditation': ['meditation', 'meditate', 'mindfulness'],
            'reading': ['reading', 'read', 'books', 'daily reading'],
            'coding': ['coding', 'code', 'programming', 'deep work'],
            'walk': ['walk', 'walking', 'daily walk', 'steps', 'miles'],
            'water': ['water', 'hydration', 'drink', 'glasses'],
        }
        
        for key, terms in variations.items():
            if any(t in search for t in terms):
                for h in habits:
                    if any(t in h.name.lower() for t in terms):
                        return [h]
        
        return []
    
    async def _get_habit_names(self, session: AsyncSession, user_id: str) -> List[str]:
        """Get list of all habit names for a user."""
        result = await session.execute(
            select(HabitDB.name).where(HabitDB.user_id == user_id)
        )
        return [r[0] for r in result.fetchall()]


# Singleton instance
analytics_service = AnalyticsService()
