"""
WebSocket Manager - Handles real-time connections
Replaces Supabase real-time subscriptions
"""

from fastapi import WebSocket
from typing import Dict, List
import json
import asyncio
import logging

logger = logging.getLogger(__name__)

class WebSocketManager:
    """Manages WebSocket connections for real-time updates"""
    
    def __init__(self):
        # Store active connections by user_id
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        
        self.active_connections[user_id].append(websocket)
        logger.info(f"✅ WebSocket connected for user: {user_id}")
    
    def disconnect(self, websocket: WebSocket, user_id: str):
        """Remove a WebSocket connection"""
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            
            # Clean up empty user entries
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        
        logger.error(f"❌ WebSocket disconnected for user: {user_id}")
    
    async def send_personal_message(self, message: str, user_id: str):
        """Send a message to a specific user"""
        if user_id in self.active_connections:
            # Send to all connections for this user (multiple tabs/devices)
            disconnected = []
            
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_text(message)
                except Exception:
                    # Connection is dead, mark for removal
                    disconnected.append(websocket)
            
            # Clean up dead connections
            for websocket in disconnected:
                self.disconnect(websocket, user_id)
    
    async def broadcast_to_user(self, data: dict, user_id: str):
        """Broadcast structured data to a user"""
        message = json.dumps(data)
        await self.send_personal_message(message, user_id)
    
    async def notify_habit_logged(self, habit_log: dict, user_id: str):
        """Notify user when a habit is logged (replaces Supabase real-time)"""
        await self.broadcast_to_user({
            "type": "habit_logged",
            "data": habit_log
        }, user_id)
    
    async def notify_habit_created(self, habit: dict, user_id: str):
        """Notify user when a habit is created"""
        await self.broadcast_to_user({
            "type": "habit_created", 
            "data": habit
        }, user_id)
    
    async def notify_habit_updated(self, habit: dict, user_id: str):
        """Notify user when a habit is updated"""
        await self.broadcast_to_user({
            "type": "habit_updated",
            "data": habit
        }, user_id)
    
    async def notify_habit_deleted(self, habit_id: str, user_id: str):
        """Notify user when a habit is deleted"""
        await self.broadcast_to_user({
            "type": "habit_deleted",
            "data": {"habit_id": habit_id}
        }, user_id)
    
    def get_connection_count(self, user_id: str = None) -> int:
        """Get connection count for a user or total"""
        if user_id:
            return len(self.active_connections.get(user_id, []))
        else:
            return sum(len(connections) for connections in self.active_connections.values())
