"""
Habits Service - Handles all habit-related database operations
Mirrors the functionality of the TypeScript habits-service.ts
"""

import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.exc import SQLAlchemyError

from models.habit_models import Habit, HabitCreate, HabitUpdate, HabitLog, HabitLogCreate
from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB, UserDB, HabitAliasDB
from database.helpers import habit_db_to_pydantic, habit_log_db_to_pydantic
from services.tinybird_service import TinybirdService


# Phase 5A: Built-in synonym map for common habit types
HABIT_SYNONYMS = {
    "walk": ["walking", "walked", "stroll", "strolled", "hike", "hiked"],
    "run": ["running", "ran", "jog", "jogging", "jogged"],
    "workout": ["work out", "worked out", "exercise", "exercised", "gym", "training", "trained"],
    "meditation": ["meditate", "meditated", "mindfulness", "mindful"],
    "sleep": ["slept", "sleeping", "rest", "rested"],
    "read": ["reading", "book", "books"],
    "code": ["coding", "coded", "programming", "programmed", "develop", "developed"],
    "write": ["writing", "wrote", "written"],
    "study": ["studying", "studied", "learn", "learning", "learned"],
    "stretch": ["stretching", "stretched", "yoga"],
    "swim": ["swimming", "swam"],
    "bike": ["biking", "biked", "cycling", "cycled", "bicycle"],
    "water": ["hydrate", "hydrated", "hydration", "drink", "drank"],
    "caffeine": ["coffee", "espresso", "tea"],
    "screen": ["screentime", "screen time", "phone", "device"],
}

class HabitsService:
    """Service class for habit operations"""
    
    def __init__(self):
        """Initialize with Tinybird service"""
        try:
            self.tinybird = TinybirdService()
            self.tinybird_enabled = True
            print("✅ Tinybird service initialized - automatic sync enabled")
        except Exception as e:
            print(f"⚠️  Tinybird service not available: {e}")
            self.tinybird = None
            self.tinybird_enabled = False
    
    async def create_habit(self, habit_data: HabitCreate, user_id: str) -> Habit:
        """
        Create a new habit - mirrors habitsService.createHabit()
        """
        async with get_db_session() as session:
            try:
                # Create habit record
                habit_db = HabitDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    name=habit_data.name,
                    category=habit_data.category,
                    icon=habit_data.icon,
                    is_custom=habit_data.is_custom or False,
                    integration_source=habit_data.integration_source,
                    unit_type=habit_data.unit_type,
                    sensor_type=habit_data.sensor_type,
                    metric_type=habit_data.metric_type,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                
                session.add(habit_db)
                await session.commit()
                await session.refresh(habit_db)
                
                # Convert to Pydantic model
                habit = habit_db_to_pydantic(habit_db)
                
                # Sync to Tinybird (async, non-blocking)
                if self.tinybird_enabled:
                    try:
                        await self._sync_habit_to_tinybird(habit)
                        print(f"📊 Habit '{habit.name}' synced to Tinybird")
                    except Exception as e:
                        print(f"⚠️  Tinybird sync failed for habit '{habit.name}': {e}")
                
                # Index to Typesense for search (async, non-blocking)
                try:
                    from services.search_service import search_service
                    await search_service.index_habit(habit.model_dump(), user_id)
                except Exception as e:
                    print(f"⚠️  Search index failed for habit '{habit.name}': {e}")
                
                return habit
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to create habit: {str(e)}")
    
    async def get_habits(self, user_id: str) -> List[Habit]:
        """
        Get all habits for a user - mirrors habitsService.getHabits()
        """
        async with get_db_session() as session:
            try:
                result = await session.execute(
                    select(HabitDB)
                    .where(HabitDB.user_id == user_id)
                    .order_by(HabitDB.created_at.desc())
                )
                habits_db = result.scalars().all()
                return [habit_db_to_pydantic(habit) for habit in habits_db]
                
            except SQLAlchemyError as e:
                raise Exception(f"Failed to fetch habits: {str(e)}")
    
    async def get_habit_by_id(self, habit_id: str, user_id: str) -> Optional[Habit]:
        """
        Get a specific habit by ID
        """
        async with get_db_session() as session:
            try:
                result = await session.execute(
                    select(HabitDB)
                    .where(HabitDB.id == habit_id)
                    .where(HabitDB.user_id == user_id)
                )
                habit_db = result.scalar_one_or_none()
                return habit_db_to_pydantic(habit_db) if habit_db else None
                
            except SQLAlchemyError as e:
                raise Exception(f"Failed to fetch habit: {str(e)}")
    
    async def update_habit(self, habit_id: str, updates: HabitUpdate, user_id: str) -> Habit:
        """
        Update a habit - mirrors habitsService.updateHabit()
        """
        async with get_db_session() as session:
            try:
                # Build update dict with only provided fields
                update_data = {}
                if updates.name is not None:
                    update_data['name'] = updates.name
                if updates.category is not None:
                    update_data['category'] = updates.category
                if updates.icon is not None:
                    update_data['icon'] = updates.icon
                if updates.is_custom is not None:
                    update_data['is_custom'] = updates.is_custom
                if updates.integration_source is not None:
                    update_data['integration_source'] = updates.integration_source
                if updates.unit_type is not None:
                    update_data['unit_type'] = updates.unit_type
                if updates.sensor_type is not None:
                    update_data['sensor_type'] = updates.sensor_type
                if updates.metric_type is not None:
                    update_data['metric_type'] = updates.metric_type
                
                update_data['updated_at'] = datetime.utcnow()
                
                # Update the habit
                await session.execute(
                    update(HabitDB)
                    .where(HabitDB.id == habit_id)
                    .where(HabitDB.user_id == user_id)
                    .values(**update_data)
                )
                
                await session.commit()
                
                # Fetch and return updated habit
                updated_habit = await self.get_habit_by_id(habit_id, user_id)
                if not updated_habit:
                    raise Exception("Habit not found or not authorized")
                
                return updated_habit
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to update habit: {str(e)}")
    
    async def delete_habit(self, habit_id: str, user_id: str) -> None:
        """
        Delete a habit - mirrors habitsService.deleteHabit()
        """
        async with get_db_session() as session:
            try:
                # First check if the habit exists
                check_result = await session.execute(
                    select(HabitDB)
                    .where(HabitDB.id == habit_id)
                )
                habit = check_result.scalar_one_or_none()
                
                if not habit:
                    print(f"❌ Habit not found: {habit_id}")
                    raise Exception(f"Habit not found with ID: {habit_id}")
                
                if habit.user_id != user_id:
                    print(f"❌ Unauthorized: habit user_id={habit.user_id}, requested user_id={user_id}")
                    raise Exception(f"Not authorized to delete this habit")
                
                # Delete habit logs first (cascade)
                logs_result = await session.execute(
                    delete(HabitLogDB)
                    .where(HabitLogDB.habit_id == habit_id)
                )
                print(f"🗑️ Deleted {logs_result.rowcount} habit logs for habit {habit_id}")
                
                # Delete the habit
                result = await session.execute(
                    delete(HabitDB)
                    .where(HabitDB.id == habit_id)
                    .where(HabitDB.user_id == user_id)
                )
                
                if result.rowcount == 0:
                    raise Exception("Habit not found or not authorized")
                
                await session.commit()
                print(f"✅ Successfully deleted habit: {habit.name} ({habit_id})")
                
            except SQLAlchemyError as e:
                await session.rollback()
                print(f"❌ Database error deleting habit: {str(e)}")
                raise Exception(f"Failed to delete habit: {str(e)}")
    
    async def log_habit(self, habit_id: str, log_data: HabitLogCreate, user_id: str) -> HabitLog:
        """
        Log a habit completion - mirrors habitsService.logHabit()
        """
        async with get_db_session() as session:
            try:
                # Verify habit exists and belongs to user
                habit = await self.get_habit_by_id(habit_id, user_id)
                if not habit:
                    raise Exception("Habit not found or not authorized")
                
                # Create habit log (include habit_name for denormalization)
                log_db = HabitLogDB(
                    id=str(uuid.uuid4()),
                    habit_id=habit_id,
                    habit_name=habit.name,  # Denormalized for performance and historical accuracy
                    duration=log_data.duration,
                    amount=log_data.amount,
                    date=log_data.date,
                    completed_at=log_data.completed_at,
                    status=log_data.status,
                    notes=log_data.notes
                )
                
                session.add(log_db)
                await session.commit()
                await session.refresh(log_db)
                
                habit_log = habit_log_db_to_pydantic(log_db)
                
                # Sync to Tinybird (async, non-blocking)
                if self.tinybird_enabled:
                    try:
                        print(f"🔄 Syncing habit log for '{habit.name}' to Tinybird...")
                        result = await self._sync_habit_log_to_tinybird(habit_log, habit, user_id)
                        if result and result.get('success'):
                            print(f"✅ Habit log for '{habit.name}' synced to Tinybird ({result.get('count', 0)} events)")
                        else:
                            print(f"❌ Tinybird sync failed for habit log: {result.get('error', 'Unknown error')}")
                            print(f"❌ Tinybird response: {result}")
                    except Exception as e:
                        print(f"❌ Tinybird sync exception for habit log: {e}")
                        import traceback
                        traceback.print_exc()
                else:
                    print(f"⚠️  Tinybird sync disabled - habit log NOT synced to analytics")
                
                # Index to Typesense for search (async, non-blocking)
                try:
                    from services.search_service import search_service
                    await search_service.index_habit_log(
                        habit_log.model_dump(),
                        user_id,
                        habit_name=habit.name,
                        category=habit.category
                    )
                except Exception as e:
                    print(f"⚠️  Search index failed for habit log: {e}")
                
                return habit_log
                
            except SQLAlchemyError as e:
                await session.rollback()
                raise Exception(f"Failed to log habit: {str(e)}")
    
    async def batch_log_habits(
        self, 
        items: List[Dict], 
        user_id: str, 
        client_event_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Phase 5A: Batch log multiple habits at once.
        Returns per-item results with success/error status.
        """
        results = []
        
        async with get_db_session() as session:
            try:
                # Check for idempotency if client_event_id provided
                if client_event_id:
                    existing = await session.execute(
                        select(HabitLogDB).where(HabitLogDB.client_event_id == client_event_id)
                    )
                    existing_logs = existing.scalars().all()
                    if existing_logs:
                        print(f"⚠️ Duplicate client_event_id detected: {client_event_id}")
                        return {
                            "success": True,
                            "duplicate": True,
                            "results": [
                                {"index": i, "success": True, "log_id": log.id, "duplicate": True}
                                for i, log in enumerate(existing_logs)
                            ]
                        }
                
                # Pre-fetch all user habits for validation
                user_habits = await self.get_habits(user_id)
                habits_by_id = {h.id: h for h in user_habits}
                
                created_logs = []
                
                for index, item in enumerate(items):
                    try:
                        habit_id = item.get("habit_id")
                        
                        # Validate habit ownership
                        if habit_id not in habits_by_id:
                            results.append({
                                "index": index,
                                "success": False,
                                "error": f"Habit not found or not authorized: {habit_id}"
                            })
                            continue
                        
                        habit = habits_by_id[habit_id]
                        
                        # Create habit log
                        log_id = str(uuid.uuid4())
                        log_db = HabitLogDB(
                            id=log_id,
                            habit_id=habit_id,
                            habit_name=habit.name,
                            duration=item.get("duration"),
                            amount=item.get("amount"),
                            date=item.get("date"),
                            completed_at=item.get("completed_at") or datetime.utcnow().isoformat(),
                            status="completed",
                            notes=item.get("notes"),
                            client_event_id=client_event_id,
                            source=item.get("source", "ai_log_v2")
                        )
                        
                        session.add(log_db)
                        created_logs.append((index, log_db, habit))
                        
                        results.append({
                            "index": index,
                            "success": True,
                            "log_id": log_id,
                            "habit_id": habit_id,
                            "habit_name": habit.name
                        })
                        
                    except Exception as item_error:
                        results.append({
                            "index": index,
                            "success": False,
                            "error": str(item_error)
                        })
                
                # Commit all successful logs
                await session.commit()
                
                # Sync to Tinybird for all created logs
                if self.tinybird_enabled and created_logs:
                    for index, log_db, habit in created_logs:
                        try:
                            await session.refresh(log_db)
                            habit_log = habit_log_db_to_pydantic(log_db)
                            await self._sync_habit_log_to_tinybird(habit_log, habit, user_id)
                        except Exception as e:
                            print(f"⚠️ Tinybird sync failed for log {log_db.id}: {e}")
                
                return {
                    "success": True,
                    "results": results,
                    "logged_count": sum(1 for r in results if r.get("success"))
                }
                
            except SQLAlchemyError as e:
                await session.rollback()
                return {
                    "success": False,
                    "error": f"Database error: {str(e)}",
                    "results": results
                }
    
    async def get_habit_logs(self, habit_id: Optional[str], user_id: str) -> List[HabitLog]:
        """
        Get habit logs - mirrors habitsService.getHabitLogs()
        """
        async with get_db_session() as session:
            try:
                query = select(HabitLogDB).join(HabitDB).where(HabitDB.user_id == user_id)
                
                if habit_id:
                    query = query.where(HabitLogDB.habit_id == habit_id)
                
                query = query.order_by(HabitLogDB.date.desc())
                
                result = await session.execute(query)
                logs_db = result.scalars().all()
                return [habit_log_db_to_pydantic(log) for log in logs_db]
                
            except SQLAlchemyError as e:
                raise Exception(f"Failed to fetch habit logs: {str(e)}")
    
    async def migrate_user_data_from_supabase(self, user_id: str) -> dict:
        """
        Migrate user's data from Supabase to the new backend
        This would be used during the migration phase
        """
        # This would implement the actual migration logic
        # For now, return a placeholder
        return {
            "habits_migrated": 0,
            "logs_migrated": 0,
            "message": "Migration functionality to be implemented"
        }
    
    async def _sync_habit_to_tinybird(self, habit: Habit) -> None:
        """
        Sync habit definition to Tinybird for analytics enrichment
        """
        if not self.tinybird_enabled:
            return
            
        habit_data = {
            'id': habit.id,
            'user_id': habit.user_id,
            'name': habit.name,
            'category': habit.category,
            'icon': habit.icon,
            'is_custom': habit.is_custom,
            'integration_source': habit.integration_source,
            'unit_type': habit.unit_type,
            'created_at': habit.created_at.isoformat() if habit.created_at else None,
            'updated_at': habit.updated_at.isoformat() if habit.updated_at else None
        }
        
        await self.tinybird.ingest_habit_definition(habit_data)
    
    async def _sync_habit_log_to_tinybird(self, habit_log: HabitLog, habit: Habit, user_id: str) -> Dict[str, Any]:
        """
        Sync habit log to Tinybird for analytics.
        Maps all Turso fields to their Tinybird equivalents.
        """
        if not self.tinybird_enabled:
            return {'success': False, 'error': 'Tinybird not enabled'}
            
        log_data = {
            'id': habit_log.id,
            'habit_id': habit_log.habit_id,
            'habit_name': habit_log.habit_name or habit.name,
            'user_id': user_id,
            'date': habit_log.date,
            'duration': habit_log.duration,
            'amount': habit_log.amount,
            'unit': habit.unit_type,
            'status': habit_log.status,
            'notes': habit_log.notes,
            'source': habit_log.source or 'manual',
            'completed_at': habit_log.completed_at or habit_log.date,
            'metadata': habit_log.log_metadata,
            'integration_source': habit.integration_source,
            'metric_type': habit.metric_type,
        }
        
        result = await self.tinybird.ingest_habit_log(log_data)
        return result
    
    async def get_category_breakdown(self, user_id: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """
        Get habit completion breakdown by category for analytics
        Returns count of completed habits grouped by category
        """
        async with get_db_session() as session:
            try:
                from sqlalchemy import func, and_
                
                # Query to get habit logs count by category
                query = (
                    select(
                        HabitDB.category,
                        func.count(HabitLogDB.id).label('count'),
                        func.sum(HabitLogDB.duration).label('total_duration'),
                        func.sum(HabitLogDB.amount).label('total_amount')
                    )
                    .join(HabitLogDB, HabitDB.id == HabitLogDB.habit_id)
                    .where(
                        and_(
                            HabitDB.user_id == user_id,
                            HabitLogDB.date >= start_date,
                            HabitLogDB.date <= end_date,
                            HabitLogDB.status == 'completed'
                        )
                    )
                    .group_by(HabitDB.category)
                )
                
                result = await session.execute(query)
                rows = result.all()
                
                breakdown = []
                for row in rows:
                    breakdown.append({
                        'category': row.category,
                        'count': row.count,
                        'total_duration': row.total_duration or 0,
                        'total_amount': row.total_amount or 0
                    })
                
                return breakdown
                
            except SQLAlchemyError as e:
                print(f"❌ Error fetching category breakdown: {e}")
                raise
    
    # ================================
    # Phase 5A: Alias Management
    # ================================
    
    async def get_habit_aliases(self, habit_id: str, user_id: str) -> List[str]:
        """
        Get all aliases for a habit.
        """
        async with get_db_session() as session:
            try:
                # Verify habit belongs to user
                habit = await self.get_habit_by_id(habit_id, user_id)
                if not habit:
                    return []
                
                result = await session.execute(
                    select(HabitAliasDB.alias_text)
                    .where(HabitAliasDB.habit_id == habit_id)
                )
                return [row[0] for row in result.all()]
                
            except SQLAlchemyError as e:
                print(f"❌ Error fetching habit aliases: {e}")
                return []
    
    async def add_habit_alias(self, habit_id: str, alias_text: str, user_id: str) -> bool:
        """
        Add an alias to a habit.
        """
        async with get_db_session() as session:
            try:
                # Verify habit belongs to user
                habit = await self.get_habit_by_id(habit_id, user_id)
                if not habit:
                    return False
                
                normalized_alias = alias_text.lower().strip()
                
                # Check if alias already exists
                existing = await session.execute(
                    select(HabitAliasDB)
                    .where(HabitAliasDB.habit_id == habit_id)
                    .where(HabitAliasDB.alias_text == normalized_alias)
                )
                if existing.scalar_one_or_none():
                    return True  # Already exists
                
                alias_db = HabitAliasDB(
                    id=str(uuid.uuid4()),
                    habit_id=habit_id,
                    alias_text=normalized_alias,
                    created_at=datetime.utcnow()
                )
                session.add(alias_db)
                await session.commit()
                return True
                
            except SQLAlchemyError as e:
                await session.rollback()
                print(f"❌ Error adding habit alias: {e}")
                return False
    
    async def auto_generate_aliases(self, habit: Habit) -> List[str]:
        """
        Auto-generate aliases from habit name and built-in synonyms.
        Returns list of generated aliases.
        """
        aliases = []
        habit_name_lower = habit.name.lower()
        
        # Extract tokens from habit name
        tokens = habit_name_lower.replace("-", " ").replace("_", " ").split()
        
        # Add each token as potential alias
        for token in tokens:
            if len(token) >= 3:  # Skip very short tokens
                aliases.append(token)
                
                # Add synonyms from the built-in map
                for base_word, synonyms in HABIT_SYNONYMS.items():
                    if base_word == token or token in synonyms:
                        aliases.append(base_word)
                        aliases.extend(synonyms)
        
        # Remove duplicates
        return list(set(aliases))
    
    async def ensure_habit_aliases(self, habit_id: str, user_id: str) -> int:
        """
        Ensure a habit has auto-generated aliases.
        Returns number of aliases added.
        """
        habit = await self.get_habit_by_id(habit_id, user_id)
        if not habit:
            return 0
        
        existing_aliases = await self.get_habit_aliases(habit_id, user_id)
        generated_aliases = await self.auto_generate_aliases(habit)
        
        added = 0
        for alias in generated_aliases:
            if alias not in existing_aliases:
                if await self.add_habit_alias(habit_id, alias, user_id):
                    added += 1
        
        return added
    
    async def get_all_aliases_for_user(self, user_id: str) -> Dict[str, List[str]]:
        """
        Get all aliases for all habits owned by a user.
        Returns dict mapping habit_id -> [aliases]
        """
        async with get_db_session() as session:
            try:
                # Get all user habits
                habits = await self.get_habits(user_id)
                habit_ids = [h.id for h in habits]
                
                if not habit_ids:
                    return {}
                
                result = await session.execute(
                    select(HabitAliasDB.habit_id, HabitAliasDB.alias_text)
                    .where(HabitAliasDB.habit_id.in_(habit_ids))
                )
                
                aliases_map: Dict[str, List[str]] = {hid: [] for hid in habit_ids}
                for row in result.all():
                    aliases_map[row[0]].append(row[1])
                
                return aliases_map
                
            except SQLAlchemyError as e:
                print(f"❌ Error fetching user aliases: {e}")
                return {}
