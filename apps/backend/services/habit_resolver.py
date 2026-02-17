"""
Phase 5A: Habit Resolver Service
Implements fuzzy matching for natural language habit resolution.
"""

from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class MatchType(str, Enum):
    EXACT = "exact"
    ALIAS = "alias"
    SUBSTRING = "substring"
    TOKEN = "token"
    EDIT = "edit"
    FALLBACK = "fallback"
    NONE = "none"


@dataclass
class ResolveResult:
    """Result of habit resolution attempt."""
    habit_id: Optional[str]
    habit_name: Optional[str]
    match_type: MatchType
    confidence: float
    alternatives: List[Dict[str, Any]]
    needs_clarification: bool = False


class HabitResolver:
    """
    Resolves natural language habit hints to actual habit IDs.
    Uses a priority-based matching system with confidence scoring.
    """
    
    CONFIDENCE_THRESHOLD = 0.75  # Auto-accept threshold
    
    def __init__(self):
        pass
    
    def resolve(
        self,
        hint: str,
        user_habits: List[Dict[str, Any]],
        aliases_map: Dict[str, List[str]]
    ) -> ResolveResult:
        """
        Resolve a habit hint to a habit ID.
        
        Args:
            hint: Natural language hint (e.g., "walk", "worked out", "meditation")
            user_habits: List of user's habits with id, name, category, unit_type
            aliases_map: Dict mapping habit_id -> list of aliases
        
        Returns:
            ResolveResult with match info and alternatives
        """
        if not hint or not user_habits:
            return ResolveResult(
                habit_id=None,
                habit_name=None,
                match_type=MatchType.NONE,
                confidence=0.0,
                alternatives=[],
                needs_clarification=True
            )
        
        hint_normalized = hint.lower().strip()
        candidates: List[Tuple[Dict, MatchType, float]] = []
        
        for habit in user_habits:
            habit_name = habit.get("name", "").lower()
            habit_id = habit.get("id")
            habit_aliases = aliases_map.get(habit_id, [])
            
            # 1. Exact match on name
            if hint_normalized == habit_name:
                candidates.append((habit, MatchType.EXACT, 1.0))
                continue
            
            # 2. Alias match
            alias_score = self._check_alias_match(hint_normalized, habit_aliases)
            if alias_score > 0:
                candidates.append((habit, MatchType.ALIAS, alias_score))
                continue
            
            # 3. Substring match
            substring_score = self._check_substring_match(hint_normalized, habit_name)
            if substring_score > 0:
                candidates.append((habit, MatchType.SUBSTRING, substring_score))
                continue
            
            # 4. Token overlap (Jaccard similarity)
            token_score = self._check_token_overlap(hint_normalized, habit_name)
            if token_score > 0.3:
                candidates.append((habit, MatchType.TOKEN, token_score))
                continue
            
            # 5. Edit distance (Levenshtein)
            edit_score = self._check_edit_distance(hint_normalized, habit_name)
            if edit_score > 0.5:
                candidates.append((habit, MatchType.EDIT, edit_score))
        
        # Sort by confidence
        candidates.sort(key=lambda x: x[2], reverse=True)
        
        if not candidates:
            return ResolveResult(
                habit_id=None,
                habit_name=None,
                match_type=MatchType.NONE,
                confidence=0.0,
                alternatives=[],
                needs_clarification=True
            )
        
        best_match, match_type, confidence = candidates[0]
        
        # Build alternatives (top 3 excluding best)
        alternatives = [
            {
                "id": c[0].get("id"),
                "name": c[0].get("name"),
                "confidence": round(c[2], 2)
            }
            for c in candidates[1:4]
        ]
        
        # Check if needs clarification
        needs_clarification = confidence < self.CONFIDENCE_THRESHOLD
        
        # If there are close alternatives, also need clarification
        if alternatives and alternatives[0]["confidence"] > confidence - 0.1:
            needs_clarification = True
        
        return ResolveResult(
            habit_id=best_match.get("id") if not needs_clarification else None,
            habit_name=best_match.get("name"),
            match_type=match_type,
            confidence=round(confidence, 2),
            alternatives=[
                {"id": best_match.get("id"), "name": best_match.get("name"), "confidence": round(confidence, 2)},
                *alternatives
            ] if needs_clarification else alternatives,
            needs_clarification=needs_clarification
        )
    
    def _check_alias_match(self, hint: str, aliases: List[str]) -> float:
        """Check if hint matches any alias."""
        for alias in aliases:
            if hint == alias:
                return 0.95
            if hint in alias or alias in hint:
                # Partial match - score based on overlap
                return 0.8 * min(len(hint), len(alias)) / max(len(hint), len(alias))
        return 0.0
    
    def _check_substring_match(self, hint: str, habit_name: str) -> float:
        """Check if hint is a substring of habit name or vice versa."""
        if hint in habit_name:
            # hint is part of habit name
            return 0.85 * len(hint) / len(habit_name)
        if habit_name in hint:
            # habit name is part of hint (less common)
            return 0.75 * len(habit_name) / len(hint)
        
        # Check word-level substring
        habit_words = habit_name.split()
        for word in habit_words:
            if hint == word:
                return 0.9
            if hint in word or word in hint:
                return 0.7
        
        return 0.0
    
    def _check_token_overlap(self, hint: str, habit_name: str) -> float:
        """Calculate Jaccard similarity between token sets."""
        hint_tokens = set(hint.replace("-", " ").replace("_", " ").split())
        habit_tokens = set(habit_name.replace("-", " ").replace("_", " ").split())
        
        if not hint_tokens or not habit_tokens:
            return 0.0
        
        intersection = hint_tokens & habit_tokens
        union = hint_tokens | habit_tokens
        
        jaccard = len(intersection) / len(union)
        return jaccard * 0.85  # Scale down slightly
    
    def _check_edit_distance(self, hint: str, habit_name: str) -> float:
        """Calculate normalized edit distance score."""
        # Extract main word from habit name for comparison
        habit_words = habit_name.split()
        best_score = 0.0
        
        for word in habit_words:
            if len(word) < 3:
                continue
            
            distance = self._levenshtein_distance(hint, word)
            max_len = max(len(hint), len(word))
            
            if max_len == 0:
                continue
            
            # Convert distance to similarity score
            similarity = 1 - (distance / max_len)
            
            # Only consider if very close (1-2 edits)
            if distance <= 2 and similarity > best_score:
                best_score = similarity * 0.8  # Scale down for edit matches
        
        return best_score
    
    def _levenshtein_distance(self, s1: str, s2: str) -> int:
        """Calculate Levenshtein edit distance between two strings."""
        if len(s1) < len(s2):
            return self._levenshtein_distance(s2, s1)
        
        if len(s2) == 0:
            return len(s1)
        
        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row
        
        return previous_row[-1]


# Unit conversion utilities for Phase 5A
UNIT_CONVERSIONS = {
    ("minutes", "hours"): lambda x: x / 60,
    ("hours", "minutes"): lambda x: x * 60,
    ("kilometers", "miles"): lambda x: x * 0.621371,
    ("miles", "kilometers"): lambda x: x * 1.60934,
}

# Canonical unit mapping
UNIT_CANONICAL = {
    "min": "minutes",
    "mins": "minutes",
    "minute": "minutes",
    "hr": "hours",
    "hrs": "hours",
    "hour": "hours",
    "mi": "miles",
    "mile": "miles",
    "km": "kilometers",
    "kilometer": "kilometers",
    "step": "steps",
    "pg": "pages",
    "page": "pages",
}


def normalize_unit(unit: Optional[str]) -> str:
    """Normalize unit to canonical form."""
    if not unit:
        return "count"
    
    unit_lower = unit.lower().strip()
    return UNIT_CANONICAL.get(unit_lower, unit_lower)


def convert_value(
    value: float,
    from_unit: str,
    to_unit: str
) -> Tuple[float, bool]:
    """
    Convert value between units.
    Returns (converted_value, was_converted).
    """
    from_normalized = normalize_unit(from_unit)
    to_normalized = normalize_unit(to_unit)
    
    if from_normalized == to_normalized:
        return value, False
    
    conversion_key = (from_normalized, to_normalized)
    if conversion_key in UNIT_CONVERSIONS:
        return UNIT_CONVERSIONS[conversion_key](value), True
    
    # No conversion available - return original
    return value, False


def check_unit_compatibility(intent_unit: str, habit_unit: str) -> Tuple[bool, str]:
    """
    Check if intent unit is compatible with habit unit.
    Returns (is_compatible, reason).
    """
    intent_normalized = normalize_unit(intent_unit)
    habit_normalized = normalize_unit(habit_unit)
    
    # Same unit is always compatible
    if intent_normalized == habit_normalized:
        return True, ""
    
    # Time units are compatible
    time_units = {"minutes", "hours", "seconds"}
    if intent_normalized in time_units and habit_normalized in time_units:
        return True, ""
    
    # Distance units are compatible
    distance_units = {"miles", "kilometers", "meters"}
    if intent_normalized in distance_units and habit_normalized in distance_units:
        return True, ""
    
    # Count is compatible with anything numeric-ish
    if habit_normalized == "count" or intent_normalized == "count":
        return True, ""
    
    # Incompatible
    return False, f"Cannot convert {intent_unit} to {habit_unit}"


# Create singleton instance
habit_resolver = HabitResolver()

