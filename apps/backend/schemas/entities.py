"""Shared Entity Protocol contracts."""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field, field_validator

from services.privacy_policy import data_class_for_entity_type


ENTITY_TYPES = (
    "habit",
    "habit_log",
    "task",
    "routine",
    "artifact",
    "conversation",
    "experiment",
    "calendar_event",
    "calendar_occurrence",
    "day",
    "time_window",
)

LAYER_0_ENTITY_TYPES = (
    "habit",
    "habit_log",
    "task",
    "routine",
    "artifact",
    "conversation",
    "calendar_event",
    "calendar_occurrence",
    "day",
    "time_window",
)

ENTITY_TYPE_ALIASES = {
    "report": "artifact",
    "calendar": "calendar_event",
}

ENTITY_MENTION_TOKEN_RE = re.compile(r"\[\[([a-z_]+):([^\]]+)\]\]")
ISO_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_WINDOW_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})/(\d{4}-\d{2}-\d{2})$")

EntityType = Literal[
    "habit",
    "habit_log",
    "task",
    "routine",
    "artifact",
    "conversation",
    "experiment",
    "calendar_event",
    "calendar_occurrence",
    "day",
    "time_window",
]
EntityAvailability = Literal["ok", "unknown", "deleted", "forbidden"]
RelatedEntitySource = Literal["fk", "artifact_link", "authored"]
AuthoredRelationship = Literal["references", "mentions", "supports", "contradicts", "evidence_for"]
AuthoredProvenance = Literal["user", "assistant", "workflow"]


def canonical_entity_type(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if value in ENTITY_TYPE_ALIASES:
        return ENTITY_TYPE_ALIASES[value]
    if value in ENTITY_TYPES:
        return value
    return None


def entity_route(entity_type: str, entity_id: str) -> str:
    encoded = entity_id
    canonical = canonical_entity_type(entity_type) or entity_type
    if canonical == "habit":
        return f"/dashboard?view=metrics&habit={encoded}"
    if canonical == "habit_log":
        return f"/activity?logId={encoded}"
    if canonical == "task":
        return f"/tasks?task={encoded}"
    if canonical == "routine":
        return f"/routines?routine={encoded}"
    if canonical == "artifact":
        return f"/reports?artifactId={encoded}"
    if canonical == "conversation":
        return f"/chat?conversation={encoded}"
    if canonical == "experiment":
        return f"/experiments/{encoded}"
    if canonical == "calendar_event":
        return f"/calendar?event={encoded}"
    if canonical == "calendar_occurrence":
        return f"/calendar?occurrence={encoded}"
    if canonical == "day":
        return f"/calendar?date={encoded}"
    if canonical == "time_window":
        parts = entity_id.split("/", 1)
        start = parts[0]
        end = parts[1] if len(parts) > 1 else parts[0]
        return f"/activity?from={start}&to={end}"
    return f"/{canonical}?id={encoded}"


def parse_entity_mention_tokens(text: Optional[str]) -> List["EntityRef"]:
    items: List[EntityRef] = []
    seen: set[Tuple[str, str]] = set()
    for match in ENTITY_MENTION_TOKEN_RE.finditer(text or ""):
        canonical = canonical_entity_type(match.group(1))
        entity_id = (match.group(2) or "").strip()
        if not canonical or not entity_id:
            continue
        key = (canonical, entity_id)
        if key in seen:
            continue
        seen.add(key)
        items.append(EntityRef(type=canonical, id=entity_id))
    return items


def is_day_id(value: str) -> bool:
    return bool(ISO_DAY_RE.match(value or ""))


def is_time_window_id(value: str) -> bool:
    match = ISO_WINDOW_RE.match(value or "")
    return bool(match and match.group(1) <= match.group(2))


def parse_date_mention_query(query: str, today: Optional[date] = None) -> Optional[Tuple[str, str]]:
    raw = (query or "").strip().lower()
    if not raw:
        return None
    if ISO_DAY_RE.match(raw):
        return ("day", raw)
    window = ISO_WINDOW_RE.match(raw)
    if window and window.group(1) <= window.group(2):
        return ("time_window", f"{window.group(1)}/{window.group(2)}")

    current = today or date.today()
    weekday = current.weekday()  # Monday=0; JS Date.getDay() is Sunday=0
    sunday_offset = (weekday + 1) % 7
    week_start = current - timedelta(days=sunday_offset)

    if raw == "today":
        return ("day", current.isoformat())
    if raw == "yesterday":
        return ("day", (current - timedelta(days=1)).isoformat())
    if raw == "tomorrow":
        return ("day", (current + timedelta(days=1)).isoformat())
    if raw == "this week":
        week_end = week_start + timedelta(days=6)
        return ("time_window", f"{week_start.isoformat()}/{week_end.isoformat()}")
    if raw == "last week":
        start = week_start - timedelta(days=7)
        end = start + timedelta(days=6)
        return ("time_window", f"{start.isoformat()}/{end.isoformat()}")
    if raw == "last 7 days":
        start = current - timedelta(days=6)
        return ("time_window", f"{start.isoformat()}/{current.isoformat()}")
    return None


def virtual_date_summary(entity_type: str, entity_id: str) -> Optional["EntitySummary"]:
    if entity_type == "day" and is_day_id(entity_id):
        try:
            parsed = date.fromisoformat(entity_id)
        except ValueError:
            return None
        return EntitySummary(
            ref=EntityRef(type="day", id=entity_id),
            title=f"{parsed.strftime('%b')} {parsed.day}, {parsed.year}",
            subtitle=parsed.strftime("%A"),
            route=entity_route("day", entity_id),
            privacyClass=data_class_for_entity_type("day"),
            availability="ok",
        )
    if entity_type == "time_window" and is_time_window_id(entity_id):
        start, end = entity_id.split("/", 1)
        title = start if start == end else f"{start} – {end}"
        return EntitySummary(
            ref=EntityRef(type="time_window", id=entity_id),
            title=title,
            subtitle="Date range",
            route=entity_route("time_window", entity_id),
            privacyClass=data_class_for_entity_type("time_window"),
            availability="ok",
        )
    return None


class EntityRef(BaseModel):
    type: EntityType
    id: str

    @field_validator("type", mode="before")
    @classmethod
    def canonicalize_type(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        canonical = canonical_entity_type(value)
        return canonical or value


class EntitySummary(BaseModel):
    ref: EntityRef
    title: str
    subtitle: Optional[str] = None
    status: Optional[str] = None
    icon: Optional[str] = None
    route: str
    updatedAt: Optional[str] = None
    privacyClass: str
    availability: EntityAvailability = "ok"


class RelatedEntity(BaseModel):
    ref: EntityRef
    relationship: str
    source: RelatedEntitySource = "fk"


class RelatedEntityItem(BaseModel):
    edge: RelatedEntity
    summary: EntitySummary


class EntityResolveRequest(BaseModel):
    refs: List[EntityRef] = Field(default_factory=list)


class EntityResolveResponse(BaseModel):
    items: List[EntitySummary] = Field(default_factory=list)


class EntityRelatedResponse(BaseModel):
    items: List[RelatedEntityItem] = Field(default_factory=list)


class EntitySearchResponse(BaseModel):
    query: str
    items: List[EntitySummary] = Field(default_factory=list)
    privacy_blocked: bool = False


class EntityReferenceCreate(BaseModel):
    source: EntityRef
    target: EntityRef
    relationship: AuthoredRelationship = "references"
    provenance: AuthoredProvenance = "user"
    anchor_json: Optional[str] = None
    client_event_id: Optional[str] = None


class EntityReferenceSyncRequest(BaseModel):
    source: EntityRef
    targets: List[EntityRef] = Field(default_factory=list)
    provenance: AuthoredProvenance = "user"


class EntityReferenceRead(BaseModel):
    id: str
    source: EntityRef
    target: EntityRef
    relationship: str
    provenance: str
    anchor_json: Optional[str] = None
    client_event_id: Optional[str] = None
    created_at: Optional[str] = None


class EntityReferenceListResponse(BaseModel):
    items: List[EntityReferenceRead] = Field(default_factory=list)


def unavailable_summary(ref: EntityRef, availability: EntityAvailability) -> EntitySummary:
    title = "Unavailable" if availability == "forbidden" else "Deleted" if availability == "deleted" else "Unknown"
    return EntitySummary(
        ref=ref,
        title=title,
        route=entity_route(ref.type, ref.id),
        privacyClass=data_class_for_entity_type(ref.type),
        availability=availability,
    )
