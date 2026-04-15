"""
AI Conversation Service

Handles persistence and retrieval of AI chat conversations and messages.
"""

import uuid
import json
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_

from database.connection import get_db_session
from database.models import AIConversationDB, AIMessageDB, SmsPreferencesDB


class ConversationService:
    """
    Service for managing AI chat conversations and messages.
    """
    
    async def create_conversation(
        self, 
        user_id: str, 
        title: Optional[str] = None,
        response_mode: str = "text"
    ) -> Dict[str, Any]:
        """
        Create a new conversation for a user.
        """
        async with get_db_session() as session:
            conversation = AIConversationDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                title=title,
                response_mode=response_mode,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            session.add(conversation)
            await session.commit()
            
            return {
                "id": conversation.id,
                "user_id": conversation.user_id,
                "title": conversation.title,
                "response_mode": conversation.response_mode,
                "created_at": conversation.created_at.isoformat(),
                "updated_at": conversation.updated_at.isoformat(),
                "messages": []
            }
    
    async def get_conversation(self, conversation_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a specific conversation with all its messages.
        Only returns if the conversation belongs to the user.
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
            
            # Get messages
            messages_result = await session.execute(
                select(AIMessageDB)
                .where(AIMessageDB.conversation_id == conversation_id)
                .order_by(AIMessageDB.created_at)
            )
            messages = messages_result.scalars().all()
            
            return self._serialize_conversation(conversation, messages)
    
    async def get_latest_conversation(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Get the most recently updated conversation for a user.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(AIConversationDB)
                .where(AIConversationDB.user_id == user_id)
                .order_by(desc(AIConversationDB.updated_at))
                .limit(1)
            )
            conversation = result.scalars().first()
            
            if not conversation:
                return None
            
            # Get messages
            messages_result = await session.execute(
                select(AIMessageDB)
                .where(AIMessageDB.conversation_id == conversation.id)
                .order_by(AIMessageDB.created_at)
            )
            messages = messages_result.scalars().all()
            
            return self._serialize_conversation(conversation, messages)
    
    async def add_message(
        self,
        conversation_id: str,
        user_id: str,
        role: str,
        content: str,
        tool_payload: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Add a message to a conversation.
        Returns the created message or None if conversation doesn't exist/belong to user.
        """
        async with get_db_session() as session:
            # Verify conversation exists and belongs to user
            conv_result = await session.execute(
                select(AIConversationDB).where(
                    and_(
                        AIConversationDB.id == conversation_id,
                        AIConversationDB.user_id == user_id
                    )
                )
            )
            conversation = conv_result.scalars().first()
            
            if not conversation:
                return None
            
            # Create message
            message = AIMessageDB(
                id=str(uuid.uuid4()),
                conversation_id=conversation_id,
                role=role,
                content=content,
                tool_payload=json.dumps(tool_payload) if tool_payload else None,
                created_at=datetime.utcnow()
            )
            session.add(message)
            
            # Update conversation's updated_at
            conversation.updated_at = datetime.utcnow()
            
            await session.commit()

            try:
                from services.search_service import search_service

                await search_service.index_ai_message(
                    {
                        "id": message.id,
                        "conversation_id": conversation_id,
                        "role": role,
                        "content": content,
                        "created_at": message.created_at,
                    },
                    user_id,
                )
            except Exception:
                pass
            
            return self._serialize_message(message)
    
    async def update_conversation_title(
        self,
        conversation_id: str,
        user_id: str,
        title: str
    ) -> bool:
        """
        Update the title of a conversation.
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
                return False
            
            conversation.title = title
            conversation.updated_at = datetime.utcnow()
            await session.commit()
            
            return True
    
    async def update_response_mode(
        self,
        conversation_id: str,
        user_id: str,
        response_mode: str
    ) -> Optional[Dict[str, Any]]:
        """
        Update the response mode of a conversation.
        Returns the updated conversation or None if not found.
        """
        if response_mode not in ('text', 'voice'):
            return None
            
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
            
            conversation.response_mode = response_mode
            conversation.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(conversation)
            
            return {
                "id": conversation.id,
                "response_mode": conversation.response_mode,
                "updated_at": conversation.updated_at.isoformat()
            }
    
    async def get_response_mode(
        self,
        conversation_id: str,
        user_id: str
    ) -> str:
        """
        Get the response mode for a conversation.
        Returns 'text' as default if conversation not found.
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
                return "text"
            
            return conversation.response_mode or "text"
    
    async def delete_conversation(
        self,
        conversation_id: str,
        user_id: str
    ) -> bool:
        """
        Delete a conversation and all its messages.
        Returns True if deleted, False if not found or not owned by user.
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
                return False
            
            await session.delete(conversation)
            await session.commit()
            
            return True

    async def list_conversations(
        self,
        user_id: str,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        List conversations for a user with first message as title preview.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(AIConversationDB)
                .where(AIConversationDB.user_id == user_id)
                .order_by(desc(AIConversationDB.updated_at))
                .limit(limit)
            )
            conversations = result.scalars().all()
            
            conversation_list = []
            for c in conversations:
                # Get the first user message as the title preview
                first_msg_result = await session.execute(
                    select(AIMessageDB)
                    .where(
                        and_(
                            AIMessageDB.conversation_id == c.id,
                            AIMessageDB.role == 'user'
                        )
                    )
                    .order_by(AIMessageDB.created_at)
                    .limit(1)
                )
                first_msg = first_msg_result.scalars().first()
                
                conversation_list.append({
                    "id": c.id,
                    "title": c.title,
                    "first_message": first_msg.content if first_msg else None,
                    "created_at": c.created_at.isoformat(),
                    "updated_at": c.updated_at.isoformat()
                })
            
            return conversation_list
    
    async def find_or_create_sms_conversation(self, user_id: str) -> Dict[str, Any]:
        """
        Get the single SMS conversation for a user, creating it if it doesn't exist.
        Enforced by a partial unique index on (user_id) WHERE channel = 'sms'.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(AIConversationDB).where(
                    and_(
                        AIConversationDB.user_id == user_id,
                        AIConversationDB.channel == "sms",
                    )
                )
            )
            conversation = result.scalars().first()

            if conversation:
                return {
                    "id": conversation.id,
                    "user_id": conversation.user_id,
                    "channel": conversation.channel,
                    "created_at": conversation.created_at.isoformat(),
                }

            conversation = AIConversationDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                title="SMS Chat",
                response_mode="text",
                channel="sms",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(conversation)
            await session.commit()

            return {
                "id": conversation.id,
                "user_id": conversation.user_id,
                "channel": conversation.channel,
                "created_at": conversation.created_at.isoformat(),
            }

    async def get_sms_message_history(
        self, user_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Get recent messages from a user's SMS conversation for context.
        Returns messages in chronological order (oldest first).
        """
        async with get_db_session() as session:
            # Find the SMS conversation
            conv_result = await session.execute(
                select(AIConversationDB).where(
                    and_(
                        AIConversationDB.user_id == user_id,
                        AIConversationDB.channel == "sms",
                    )
                )
            )
            conversation = conv_result.scalars().first()

            if not conversation:
                return []

            # Get the most recent N messages, then reverse to chronological order
            messages_result = await session.execute(
                select(AIMessageDB)
                .where(AIMessageDB.conversation_id == conversation.id)
                .order_by(desc(AIMessageDB.created_at))
                .limit(limit)
            )
            messages = list(messages_result.scalars().all())
            messages.reverse()

            return [
                {
                    "role": m.role,
                    "content": m.content,
                    "created_at": m.created_at.isoformat(),
                }
                for m in messages
            ]

    async def add_internal_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        tool_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Add a message without user_id ownership check.
        Used by internal services (SMS webhook, proactive scheduler) where
        the caller has already verified identity.
        """
        async with get_db_session() as session:
            message = AIMessageDB(
                id=str(uuid.uuid4()),
                conversation_id=conversation_id,
                role=role,
                content=content,
                tool_payload=json.dumps(tool_payload) if tool_payload else None,
                created_at=datetime.utcnow(),
            )
            session.add(message)

            # Update conversation timestamp
            conv_result = await session.execute(
                select(AIConversationDB).where(
                    AIConversationDB.id == conversation_id
                )
            )
            conversation = conv_result.scalars().first()
            if conversation:
                conversation.updated_at = datetime.utcnow()

            await session.commit()

            return self._serialize_message(message)

    def _serialize_conversation(
        self,
        conversation: AIConversationDB,
        messages: List[AIMessageDB]
    ) -> Dict[str, Any]:
        """Serialize a conversation with its messages."""
        return {
            "id": conversation.id,
            "user_id": conversation.user_id,
            "title": conversation.title,
            "response_mode": conversation.response_mode or "text",
            "created_at": conversation.created_at.isoformat(),
            "updated_at": conversation.updated_at.isoformat(),
            "messages": [self._serialize_message(m) for m in messages]
        }
    
    def _serialize_message(self, message: AIMessageDB) -> Dict[str, Any]:
        """Serialize a message."""
        tool_payload = None
        if message.tool_payload:
            try:
                tool_payload = json.loads(message.tool_payload)
            except json.JSONDecodeError:
                pass
        
        return {
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "tool_payload": tool_payload,
            "created_at": message.created_at.isoformat()
        }


# Singleton instance
conversation_service = ConversationService()
