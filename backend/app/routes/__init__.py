"""
API routes and endpoints
"""

from .auth_router import router as auth_router
from .user import router as user_router
from .habit import router as habit_router
from .habit_log import router as habit_log_router
from .habit_data_integration import router as habit_data_router
from .subscription import router as subscription_router
from .predefined_habit import router as predefined_habit_router
from .habit_unit import router as habit_unit_router

all_routers = [
    (auth_router, "/auth"),
    (user_router, "/users"),
    (habit_router, "/habits"),
    (habit_log_router, "/habit-logs"),
    (habit_data_router, "/habit-data"),
    (subscription_router, "/subscriptions"),
    (predefined_habit_router, "/predefined-habits"),
    (habit_unit_router, "/habit-units"),
]
