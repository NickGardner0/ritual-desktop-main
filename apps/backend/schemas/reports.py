"""
Pydantic schemas for Ritual's scheduled habit-report pipeline.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


ReportCadence = Literal["daily", "weekly", "monthly"]
ReportStatus = Literal["draft", "scheduled", "paused"]
ReportDeliveryChannel = Literal["email"]
ReportSection = Literal[
    "highlights",
    "consistency",
    "streaks",
    "top-habits",
    "missed-habits",
    "computer-activity",
    "wearables",
]
ReportRunStatus = Literal["queued", "processing", "sent", "failed"]
ReportNotificationStatus = Literal["queued", "sent", "failed"]


class HabitReportRecipient(BaseModel):
    email: str
    label: str


class HabitReportScheduleBase(BaseModel):
    name: str
    cadence: ReportCadence
    status: ReportStatus = "draft"
    timezone: str = "America/New_York"
    delivery_channel: ReportDeliveryChannel = "email"
    delivery_label: str
    send_hour_local: int = Field(default=8, ge=0, le=23)
    send_minute_local: int = Field(default=0, ge=0, le=59)
    send_weekday: Optional[int] = Field(default=None, ge=0, le=6)
    send_day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    recipients: List[HabitReportRecipient] = Field(default_factory=list)
    sections: List[ReportSection] = Field(default_factory=list)


class HabitReportScheduleCreate(HabitReportScheduleBase):
    pass


class HabitReportScheduleUpdate(BaseModel):
    name: Optional[str] = None
    cadence: Optional[ReportCadence] = None
    status: Optional[ReportStatus] = None
    timezone: Optional[str] = None
    delivery_label: Optional[str] = None
    send_hour_local: Optional[int] = Field(default=None, ge=0, le=23)
    send_minute_local: Optional[int] = Field(default=None, ge=0, le=59)
    send_weekday: Optional[int] = Field(default=None, ge=0, le=6)
    send_day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    recipients: Optional[List[HabitReportRecipient]] = None
    sections: Optional[List[ReportSection]] = None


class HabitReportScheduleRead(HabitReportScheduleBase):
    id: str
    last_sent_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    last_error: Optional[str] = None


class HabitReportMetric(BaseModel):
    label: str
    value: str
    unit: str
    note: Optional[str] = None


class HabitReportPreview(BaseModel):
    subject: str
    preheader: str
    title: str
    period_label: str
    intro_line: str
    summary: str
    metrics: List[HabitReportMetric] = Field(default_factory=list)
    highlights: List[str] = Field(default_factory=list)
    cta_label: str = "Open Ritual"
    cta_url: str


class HabitReportRunRead(BaseModel):
    id: str
    schedule_id: str
    cadence: ReportCadence
    status: ReportRunStatus
    period_start: str
    period_end: str
    subject: Optional[str] = None
    artifact_id: Optional[str] = None
    preview: Optional[HabitReportPreview] = None
    generated_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    error_json: Optional[str] = None


class HabitReportNotificationRead(BaseModel):
    id: str
    report_run_id: str
    channel: ReportDeliveryChannel
    recipient_email: str
    status: ReportNotificationStatus
    provider_message_id: Optional[str] = None
    sent_at: Optional[datetime] = None


class HabitReportScheduleListResponse(BaseModel):
    schedules: List[HabitReportScheduleRead] = Field(default_factory=list)


class HabitReportRunListResponse(BaseModel):
    runs: List[HabitReportRunRead] = Field(default_factory=list)


class HabitReportBlueprintResponse(BaseModel):
    cadences: List[ReportCadence] = Field(default_factory=lambda: ["daily", "weekly", "monthly"])
    statuses: List[ReportStatus] = Field(default_factory=lambda: ["draft", "scheduled", "paused"])
    delivery_channels: List[ReportDeliveryChannel] = Field(default_factory=lambda: ["email"])
    sections: List[ReportSection] = Field(
        default_factory=lambda: [
            "highlights",
            "consistency",
            "streaks",
            "top-habits",
            "missed-habits",
            "computer-activity",
            "wearables",
        ]
    )


class HabitReportDispatchResponse(BaseModel):
    schedule: HabitReportScheduleRead
    run: HabitReportRunRead
    notifications: List[HabitReportNotificationRead] = Field(default_factory=list)
