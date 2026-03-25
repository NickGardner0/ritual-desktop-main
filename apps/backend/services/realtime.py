"""Shared realtime manager singleton for backend websocket notifications."""

from services.websocket_manager import WebSocketManager

websocket_manager = WebSocketManager()
