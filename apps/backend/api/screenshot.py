"""Screenshot and migration API router extracted from main.py."""

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel

from models.habit_models import HabitCreate, HabitLogCreate
from services.screenshot_analyzer import analyze_screenshot_for_habits

logger = logging.getLogger(__name__)


def create_screenshot_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
    habits_service: Any,
) -> APIRouter:
    router = APIRouter(tags=["screenshot"])

    # SCREENSHOT ANALYSIS ENDPOINTS - Smart screenshot upload for any habit
    # ================================
    
    @router.post("/api/screenshot/analyze")
    @limiter.limit("10/minute")  # Max 10 screenshot uploads per minute
    async def analyze_and_log_screenshot(
        request: Request,
        file: UploadFile = File(...),
        current_user = Depends(get_current_user),
    ):
        """
        Upload a screenshot and intelligently detect which habit to update.
        Uses OpenAI vision to analyze the screenshot and determine:
        - What type of data it contains (screen time, meetings, workouts, etc.)
        - Which habit it should update
        - What value to extract
        
        Returns:
            - habit_id: The ID of the matched/created habit
            - habit_name: Name of the habit
            - value: The extracted value
            - unit: The unit of the value
            - description: What was detected
            - logged_at: When the log was created
        """
        try:
            # Validate file type
            if not file.content_type or not file.content_type.startswith("image/"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Uploaded file must be an image (PNG, JPG, etc.)",
                )
            
            # Read image bytes
            image_bytes = await file.read()
            
            if len(image_bytes) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Uploaded file is empty",
                )
            
            if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="File size exceeds 10MB limit",
                )
            
            logger.info(f"📸 Analyzing screenshot for user {current_user['id']} ({len(image_bytes)} bytes)")
            
            # Get user's existing habits
            user_habits = await habits_service.get_habits(current_user["id"])
            habits_for_analysis = [
                {"id": h.id, "name": h.name, "unit_type": h.unit_type}
                for h in user_habits
            ]
            
            logger.info(f"📋 User has {len(habits_for_analysis)} habits to match against")
            
            # Analyze screenshot using OpenAI vision
            analysis = analyze_screenshot_for_habits(image_bytes, habits_for_analysis)
            
            if analysis is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Could not extract useful data from this screenshot. "
                        "Please make sure the screenshot clearly shows trackable data like "
                        "screen time, workout stats, reading progress, meeting times, etc."
                    ),
                )
            
            logger.info(f"✅ Analysis result: {analysis}")
            
            habit_id = analysis.get("habit_id")
            habit_name = analysis.get("habit_name", "Unknown")
            value = analysis.get("value")
            unit = analysis.get("unit", "Count")
            
            # If no habit matched, create a new one
            if not habit_id:
                logger.info(f"🆕 Creating new habit: {habit_name}")
                
                # Determine category based on detected type
                detected_type = analysis.get("detected_type", "other")
                category_map = {
                    "screen_time": "wellness",
                    "meetings": "productivity", 
                    "workout": "health",
                    "reading": "learning",
                    "sleep": "health",
                    "meditation": "wellness",
                    "steps": "health",
                    "distance": "health",
                }
                category = category_map.get(detected_type, "other")
                
                new_habit = await habits_service.create_habit(
                    HabitCreate(
                        name=habit_name,
                        category=category,
                        unit_type=unit,
                        is_custom=True,
                        integration_source="screenshot",
                    ),
                    current_user["id"]
                )
                habit_id = new_habit.id
                habit_name = new_habit.name
                logger.info(f"✅ Created new habit: {habit_name} ({habit_id})")
            
            # Get the habit to verify it exists
            habit = await habits_service.get_habit_by_id(habit_id, current_user["id"])
            if not habit:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Habit not found: {habit_id}",
                )
            
            # Convert value to appropriate format for logging
            # For time-based habits, we might need to convert
            duration = None
            amount = value
            
            habit_unit = (habit.unit_type or "").lower()
            if "hour" in habit_unit:
                # Store as amount in hours
                if unit.lower() == "minutes":
                    amount = value / 60  # Convert minutes to hours
            elif "minute" in habit_unit:
                # Store as amount in minutes
                if unit.lower() == "hours":
                    amount = value * 60  # Convert hours to minutes
            
            # Log the habit
            from datetime import datetime, timezone
            logged_at = datetime.now(timezone.utc)
            date_str = logged_at.strftime("%Y-%m-%d")
            
            log_data = HabitLogCreate(
                duration=duration,
                amount=amount,
                date=date_str,
                completed_at=logged_at.isoformat(),
                status="completed",
                notes=f"Logged via screenshot: {analysis.get('description', '')}",
            )
            
            habit_log = await habits_service.log_habit(habit_id, log_data, current_user["id"])
            
            # Format display value
            display_value = f"{amount:.1f}" if isinstance(amount, float) else str(amount)
            
            return {
                "success": True,
                "habit_id": habit_id,
                "habit_name": habit_name,
                "value": amount,
                "unit": habit.unit_type or unit,
                "description": analysis.get("description", ""),
                "detected_type": analysis.get("detected_type", "other"),
                "confidence": analysis.get("confidence", 0.5),
                "logged_at": logged_at.isoformat(),
                "message": f"Successfully logged {display_value} {habit.unit_type or unit} of {habit_name}.",
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Screenshot analysis error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # ================================
    # SCREENSHOT PREVIEW & CONFIRM ENDPOINTS (User Confirmation Flow)
    # ================================
    
    @router.post("/api/screenshot/preview")
    @limiter.limit("10/minute")
    async def preview_screenshot_analysis(
        request: Request,
        file: UploadFile = File(...),
        current_user = Depends(get_current_user),
    ):
        """
        Analyze a screenshot and return preview data WITHOUT logging.
        User can review and confirm before the data is actually logged.
        
        Returns:
            - requires_confirmation: True (always for this endpoint)
            - habit_id: The ID of the matched habit (or None if new)
            - habit_name: Name of the habit
            - value: The extracted value
            - unit: The unit of the value
            - confidence: How confident the AI is (0-1)
            - validation: Whether the value passes sanity checks
            - available_habits: List of user's habits for selection
        """
        try:
            # Validate file type
            if not file.content_type or not file.content_type.startswith("image/"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Uploaded file must be an image (PNG, JPG, etc.)",
                )
            
            # Read image bytes
            image_bytes = await file.read()
            
            if len(image_bytes) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Uploaded file is empty",
                )
            
            if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="File size exceeds 10MB limit",
                )
            
            logger.info(f"📸 Preview analyzing screenshot for user {current_user['id']} ({len(image_bytes)} bytes)")
            
            # Get user's existing habits
            user_habits = await habits_service.get_habits(current_user["id"])
            habits_for_analysis = [
                {"id": h.id, "name": h.name, "unit_type": h.unit_type}
                for h in user_habits
            ]
            
            logger.info(f"📋 User has {len(habits_for_analysis)} habits to match against")
            
            # Analyze screenshot using OpenAI vision
            analysis = analyze_screenshot_for_habits(image_bytes, habits_for_analysis)
            
            if analysis is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Could not extract useful data from this screenshot. "
                        "Please make sure the screenshot clearly shows trackable data like "
                        "screen time, workout stats, reading progress, meeting times, etc."
                    ),
                )
            
            logger.info(f"✅ Preview analysis result: {analysis}")
            
            # Check confidence threshold
            confidence = analysis.get("confidence", 0.5)
            low_confidence = confidence < 0.6
            
            # Get validation info
            validation = analysis.get("validation", {"is_valid": True})
            
            return {
                "requires_confirmation": True,
                "habit_id": analysis.get("habit_id"),
                "habit_name": analysis.get("habit_name", "Unknown"),
                "value": analysis.get("value"),
                "unit": analysis.get("unit", "Count"),
                "description": analysis.get("description", ""),
                "detected_type": analysis.get("detected_type", "other"),
                "raw_text": analysis.get("raw_text", ""),
                "confidence": confidence,
                "low_confidence": low_confidence,
                "validation": validation,
                "is_new_habit": analysis.get("habit_id") is None,
                "available_habits": [
                    {"id": h.id, "name": h.name, "unit_type": h.unit_type}
                    for h in user_habits
                ],
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Screenshot preview error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    class ScreenshotConfirmRequest(BaseModel):
        habit_id: Optional[str] = None  # None if creating new habit
        habit_name: str
        value: float
        unit: str
        detected_type: str = "other"
        description: str = ""
        create_new_habit: bool = False
    
    
    @router.post("/api/screenshot/confirm")
    async def confirm_screenshot_log(
        request: ScreenshotConfirmRequest,
        current_user = Depends(get_current_user),
    ):
        """
        Confirm and log the screenshot analysis after user review.
        User can modify the value, habit, or unit before confirming.
        """
        try:
            from datetime import datetime, timezone
            
            habit_id = request.habit_id
            habit_name = request.habit_name
            value = request.value
            unit = request.unit
            
            # If no habit_id or create_new_habit is True, create a new habit
            if not habit_id or request.create_new_habit:
                logger.info(f"🆕 Creating new habit: {habit_name}")
                
                # Determine category based on detected type
                category_map = {
                    "screen_time": "wellness",
                    "meetings": "productivity", 
                    "workout": "health",
                    "reading": "learning",
                    "sleep": "health",
                    "meditation": "wellness",
                    "steps": "health",
                    "distance": "health",
                }
                category = category_map.get(request.detected_type, "other")
                
                new_habit = await habits_service.create_habit(
                    HabitCreate(
                        name=habit_name,
                        category=category,
                        unit_type=unit,
                        is_custom=True,
                        integration_source="screenshot",
                    ),
                    current_user["id"]
                )
                habit_id = new_habit.id
                habit_name = new_habit.name
                logger.info(f"✅ Created new habit: {habit_name} ({habit_id})")
            
            # Get the habit to verify it exists
            habit = await habits_service.get_habit_by_id(habit_id, current_user["id"])
            if not habit:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Habit not found: {habit_id}",
                )
            
            # Convert value to appropriate format for logging
            duration = None
            amount = value
            
            habit_unit = (habit.unit_type or "").lower()
            if "hour" in habit_unit:
                if unit.lower() == "minutes":
                    amount = value / 60
            elif "minute" in habit_unit:
                if unit.lower() == "hours":
                    amount = value * 60
            
            # Log the habit
            logged_at = datetime.now(timezone.utc)
            date_str = logged_at.strftime("%Y-%m-%d")
            
            log_data = HabitLogCreate(
                duration=duration,
                amount=amount,
                date=date_str,
                completed_at=logged_at.isoformat(),
                status="completed",
                notes=f"Logged via screenshot: {request.description}",
            )
            
            habit_log = await habits_service.log_habit(habit_id, log_data, current_user["id"])
            
            # Format display value
            display_value = f"{amount:.1f}" if isinstance(amount, float) else str(amount)
            
            return {
                "success": True,
                "habit_id": habit_id,
                "habit_name": habit_name,
                "value": amount,
                "unit": habit.unit_type or unit,
                "description": request.description,
                "detected_type": request.detected_type,
                "logged_at": logged_at.isoformat(),
                "message": f"Successfully logged {display_value} {habit.unit_type or unit} of {habit_name}.",
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Screenshot confirm error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    return router
