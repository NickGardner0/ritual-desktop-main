"""
Screenshot Analyzer Service

Uses OpenAI's vision model to analyze screenshots and extract habit data.
Can detect various types of data: screen time, meetings, workouts, reading, etc.
"""

import base64
import json
import os
from typing import Optional, List, Dict, Any

from openai import OpenAI

# Initialize OpenAI client (uses OPENAI_API_KEY env var automatically)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def analyze_screenshot_for_habits(
    image_bytes: bytes, 
    available_habits: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Uses OpenAI vision to analyze a screenshot and extract habit data.
    
    Args:
        image_bytes: Raw bytes of the screenshot image
        available_habits: List of user's habits with their names and units
        
    Returns:
        Dict with:
        - habit_name: Name of the matched habit (or suggested new habit)
        - habit_id: ID of the matched habit (or None if new)
        - value: The extracted numeric value
        - unit: The unit of the value
        - confidence: How confident the model is (0-1)
        - description: What was detected in the screenshot
        
        Returns None if nothing useful could be extracted.
    """
    # Build list of available habits for the prompt
    habits_list = "\n".join([
        f"- {h['name']} (unit: {h.get('unit_type', 'unknown')}, id: {h['id']})"
        for h in available_habits
    ])
    
    system_prompt = f"""You are an AI assistant that analyzes screenshots to extract habit/activity data.

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

    # Encode as base64
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{b64}"

    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": system_prompt,
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

        raw_content = completion.choices[0].message.content
        print(f"🔍 OpenAI vision response: {raw_content}")
        
        return _parse_analysis_response(raw_content, available_habits)
        
    except Exception as e:
        print(f"❌ OpenAI vision API error: {e}")
        return None


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
    
    return result


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
