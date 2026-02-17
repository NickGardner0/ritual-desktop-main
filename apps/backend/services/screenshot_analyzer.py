"""
Screenshot Analyzer Service

Uses Gemini Flash (primary) or OpenAI (fallback) to analyze screenshots and extract habit data.
Gemini Flash is ~3x faster than GPT-4o-mini for vision tasks.

Can detect various types of data: screen time, meetings, workouts, reading, etc.
"""

import base64
import json
import os
import time
from typing import Optional, List, Dict, Any

# Try to import Gemini first (primary), OpenAI as fallback
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    print("⚠️ google-generativeai not installed, falling back to OpenAI")

from openai import OpenAI


class ScreenshotAnalysisError(Exception):
    """Custom exception for screenshot analysis errors"""
    def __init__(self, message: str, code: str = "ANALYSIS_ERROR"):
        self.message = message
        self.code = code
        super().__init__(self.message)


def _get_gemini_model():
    """
    Get Gemini Flash model for fast vision analysis.
    Uses gemini-2.0-flash (fastest, best quality, Tier 1 billing).
    """
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("⚠️ No GEMINI_API_KEY found, will use OpenAI fallback")
        return None
    
    print(f"✅ Gemini API key found (starts with: {api_key[:10]}...)")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-2.0-flash")


def _get_openai_client() -> OpenAI:
    """
    Get OpenAI client as fallback.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ScreenshotAnalysisError(
            "Screenshot import requires an API key. "
            "Please set GEMINI_API_KEY or OPENAI_API_KEY environment variable.",
            code="API_KEY_MISSING"
        )
    return OpenAI(api_key=api_key)


# Default minimum confidence threshold
DEFAULT_MIN_CONFIDENCE = 0.75


def _build_analysis_prompt(habits_list: str) -> str:
    """Build the analysis prompt for both Gemini and OpenAI."""
    return f"""You are an AI assistant that analyzes screenshots to extract habit/activity data.

The user has the following habits they track:
{habits_list}

Your task:
1. Analyze the screenshot to understand what data it shows
2. Extract a meaningful metric value from the screenshot
3. Match it to one of the user's existing habits if possible, or suggest a new habit name

Common screenshot types you might see:
- Apple Screen Time (iOS/macOS) → extract total screen time for today
- Calendar/meeting apps → count meetings or total meeting time
- Fitness apps (Apple Health, Strava, etc.) → extract workout duration, steps, distance
- Reading apps (Kindle, Apple Books) → extract pages read or reading time
- Sleep tracking → extract sleep duration
- Meditation apps → extract meditation time
- Any app showing tracked metrics

Rules:
- Focus on TODAY's data if multiple days are shown
- Return the most relevant single metric
- If you recognize an app but can't extract a clear value, return null
- Match to existing habits by meaning, not exact name (e.g., "Daily Reading" matches reading data)
- For time values, convert to the habit's expected unit (Hours or Minutes)

Return ONLY valid JSON in this exact format:
{{
  "detected_type": "screen_time|meetings|workout|reading|sleep|meditation|steps|distance|other",
  "habit_match": {{
    "habit_id": "uuid-if-matched-or-null",
    "habit_name": "matched or suggested habit name",
    "confidence": 0.0-1.0
  }},
  "extracted_value": {{
    "value": number,
    "unit": "Hours|Minutes|Pages|Steps|Miles|Count|etc",
    "raw_text": "what you read from the screenshot"
  }},
  "description": "Brief description of what was detected"
}}

If you cannot extract useful data, return:
{{"error": "reason why extraction failed"}}
"""


def _analyze_with_gemini(
    image_bytes: bytes,
    prompt: str,
    available_habits: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Analyze screenshot using Gemini Flash (faster than OpenAI).
    """
    model = _get_gemini_model()
    if not model:
        return None
    
    start_time = time.time()
    
    try:
        # Gemini accepts image bytes directly
        import PIL.Image
        import io
        
        image = PIL.Image.open(io.BytesIO(image_bytes))
        
        response = model.generate_content(
            [prompt, image],
            generation_config=genai.types.GenerationConfig(
                temperature=0.0,
                max_output_tokens=500,
            ),
        )
        
        elapsed = time.time() - start_time
        raw_content = response.text
        print(f"🚀 Gemini Flash response ({elapsed:.2f}s): {raw_content}")
        
        return _parse_analysis_response(raw_content, available_habits)
        
    except Exception as e:
        import traceback
        print(f"⚠️ Gemini analysis failed: {e}")
        print(f"   Error type: {type(e).__name__}")
        print(f"   Traceback: {traceback.format_exc()}")
        print("   Falling back to OpenAI...")
        return None


def _analyze_with_openai(
    image_bytes: bytes,
    prompt: str,
    available_habits: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Analyze screenshot using OpenAI GPT-4o-mini (fallback).
    """
    client = _get_openai_client()
    
    start_time = time.time()
    
    # Encode as base64
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{b64}"
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": prompt,
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Analyze this screenshot and extract any habit/activity data. Return JSON only.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                },
            ],
            temperature=0.0,
            max_tokens=500,
        )

        elapsed = time.time() - start_time
        raw_content = completion.choices[0].message.content
        print(f"🔍 OpenAI vision response ({elapsed:.2f}s): {raw_content}")
        
        return _parse_analysis_response(raw_content, available_habits)
        
    except Exception as e:
        print(f"❌ OpenAI vision API error: {e}")
        raise ScreenshotAnalysisError(
            f"Failed to analyze screenshot: {str(e)}",
            code="ANALYSIS_FAILED"
        )


def analyze_screenshot_for_habits(
    image_bytes: bytes, 
    available_habits: List[Dict[str, Any]],
    min_confidence: float = DEFAULT_MIN_CONFIDENCE
) -> Optional[Dict[str, Any]]:
    """
    Analyzes a screenshot and extracts habit data.
    
    Uses Gemini Flash (primary, ~2-3s) with OpenAI fallback (~6s).
    
    Args:
        image_bytes: Raw bytes of the screenshot image
        available_habits: List of user's habits with their names and units
        min_confidence: Minimum confidence threshold (0-1). Results below this
                       will be flagged as low confidence.
        
    Returns:
        Dict with:
        - habit_name: Name of the matched habit (or suggested new habit)
        - habit_id: ID of the matched habit (or None if new)
        - value: The extracted numeric value
        - unit: The unit of the value
        - confidence: How confident the model is (0-1)
        - low_confidence: True if confidence is below threshold
        - description: What was detected in the screenshot
        
        Returns None if nothing useful could be extracted.
        
    Raises:
        ScreenshotAnalysisError: If API keys are missing or analysis fails
    """
    # Build list of available habits for the prompt
    habits_list = "\n".join([
        f"- {h['name']} (unit: {h.get('unit_type', 'unknown')}, id: {h['id']})"
        for h in available_habits
    ])
    
    prompt = _build_analysis_prompt(habits_list)
    
    result = None
    
    # Try Gemini Flash first (faster)
    if GEMINI_AVAILABLE:
        result = _analyze_with_gemini(image_bytes, prompt, available_habits)
    
    # Fall back to OpenAI if Gemini failed or isn't available
    if result is None:
        result = _analyze_with_openai(image_bytes, prompt, available_habits)
    
    # Add confidence gating
    if result:
        confidence = result.get("confidence", 0.5)
        result["low_confidence"] = confidence < min_confidence
        result["min_confidence_threshold"] = min_confidence
    
    return result


def _parse_analysis_response(
    raw_content: str, 
    available_habits: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Parse the OpenAI response and structure the result.
    """
    if not raw_content:
        return None
        
    raw_content = raw_content.strip()
    
    # Try to extract JSON from the response
    json_data = None
    
    # Try direct parse
    try:
        json_data = json.loads(raw_content)
    except json.JSONDecodeError:
        pass
    
    # Try extracting from markdown code block
    if not json_data:
        try:
            import re
            code_block_match = re.search(r'```(?:json)?\s*(\{[\s\S]+?\})\s*```', raw_content)
            if code_block_match:
                json_data = json.loads(code_block_match.group(1))
        except Exception:
            pass
    
    # Try finding JSON object
    if not json_data:
        try:
            start = raw_content.find("{")
            end = raw_content.rfind("}") + 1
            if start != -1 and end > start:
                json_data = json.loads(raw_content[start:end])
        except Exception:
            pass
    
    if not json_data:
        print(f"⚠️ Could not parse JSON from response: {raw_content}")
        return None
    
    # Check for error response
    if "error" in json_data:
        print(f"⚠️ Model returned error: {json_data['error']}")
        return None
    
    # Validate required fields
    if not json_data.get("extracted_value") or not json_data.get("habit_match"):
        print(f"⚠️ Missing required fields in response")
        return None
    
    extracted = json_data["extracted_value"]
    habit_match = json_data["habit_match"]
    
    if extracted.get("value") is None:
        print(f"⚠️ No value extracted")
        return None
    
    # Build result
    result = {
        "detected_type": json_data.get("detected_type", "other"),
        "habit_id": habit_match.get("habit_id"),
        "habit_name": habit_match.get("habit_name"),
        "confidence": habit_match.get("confidence", 0.5),
        "value": float(extracted["value"]),
        "unit": extracted.get("unit", "Count"),
        "raw_text": extracted.get("raw_text", ""),
        "description": json_data.get("description", ""),
    }
    
    # If habit_id is "null" string, convert to None
    if result["habit_id"] == "null" or result["habit_id"] == "":
        result["habit_id"] = None
    
    # Try to find habit by name if no ID was matched
    if not result["habit_id"] and result["habit_name"]:
        for habit in available_habits:
            if habit["name"].lower() == result["habit_name"].lower():
                result["habit_id"] = habit["id"]
                break
            # Fuzzy match
            if result["habit_name"].lower() in habit["name"].lower() or \
               habit["name"].lower() in result["habit_name"].lower():
                result["habit_id"] = habit["id"]
                break
    
    # Validate the extracted value
    validation = _validate_extracted_value(
        result["value"], 
        result["unit"], 
        result["detected_type"]
    )
    result["validation"] = validation
    
    if not validation["is_valid"]:
        print(f"⚠️ Value validation failed: {validation['reason']}")
        result["validation_warning"] = validation["reason"]
    
    return result


def _validate_extracted_value(value: float, unit: str, detected_type: str) -> Dict[str, Any]:
    """
    Validate that the extracted value is within reasonable bounds.
    Returns validation result with is_valid flag and reason.
    """
    # Define reasonable limits for different types
    VALUE_LIMITS = {
        "screen_time": {
            "Hours": (0, 24),
            "Minutes": (0, 1440),
        },
        "sleep": {
            "Hours": (0, 16),
            "Minutes": (0, 960),
        },
        "workout": {
            "Hours": (0, 8),
            "Minutes": (0, 480),
        },
        "meditation": {
            "Hours": (0, 4),
            "Minutes": (0, 240),
        },
        "reading": {
            "Hours": (0, 12),
            "Minutes": (0, 720),
            "Pages": (0, 500),
        },
        "meetings": {
            "Hours": (0, 12),
            "Minutes": (0, 720),
            "Count": (0, 50),
        },
        "steps": {
            "Steps": (0, 100000),
            "Count": (0, 100000),
        },
        "distance": {
            "Miles": (0, 100),
            "Kilometers": (0, 160),
            "km": (0, 160),
        },
    }
    
    # Check if value is negative
    if value < 0:
        return {
            "is_valid": False,
            "reason": f"Value cannot be negative: {value}",
            "suggested_value": abs(value)
        }
    
    # Get limits for this type
    type_limits = VALUE_LIMITS.get(detected_type, {})
    unit_normalized = unit.strip()
    
    # Try to find matching unit limits
    limits = None
    for limit_unit, limit_range in type_limits.items():
        if limit_unit.lower() == unit_normalized.lower():
            limits = limit_range
            break
    
    if limits:
        min_val, max_val = limits
        if value < min_val:
            return {
                "is_valid": False,
                "reason": f"Value {value} {unit} is below minimum ({min_val})",
                "suggested_value": min_val
            }
        if value > max_val:
            return {
                "is_valid": False,
                "reason": f"Value {value} {unit} exceeds maximum ({max_val}) for {detected_type}",
                "suggested_value": max_val
            }
    
    # General sanity check for very large numbers
    if value > 10000 and detected_type not in ["steps"]:
        return {
            "is_valid": False,
            "reason": f"Value {value} seems unusually large",
            "suggested_value": None
        }
    
    return {
        "is_valid": True,
        "reason": None,
        "suggested_value": None
    }


# Keep backward compatibility
def extract_screentime_hours_from_image(image_bytes: bytes) -> Optional[float]:
    """
    Legacy function for backward compatibility.
    Uses the new analyzer with a focus on screen time.
    """
    result = analyze_screenshot_for_habits(image_bytes, [
        {"id": "screen_time", "name": "Screen Time", "unit_type": "Hours"}
    ])
    
    if result and result.get("value"):
        value = result["value"]
        unit = result.get("unit", "Hours")
        
        # Convert to hours if needed
        if unit.lower() == "minutes":
            return value / 60
        return value
    
    return None
