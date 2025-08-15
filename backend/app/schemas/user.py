# app/schemas/user.py
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator
from uuid import UUID

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None

class UserCreate(UserBase):
    birth_year: Optional[int]
    gender: Optional[str]
    country: Optional[str]

class UserUpdate(UserBase):
    pass

class UserResponse(UserBase):
    id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    @field_validator('id', mode='before')
    @classmethod
    def convert_uuid_to_str(cls, value):
        """Convert UUID objects to strings"""
        if isinstance(value, UUID):
            return str(value)
        return value

    class Config:
        from_attributes = True


# app/schemas/subscription.py
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

class SubscriptionBase(BaseModel):
    plan: str
    status: str
    is_trial: bool = False
    start_date: datetime
    end_date: Optional[datetime] = None

class SubscriptionCreate(SubscriptionBase):
    pass

class SubscriptionResponse(SubscriptionBase):
    id: str
    user_id: str
    created_at: datetime

    class Config:
        from_attributes = True


# app/schemas/habit.py
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class HabitBase(BaseModel):
    name: str
    category: str
    integration_source: Optional[str] = None
    unit_type: Optional[str] = None
    is_custom: Optional[bool] = True

class HabitCreate(HabitBase):
    pass

class HabitResponse(HabitBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# app/schemas/habit_log.py
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel

class HabitLogBase(BaseModel):
    date: date
    duration: Optional[int] = None
    amount: Optional[float] = None
    unit: Optional[str] = None
    status: Optional[str] = 'completed'
    notes: Optional[str] = None

class HabitLogCreate(HabitLogBase):
    habit_id: str

class HabitLogResponse(HabitLogBase):
    id: str
    habit_id: str
    user_id: str
    created_at: datetime

    class Config:
        from_attributes = True


# app/schemas/habit_data_integration.py
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel

class HabitDataIntegrationBase(BaseModel):
    source: str
    metric_name: str
    value: float
    unit: Optional[str] = None
    timestamp: datetime
    metadata: Optional[Dict[str, Any]] = None

class HabitDataIntegrationCreate(HabitDataIntegrationBase):
    habit_id: str

class HabitDataIntegrationResponse(HabitDataIntegrationBase):
    id: str
    habit_id: str
    user_id: str

    class Config:
        from_attributes = True


# app/schemas/habit_unit.py
from datetime import datetime
from typing import List
from pydantic import BaseModel

class HabitUnitBase(BaseModel):
    type: str
    default_unit: str
    allowed_units: List[str]

class HabitUnitCreate(HabitUnitBase):
    pass

class HabitUnitResponse(HabitUnitBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True


# app/schemas/predefined_habit.py
from datetime import datetime
from pydantic import BaseModel

class PredefinedHabitBase(BaseModel):
    name: str
    type: str

class PredefinedHabitCreate(PredefinedHabitBase):
    pass

class PredefinedHabitResponse(PredefinedHabitBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True
