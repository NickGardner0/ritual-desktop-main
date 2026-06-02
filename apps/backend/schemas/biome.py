"""Schemas for Apple Biome App.InFocus activity ingestion."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class BiomeActivityEvent(BaseModel):
    """A normalized iPhone foreground-app interval from Biome App.InFocus."""

    event_uid: Optional[str] = Field(default=None, max_length=512)
    device_id: str = Field(min_length=1, max_length=128)
    app_bundle_id: str = Field(min_length=1, max_length=256)
    app_name: str = Field(min_length=1, max_length=256)
    ts_start: int = Field(ge=0)
    ts_end: int = Field(ge=0)
    window_title: Optional[str] = Field(default=None, max_length=1024)
    browser_url: Optional[str] = Field(default=None, max_length=4096)
    browser_domain: Optional[str] = Field(default=None, max_length=512)
    is_incognito: bool = False
    source_file: Optional[str] = Field(default=None, max_length=1024)
    app_version: Optional[str] = Field(default=None, max_length=128)
    app_build: Optional[str] = Field(default=None, max_length=128)
    transition_reason: Optional[str] = Field(default=None, max_length=128)
    biome_is_provisional: bool = False

    @field_validator("device_id", "app_bundle_id", "app_name")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped

    @model_validator(mode="after")
    def _validate_interval(self) -> "BiomeActivityEvent":
        if self.ts_end <= self.ts_start:
            raise ValueError("ts_end must be greater than ts_start")
        if self.ts_end - self.ts_start > 24 * 60 * 60 * 1000:
            raise ValueError("event interval is longer than 24 hours")
        return self


class BiomeIngestBatch(BaseModel):
    events: List[BiomeActivityEvent] = Field(default_factory=list)


class BiomeIngestResponse(BaseModel):
    accepted: int
    rejected: int
    duplicates: int
    accepted_event_uids: List[str] = Field(default_factory=list)
    duplicate_event_uids: List[str] = Field(default_factory=list)
    rejected_event_uids: List[str] = Field(default_factory=list)
