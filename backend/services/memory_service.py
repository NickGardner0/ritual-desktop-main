"""
AI User Memory Service

Handles persistence and retrieval of user preferences and conversation memory overrides.
"""

import uuid
import json
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from database.connection import get_db_session
from database.models import AIUserMemoryDB, AIConversationDB


# Default memory values
DEFAULT_MEMORY = {
    "default_time_window_days": 30,
    "preferred_timezone": None,
    "preferred_response_style": "balanced",
    "preferred_units": None,
    "preferred_focus_habits": None,
}


class MemoryService:
    """
    Service for managing AI user memory and conversation overrides.
    """
    
    async def get_user_memory(self, user_id: str) -> Dict[str, Any]:
        """
        Get user memory, creating with defaults if it doesn't exist.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(AIUserMemoryDB).where(AIUserMemoryDB.user_id == user_id)
            )
            memory = result.scalars().first()
            
            if not memory:
                # Create default memory
                memory = AIUserMemoryDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    default_time_window_days=DEFAULT_MEMORY["default_time_window_days"],
                    preferred_response_style=DEFAULT_MEMORY["preferred_response_style"],
                )
                session.add(memory)
                await session.commit()
                await session.refresh(memory)
            
            return self._serialize_memory(memory)
    
    async def update_user_memory(
        self,
        user_id: str,
        updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Update user memory with partial updates.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(AIUserMemoryDB).where(AIUserMemoryDB.user_id == user_id)
            )
            memory = result.scalars().first()
            
            if not memory:
                # Create with defaults + updates
                memory = AIUserMemoryDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    default_time_window_days=updates.get("default_time_window_days", DEFAULT_MEMORY["default_time_window_days"]),
                    preferred_timezone=updates.get("preferred_timezone"),
                    preferred_response_style=updates.get("preferred_response_style", DEFAULT_MEMORY["preferred_response_style"]),
                    preferred_units=json.dumps(updates.get("preferred_units")) if updates.get("preferred_units") else None,
                    preferred_focus_habits=json.dumps(updates.get("preferred_focus_habits")) if updates.get("preferred_focus_habits") else None,
                )
                session.add(memory)
            else:
                # Apply updates
                if "default_time_window_days" in updates:
                    memory.default_time_window_days = updates["default_time_window_days"]
                if "preferred_timezone" in updates:
                    memory.preferred_timezone = updates["preferred_timezone"]
                if "preferred_response_style" in updates:
                    memory.preferred_response_style = updates["preferred_response_style"]
                if "preferred_units" in updates:
                    memory.preferred_units = json.dumps(updates["preferred_units"]) if updates["preferred_units"] else None
                if "preferred_focus_habits" in updates:
                    memory.preferred_focus_habits = json.dumps(updates["preferred_focus_habits"]) if updates["preferred_focus_habits"] else None
                
                memory.updated_at = datetime.utcnow()
            
            await session.commit()
            await session.refresh(memory)
            
            return self._serialize_memory(memory)
    
    async def get_conversation_memory_overrides(
        self,
        conversation_id: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get memory overrides for a specific conversation.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(AIConversationDB).where(
                    and_(
                        AIConversationDB.id == conversation_id,
                        AIConversationDB.user_id == user_id
                    )
                )
            )
            conversation = result.scalars().first()
            
            if not conversation:
                return None
            
            if conversation.memory_overrides:
                try:
                    return json.loads(conversation.memory_overrides)
                except json.JSONDecodeError:
                    return None
            
            return None
    
    async def update_conversation_memory_overrides(
        self,
        conversation_id: str,
        user_id: str,
        overrides: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Update memory overrides for a specific conversation (merge with existing).
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(AIConversationDB).where(
                    and_(
                        AIConversationDB.id == conversation_id,
                        AIConversationDB.user_id == user_id
                    )
                )
            )
            conversation = result.scalars().first()
            
            if not conversation:
                return None
            
            # Merge with existing overrides
            existing = {}
            if conversation.memory_overrides:
                try:
                    existing = json.loads(conversation.memory_overrides)
                except json.JSONDecodeError:
                    pass
            
            merged = {**existing, **overrides}
            conversation.memory_overrides = json.dumps(merged)
            conversation.updated_at = datetime.utcnow()
            
            await session.commit()
            
            return merged
    
    async def get_effective_memory(
        self,
        user_id: str,
        conversation_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get the effective memory for a user/conversation.
        Conversation overrides take precedence over user memory.
        """
        # Get user memory
        user_memory = await self.get_user_memory(user_id)
        
        # If no conversation, return user memory
        if not conversation_id:
            return user_memory
        
        # Get conversation overrides
        overrides = await self.get_conversation_memory_overrides(conversation_id, user_id)
        
        if not overrides:
            return user_memory
        
        # Merge: overrides win
        effective = {**user_memory}
        for key, value in overrides.items():
            if value is not None:
                effective[key] = value
        
        return effective
    
    def _serialize_memory(self, memory: AIUserMemoryDB) -> Dict[str, Any]:
        """Serialize memory to dict."""
        preferred_units = None
        if memory.preferred_units:
            try:
                preferred_units = json.loads(memory.preferred_units)
            except json.JSONDecodeError:
                pass
        
        preferred_focus_habits = None
        if memory.preferred_focus_habits:
            try:
                preferred_focus_habits = json.loads(memory.preferred_focus_habits)
            except json.JSONDecodeError:
                pass
        
        return {
            "id": memory.id,
            "user_id": memory.user_id,
            "default_time_window_days": memory.default_time_window_days,
            "preferred_timezone": memory.preferred_timezone,
            "preferred_response_style": memory.preferred_response_style,
            "preferred_units": preferred_units,
            "preferred_focus_habits": preferred_focus_habits,
            "created_at": memory.created_at.isoformat() if memory.created_at else None,
            "updated_at": memory.updated_at.isoformat() if memory.updated_at else None,
        }


# Singleton instance
memory_service = MemoryService()

