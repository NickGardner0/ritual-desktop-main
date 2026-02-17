"""
Import Validator Service - V2 Validation Rules

Handles:
- Date validation (invalid, future, out of range)
- Value validation (negative, outliers)
- Unit validation (mismatch, missing)
- Confidence scoring
- Auto-fix suggestions
"""

import re
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
from models.import_models import (
    ImportItem, ValidationMessage, ValidationStatus, ValidationCode,
    ValidationRules, ConfidenceInfo, MatchReason, SemanticDedupeOptions
)


# Default outlier thresholds by unit type
DEFAULT_OUTLIER_THRESHOLDS = {
    "steps": {"min": 0, "max": 100000},
    "hours": {"min": 0, "max": 24},
    "minutes": {"min": 0, "max": 1440},
    "seconds": {"min": 0, "max": 86400},
    "calories": {"min": 0, "max": 15000},
    "kcal": {"min": 0, "max": 15000},
    "count": {"min": 0, "max": 10000},
    "bpm": {"min": 20, "max": 250},
    "ms": {"min": 0, "max": 500},  # HRV
    "percent": {"min": 0, "max": 100},
    "%": {"min": 0, "max": 100},
    "miles": {"min": 0, "max": 100},
    "km": {"min": 0, "max": 160},
    "meters": {"min": 0, "max": 160000},
    "floors": {"min": 0, "max": 500},
    "glasses": {"min": 0, "max": 50},
    "cups": {"min": 0, "max": 50},
    "mg": {"min": 0, "max": 5000},  # e.g., caffeine
    "pages": {"min": 0, "max": 1000},
}

# Unit synonyms for normalization
UNIT_SYNONYMS = {
    "hour": "hours",
    "hr": "hours",
    "hrs": "hours",
    "h": "hours",
    "minute": "minutes",
    "min": "minutes",
    "mins": "minutes",
    "m": "minutes",
    "second": "seconds",
    "sec": "seconds",
    "secs": "seconds",
    "s": "seconds",
    "step": "steps",
    "calorie": "calories",
    "cal": "calories",
    "kilocalorie": "kcal",
    "kilocalories": "kcal",
    "mile": "miles",
    "mi": "miles",
    "kilometer": "km",
    "kilometers": "km",
    "meter": "meters",
    "metre": "meters",
    "metres": "meters",
    "floor": "floors",
    "flight": "floors",
    "flights": "floors",
    "glass": "glasses",
    "cup": "cups",
    "page": "pages",
    "milligram": "mg",
    "milligrams": "mg",
    "percentage": "percent",
}


def normalize_unit(unit: Optional[str]) -> str:
    """Normalize unit string to standard form"""
    if not unit:
        return "count"
    unit_lower = unit.lower().strip()
    return UNIT_SYNONYMS.get(unit_lower, unit_lower)


def get_outlier_bounds(unit: Optional[str]) -> Tuple[float, float]:
    """Get outlier bounds for a unit type"""
    normalized = normalize_unit(unit)
    bounds = DEFAULT_OUTLIER_THRESHOLDS.get(normalized, {"min": 0, "max": 100000})
    return bounds["min"], bounds["max"]


class ImportValidator:
    """Validates import items with configurable rules"""
    
    def __init__(self, rules: Optional[ValidationRules] = None):
        self.rules = rules or ValidationRules()
    
    def validate_item(self, item: ImportItem) -> ImportItem:
        """
        Validate a single import item.
        Modifies item in place with validation messages and status.
        Returns the item for chaining.
        """
        messages: List[ValidationMessage] = []
        
        # Date validations
        date_messages = self._validate_date(item.date)
        messages.extend(date_messages)
        
        # Value validations
        value_messages = self._validate_value(item.amount, item.unit_type)
        messages.extend(value_messages)
        
        # Unit validations
        unit_messages = self._validate_unit(item.unit_type)
        messages.extend(unit_messages)
        
        # Set validation status
        item.validation_messages = messages
        if any(m.type == "error" for m in messages):
            item.validation_status = ValidationStatus.ERROR
        elif any(m.type == "warning" for m in messages):
            item.validation_status = ValidationStatus.WARNING
        else:
            item.validation_status = ValidationStatus.OK
        
        return item
    
    def validate_items(self, items: List[ImportItem]) -> List[ImportItem]:
        """Validate a list of items"""
        return [self.validate_item(item) for item in items]
    
    def _validate_date(self, date_str: str) -> List[ValidationMessage]:
        """Validate a date string"""
        messages = []
        
        if not date_str:
            messages.append(ValidationMessage(
                type="error",
                code=ValidationCode.INVALID_DATE.value,
                message="Date is required",
                field="date",
                auto_fixable=False
            ))
            return messages
        
        # Try to parse the date
        try:
            # Handle various formats
            parsed_date = None
            for fmt in ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"]:
                try:
                    parsed_date = datetime.strptime(date_str, fmt)
                    break
                except ValueError:
                    continue
            
            if not parsed_date:
                # Try ISO format with time
                try:
                    parsed_date = datetime.fromisoformat(date_str.replace("Z", "+00:00").split("T")[0])
                except:
                    pass
            
            if not parsed_date:
                messages.append(ValidationMessage(
                    type="error",
                    code=ValidationCode.INVALID_DATE.value,
                    message=f"Invalid date format: {date_str}",
                    field="date",
                    suggested_fix="Use YYYY-MM-DD format",
                    auto_fixable=False
                ))
                return messages
            
            # Check for future date
            today = datetime.now().date()
            max_future = today + timedelta(days=self.rules.max_days_in_future)
            
            if parsed_date.date() > max_future and not self.rules.allow_future_dates:
                messages.append(ValidationMessage(
                    type="warning",
                    code=ValidationCode.FUTURE_DATE.value,
                    message=f"Date is in the future: {date_str}",
                    field="date",
                    suggested_fix=f"Change to today ({today.isoformat()}) or earlier",
                    auto_fixable=True
                ))
            
            # Check date range
            if self.rules.min_date:
                min_date = datetime.strptime(self.rules.min_date, "%Y-%m-%d").date()
                if parsed_date.date() < min_date:
                    messages.append(ValidationMessage(
                        type="warning",
                        code=ValidationCode.DATE_OUT_OF_RANGE.value,
                        message=f"Date {date_str} is before minimum {self.rules.min_date}",
                        field="date",
                        auto_fixable=False
                    ))
            
            if self.rules.max_date:
                max_date = datetime.strptime(self.rules.max_date, "%Y-%m-%d").date()
                if parsed_date.date() > max_date:
                    messages.append(ValidationMessage(
                        type="warning",
                        code=ValidationCode.DATE_OUT_OF_RANGE.value,
                        message=f"Date {date_str} is after maximum {self.rules.max_date}",
                        field="date",
                        auto_fixable=False
                    ))
                    
        except Exception as e:
            messages.append(ValidationMessage(
                type="error",
                code=ValidationCode.INVALID_DATE.value,
                message=f"Could not parse date: {str(e)}",
                field="date",
                auto_fixable=False
            ))
        
        return messages
    
    def _validate_value(self, amount: Optional[float], unit: Optional[str]) -> List[ValidationMessage]:
        """Validate a numeric value"""
        messages = []
        
        if amount is None:
            messages.append(ValidationMessage(
                type="warning",
                code=ValidationCode.VALUE_MISSING.value,
                message="Value is missing",
                field="amount",
                suggested_fix="Provide a numeric value",
                auto_fixable=False
            ))
            return messages
        
        # Check for negative values
        if amount < 0 and not self.rules.allow_negative_values:
            messages.append(ValidationMessage(
                type="error" if not self.rules.auto_fix_negative else "warning",
                code=ValidationCode.NEGATIVE_VALUE.value,
                message=f"Negative value not allowed: {amount}",
                field="amount",
                suggested_fix=f"Use absolute value: {abs(amount)}",
                auto_fixable=self.rules.auto_fix_negative
            ))
        
        # Check for zero values
        if amount == 0 and not self.rules.allow_zero_values:
            messages.append(ValidationMessage(
                type="warning",
                code=ValidationCode.VALUE_MISSING.value,
                message="Zero value may indicate missing data",
                field="amount",
                auto_fixable=False
            ))
        
        # Check for outliers
        min_bound, max_bound = get_outlier_bounds(unit)
        
        if amount < min_bound:
            messages.append(ValidationMessage(
                type="warning",
                code=ValidationCode.OUTLIER_LOW.value,
                message=f"Value {amount} is unusually low for {unit or 'this metric'} (expected >= {min_bound})",
                field="amount",
                suggested_fix=f"Clamp to minimum: {min_bound}" if self.rules.auto_fix_outliers else None,
                auto_fixable=self.rules.auto_fix_outliers
            ))
        
        if amount > max_bound:
            messages.append(ValidationMessage(
                type="warning",
                code=ValidationCode.OUTLIER_HIGH.value,
                message=f"Value {amount} is unusually high for {unit or 'this metric'} (expected <= {max_bound})",
                field="amount",
                suggested_fix=f"Clamp to maximum: {max_bound}" if self.rules.auto_fix_outliers else None,
                auto_fixable=self.rules.auto_fix_outliers
            ))
        
        return messages
    
    def _validate_unit(self, unit: Optional[str]) -> List[ValidationMessage]:
        """Validate a unit string"""
        messages = []
        
        if not unit:
            messages.append(ValidationMessage(
                type="info",
                code=ValidationCode.UNIT_MISSING.value,
                message="Unit type not specified, defaulting to 'count'",
                field="unit_type",
                auto_fixable=True
            ))
        
        return messages
    
    def auto_fix_item(self, item: ImportItem) -> ImportItem:
        """
        Apply auto-fixes to an item based on validation messages.
        Returns modified item.
        """
        for msg in item.validation_messages:
            if not msg.auto_fixable:
                continue
            
            if msg.code == ValidationCode.NEGATIVE_VALUE.value and item.amount is not None:
                item.original_amount = item.amount
                item.amount = abs(item.amount)
                item.transform_applied = "absolute_value"
            
            elif msg.code == ValidationCode.OUTLIER_HIGH.value and item.amount is not None:
                _, max_bound = get_outlier_bounds(item.unit_type)
                item.original_amount = item.amount
                item.amount = max_bound
                item.transform_applied = f"clamped_max_{max_bound}"
            
            elif msg.code == ValidationCode.OUTLIER_LOW.value and item.amount is not None:
                min_bound, _ = get_outlier_bounds(item.unit_type)
                item.original_amount = item.amount
                item.amount = min_bound
                item.transform_applied = f"clamped_min_{min_bound}"
            
            elif msg.code == ValidationCode.FUTURE_DATE.value:
                item.date = datetime.now().strftime("%Y-%m-%d")
                item.transform_applied = "date_fixed_to_today"
        
        # Revalidate after fixes
        return self.validate_item(item)


def calculate_confidence(
    item: ImportItem,
    match_type: Optional[MatchReason] = None,
    inferred_fields: Optional[List[str]] = None
) -> ConfidenceInfo:
    """
    Calculate confidence score for a parsed item.
    Returns ConfidenceInfo with score and explanations.
    """
    score = 1.0
    reasons = []
    inferred = inferred_fields or []
    
    # Start with base score based on match type
    if match_type == MatchReason.EXACT_NAME:
        score = 1.0
        reasons.append("Matched habit by exact name")
    elif match_type == MatchReason.EXACT_METRIC_TYPE:
        score = 0.95
        reasons.append("Matched habit by metric type")
    elif match_type == MatchReason.USER_MAPPED:
        score = 0.98
        reasons.append("User-defined column mapping")
    elif match_type == MatchReason.FUZZY_NAME:
        score = 0.85
        reasons.append("Matched habit by similar name")
    elif match_type == MatchReason.SYNONYM_MATCH:
        score = 0.80
        reasons.append("Matched habit by synonym")
    elif match_type == MatchReason.AI_DETECTED:
        score = 0.70
        reasons.append("AI-detected from screenshot")
    elif match_type == MatchReason.NEW_HABIT:
        score = 0.90
        reasons.append("Will create new habit")
    
    # Reduce confidence for inferred fields
    if "date" in inferred:
        score -= 0.1
        reasons.append("Date was inferred")
    
    if "unit" in inferred:
        score -= 0.05
        reasons.append("Unit type was inferred")
    
    if "amount" in inferred:
        score -= 0.15
        reasons.append("Value was transformed")
    
    # Reduce confidence for validation issues
    if item.validation_status == ValidationStatus.WARNING:
        score -= 0.1
        reasons.append("Has validation warnings")
    elif item.validation_status == ValidationStatus.ERROR:
        score -= 0.3
        reasons.append("Has validation errors")
    
    # Clamp to valid range
    score = max(0.0, min(1.0, score))
    
    return ConfidenceInfo(
        score=score,
        reasons=reasons,
        match_type=match_type,
        inferred_fields=inferred
    )


def is_semantic_duplicate(
    new_value: Optional[float],
    existing_value: Optional[float],
    options: Optional[SemanticDedupeOptions] = None
) -> bool:
    """
    Check if two values are "close enough" to be considered duplicates.
    """
    if options is None or not options.enabled:
        return False
    
    if new_value is None or existing_value is None:
        return False
    
    if new_value == existing_value:
        return True
    
    # Check absolute tolerance
    abs_diff = abs(new_value - existing_value)
    if abs_diff <= options.absolute_tolerance:
        return True
    
    # Check percentage tolerance
    if existing_value != 0:
        percent_diff = abs_diff / abs(existing_value)
        if percent_diff <= options.percent_tolerance:
            return True
    
    return False


def transform_value(
    value: Optional[float],
    transform: Optional[str],
    raw_string: Optional[str] = None
) -> Tuple[Optional[float], bool]:
    """
    Apply a transform to a value.
    Returns (transformed_value, success).
    """
    if value is None and transform not in ["parse_hhmm", "parse_duration"]:
        return None, False
    
    if transform is None:
        return value, True
    
    try:
        if transform == "divide_60":
            return value / 60 if value else None, True
        
        elif transform == "multiply_60":
            return value * 60 if value else None, True
        
        elif transform == "parse_hhmm" and raw_string:
            # Parse "HH:MM" or "H:MM" format
            match = re.match(r"(\d+):(\d{2})", raw_string)
            if match:
                hours = int(match.group(1))
                minutes = int(match.group(2))
                return hours + minutes / 60, True
            return None, False
        
        elif transform == "parse_duration" and raw_string:
            # Parse "Xh Ym" or "X hours Y minutes" format
            hours = 0
            minutes = 0
            
            h_match = re.search(r"(\d+)\s*(?:h|hr|hour)", raw_string, re.IGNORECASE)
            m_match = re.search(r"(\d+)\s*(?:m|min|minute)", raw_string, re.IGNORECASE)
            
            if h_match:
                hours = int(h_match.group(1))
            if m_match:
                minutes = int(m_match.group(1))
            
            if hours or minutes:
                return hours + minutes / 60, True
            return None, False
        
        return value, True
        
    except Exception:
        return value, False


# Global validator instance with default rules
default_validator = ImportValidator()

