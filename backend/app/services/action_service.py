"""
Service for action-related operations (command palette)
"""

import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional

from app.models.action import (
    ActionCreate,
    ActionUpdate,
    ActionResponse,
    ActionType,
    CommandPaletteItem,
    CommandPaletteResponse
)
from app.models.habit import HabitCategory
from app.services import habit_service

# TODO: Replace this with actual database
# Mock database for actions (will be replaced with real database)
_actions_db: Dict[str, Dict[str, Any]] = {}
_user_favorites: Dict[str, List[str]] = {}  # user_id -> list of action_ids
_user_recent: Dict[str, List[Dict[str, Any]]] = {}  # user_id -> list of {action_id, timestamp}

# System default actions
_default_actions = [
    {
        "id": "start_focus_session",
        "name": "Start focus session",
        "type": ActionType.FOCUS,
        "emoji": "⏱️",
        "shortcut": "F",
        "description": "Start a focused work session",
        "is_system": True,
        "metadata": {"duration_minutes": 25}
    },
    {
        "id": "view_habit_analytics",
        "name": "View habit analytics",
        "type": ActionType.QUICK_ACTION,
        "emoji": "📊",
        "shortcut": "B",
        "description": "View analytics for your habits",
        "is_system": True,
        "metadata": {}
    },
    {
        "id": "time_block",
        "name": "Time block",
        "type": ActionType.QUICK_ACTION,
        "emoji": "📅",
        "shortcut": "B", 
        "description": "Plan your day with time blocks",
        "is_system": True,
        "metadata": {}
    },
    {
        "id": "configure_wearables",
        "name": "Configure wearables",
        "type": ActionType.QUICK_ACTION,
        "emoji": "⌚",
        "description": "Set up your wearable devices",
        "is_system": True,
        "metadata": {}
    },
    {
        "id": "add_custom_habit",
        "name": "Add custom habit",
        "type": ActionType.QUICK_ACTION,
        "emoji": "➕",
        "description": "Create a new custom habit",
        "is_system": True,
        "metadata": {}
    }
]

async def initialize_system_actions():
    """
    Initialize the default system actions
    """
    for action in _default_actions:
        action_id = action["id"]
        if action_id not in _actions_db:
            now = datetime.now()
            action.update({
                "created_at": now,
                "updated_at": now,
                "usage_count": 0
            })
            _actions_db[action_id] = action

async def get_actions(user_id: Optional[str] = None) -> List[ActionResponse]:
    """
    Get all actions, optionally filtered by user_id
    """
    filtered_actions = []
    
    for action_id, action_data in _actions_db.items():
        # Include system actions and user-specific actions
        if action_data.get("is_system", False) or action_data.get("user_id") == user_id:
            filtered_actions.append(ActionResponse(**action_data))
    
    return filtered_actions

async def get_action(action_id: str) -> ActionResponse:
    """
    Get a specific action by ID
    """
    if action_id not in _actions_db:
        raise ValueError(f"Action with ID {action_id} not found")
    
    return ActionResponse(**_actions_db[action_id])

async def create_action(user_id: str, action_data: ActionCreate) -> ActionResponse:
    """
    Create a new action for a user
    """
    action_id = str(uuid.uuid4())
    now = datetime.now()
    
    # Prepare action data
    action_dict = action_data.dict()
    action_dict.update({
        "id": action_id,
        "user_id": user_id,
        "created_at": now,
        "updated_at": now,
        "usage_count": 0,
        "is_favorite": False,
        "is_system": False
    })
    
    # Save to mock database
    _actions_db[action_id] = action_dict
    
    return ActionResponse(**action_dict)

async def update_action(action_id: str, action_data: ActionUpdate) -> ActionResponse:
    """
    Update an existing action
    """
    if action_id not in _actions_db:
        raise ValueError(f"Action with ID {action_id} not found")
    
    # Get existing action data
    existing_action = _actions_db[action_id]
    
    # Don't allow modifying system actions (except for favorites)
    if existing_action.get("is_system", False):
        # Only allow updating is_favorite for system actions
        return ActionResponse(**existing_action)
    
    # Update fields
    update_dict = action_data.dict(exclude_unset=True)
    existing_action.update(update_dict)
    existing_action["updated_at"] = datetime.now()
    
    return ActionResponse(**existing_action)

async def delete_action(action_id: str) -> Dict[str, Any]:
    """
    Delete an action
    """
    if action_id not in _actions_db:
        raise ValueError(f"Action with ID {action_id} not found")
    
    # Don't allow deleting system actions
    if _actions_db[action_id].get("is_system", False):
        raise ValueError("Cannot delete system actions")
    
    # Remove from mock database
    del _actions_db[action_id]
    
    # Remove from favorites and recent lists
    for user_id in _user_favorites:
        if action_id in _user_favorites[user_id]:
            _user_favorites[user_id].remove(action_id)
    
    for user_id in _user_recent:
        _user_recent[user_id] = [item for item in _user_recent[user_id] if item["action_id"] != action_id]
    
    return {"success": True, "message": f"Action {action_id} deleted"}

async def toggle_favorite(user_id: str, action_id: str) -> Dict[str, bool]:
    """
    Toggle whether an action is favorited by the user
    """
    if action_id not in _actions_db:
        raise ValueError(f"Action with ID {action_id} not found")
    
    # Initialize user favorites if not exists
    if user_id not in _user_favorites:
        _user_favorites[user_id] = []
    
    # Toggle favorite
    is_favorite = action_id in _user_favorites[user_id]
    if is_favorite:
        _user_favorites[user_id].remove(action_id)
    else:
        _user_favorites[user_id].append(action_id)
    
    return {"is_favorite": not is_favorite}

async def record_action_usage(user_id: str, action_id: str) -> Dict[str, Any]:
    """
    Record that a user used an action
    """
    if action_id not in _actions_db:
        raise ValueError(f"Action with ID {action_id} not found")
    
    # Increment usage count
    _actions_db[action_id]["usage_count"] += 1
    
    # Initialize user recent if not exists
    if user_id not in _user_recent:
        _user_recent[user_id] = []
    
    # Add to recent (or update timestamp if exists)
    now = datetime.now()
    for item in _user_recent[user_id]:
        if item["action_id"] == action_id:
            item["timestamp"] = now
            break
    else:
        _user_recent[user_id].append({"action_id": action_id, "timestamp": now})
    
    # Sort recent by timestamp and keep only the last 10
    _user_recent[user_id] = sorted(
        _user_recent[user_id], 
        key=lambda x: x["timestamp"], 
        reverse=True
    )[:10]
    
    return {"success": True, "usage_count": _actions_db[action_id]["usage_count"]}

async def get_command_palette_data(user_id: str) -> CommandPaletteResponse:
    """
    Get all data needed for the command palette
    """
    # Initialize system actions if needed
    await initialize_system_actions()
    
    # Get actions including system actions
    all_actions = await get_actions(user_id)
    
    # Get habits by category
    habits_by_category = {}
    for category in HabitCategory:
        habits = await habit_service.get_habits_by_category(user_id, category)
        if habits:
            category_name = category.value
            habits_by_category[category_name] = [
                CommandPaletteItem(
                    id=habit.id,
                    name=habit.name,
                    type="habit",
                    emoji=habit.emoji,
                    icon=habit.icon,
                    description=habit.description,
                    category=category_name,
                    metadata={
                        "streak": habit.streak,
                        "total_completions": habit.total_completions
                    }
                )
                for habit in habits
            ]
    
    # Get quick actions (system + user)
    quick_actions = [
        CommandPaletteItem(
            id=action.id,
            name=action.name,
            type=action.type,
            emoji=action.emoji,
            icon=action.icon,
            description=action.description,
            shortcut=action.shortcut,
            category=action.category,
            metadata=action.metadata,
            usage_count=action.usage_count,
            is_favorite=action.id in _user_favorites.get(user_id, [])
        )
        for action in all_actions
        if action.type == ActionType.QUICK_ACTION
    ]
    
    # Get favorites
    favorites = []
    for action in all_actions:
        if action.id in _user_favorites.get(user_id, []):
            favorites.append(
                CommandPaletteItem(
                    id=action.id,
                    name=action.name,
                    type=action.type,
                    emoji=action.emoji,
                    icon=action.icon,
                    description=action.description,
                    shortcut=action.shortcut,
                    category=action.category,
                    metadata=action.metadata,
                    usage_count=action.usage_count,
                    is_favorite=True
                )
            )
    
    # Get recent
    recent = []
    if user_id in _user_recent:
        for item in _user_recent[user_id]:
            action_id = item["action_id"]
            if action_id in _actions_db:
                action = _actions_db[action_id]
                recent.append(
                    CommandPaletteItem(
                        id=action["id"],
                        name=action["name"],
                        type=action["type"],
                        emoji=action.get("emoji"),
                        icon=action.get("icon"),
                        description=action.get("description"),
                        shortcut=action.get("shortcut"),
                        category=action.get("category"),
                        metadata=action.get("metadata", {}),
                        usage_count=action["usage_count"],
                        is_favorite=action["id"] in _user_favorites.get(user_id, [])
                    )
                )
    
    return CommandPaletteResponse(
        quick_actions=quick_actions,
        habits=habits_by_category,
        recent=recent,
        favorites=favorites
    ) 