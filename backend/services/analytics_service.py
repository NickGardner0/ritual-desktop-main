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
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any, Tuple
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB


class AnalyticsService:
    """
    Centralized analytics calculations for habit data.
    Single source of truth - used by Dashboard, Analytics page, and AI Chat.
    """
    
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
        days_back: int = 30
    ) -> Dict[str, Any]:
        """
        Get day-by-day breakdown for a habit.
        Returns list of {date, value, unit} sorted chronologically.
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
            logs_query = select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id == habit.id,
                    HabitLogDB.date >= str(start_dt),
                    HabitLogDB.date <= str(end_dt)
                )
            )
            logs_result = await session.execute(logs_query)
            logs = logs_result.scalars().all()
            
            # Aggregate by date
            daily_data = self._aggregate_by_date(habit, logs)
            
            # Sort chronologically
            sorted_days = sorted(daily_data.items(), key=lambda x: x[0])
            
            # Calculate stats
            values = [v["value"] for v in daily_data.values()]
            total = sum(values) if values else 0
            avg = total / len(values) if values else 0
            
            # Determine if this is a duration-based habit (hours) or amount-based
            is_duration = any(d.get("duration_seconds", 0) > 0 for d in daily_data.values())
            
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
                "days_with_data": len(daily_data),
                "total": round(total, 2),
                "average_per_day": round(avg, 2),
                "data": [
                    {
                        "date": date_str,
                        "total_hours": round(data.get("duration_seconds", 0) / 3600, 2) if is_duration else None,
                        "total_duration_seconds": data.get("duration_seconds", 0) if is_duration else None,
                        "total_amount": data.get("amount", 0) if not is_duration else None,
                        "value": round(data["value"], 2),
                        "unit": habit.unit_type or "sessions"
                    }
                    for date_str, data in sorted_days
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
        - For duration-based habits: takes MAX per day (e.g., sleep)
        - For amount-based habits: SUM per day (e.g., steps, pages)
        - For session-based: COUNT per day
        """
        by_date: Dict[str, Dict[str, Any]] = {}
        unit = (habit.unit_type or "").lower()
        
        for log in logs:
            date = log.date
            if date not in by_date:
                by_date[date] = {"duration": 0, "amount": 0, "count": 0}
            
            # Track all metrics
            if log.duration and log.duration > 0:
                # For duration: take max (handles sleep where you don't want to sum multiple naps)
                by_date[date]["duration"] = max(by_date[date]["duration"], log.duration)
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

