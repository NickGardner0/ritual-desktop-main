"""Contracts for channel-bound desktop authentication handoffs."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


DesktopAuthChannel = Literal["production", "qa", "development"]
DesktopAuthStatus = Literal["pending", "consumed", "acknowledged", "failed", "expired"]


class DesktopAuthNativeMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    app_version: Optional[str] = Field(default=None, max_length=64)
    build_sha: Optional[str] = Field(default=None, max_length=64)
    bundle_id: Optional[str] = Field(default=None, max_length=128)
    target: Optional[str] = Field(default=None, max_length=128)


class DesktopAuthHandoffCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^dah_[A-Za-z0-9_-]{22}$")
    nonce_challenge: str = Field(pattern=r"^[0-9a-f]{64}$")
    channel: DesktopAuthChannel
    protocol: Literal["2"]
    expires_in_seconds: int = Field(default=300, ge=30, le=300)
    native_metadata: DesktopAuthNativeMetadata = Field(default_factory=DesktopAuthNativeMetadata)


class DesktopAuthHandoffConsume(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nonce: str = Field(min_length=32, max_length=256)
    channel: DesktopAuthChannel
    protocol: Literal["2"]
    native_metadata: DesktopAuthNativeMetadata = Field(default_factory=DesktopAuthNativeMetadata)


class DesktopAuthHandoffClaimFailure(DesktopAuthHandoffConsume):
    failure_code: str = Field(min_length=1, max_length=128)


class DesktopAuthHandoffAcknowledge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["acknowledged", "failed"]
    failure_code: Optional[str] = Field(default=None, max_length=128)
    native_metadata: DesktopAuthNativeMetadata = Field(default_factory=DesktopAuthNativeMetadata)


class DesktopAuthHandoffRead(BaseModel):
    id: str
    channel: DesktopAuthChannel
    protocol: str
    status: DesktopAuthStatus
    expires_at: datetime
    consumed_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    failure_code: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class DesktopAuthHandoffConsumeRead(DesktopAuthHandoffRead):
    user_id: str
