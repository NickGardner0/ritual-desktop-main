"""
Pydantic schemas for Plaid-backed financial connection APIs.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PlaidLinkTokenResponse(BaseModel):
    link_token: str
    expiration: Optional[str] = None
    request_id: Optional[str] = None


class PlaidLinkTokenRequest(BaseModel):
    connection_id: Optional[str] = None
    update_mode: bool = False
    account_selection_enabled: bool = True


class PlaidExchangePublicTokenRequest(BaseModel):
    public_token: str
    institution_id: Optional[str] = None
    institution_name: Optional[str] = None
    auto_backfill: bool = True


class FinancialSyncSettingsUpdateRequest(BaseModel):
    auto_sync_enabled: bool
    sync_hour: Optional[int] = None


class FinancialAccountPreferenceUpdateRequest(BaseModel):
    include_in_spending: bool


class FinancialScheduledSyncRequest(BaseModel):
    hour: Optional[int] = None


class FinancialAccountRead(BaseModel):
    id: str
    provider_account_id: str
    name: str
    official_name: Optional[str] = None
    mask: Optional[str] = None
    account_type: Optional[str] = None
    account_subtype: Optional[str] = None
    currency: Optional[str] = None
    is_active: bool = True
    include_in_spending: bool = True


class FinancialConnectionRead(BaseModel):
    id: str
    provider: str
    status: str
    institution_id: Optional[str] = None
    institution_name: Optional[str] = None
    last_sync_at: Optional[str] = None
    last_successful_sync_at: Optional[str] = None
    last_error_json: Optional[Dict[str, Any]] = None
    requires_reconnect: bool = False
    account_count: int = 0
    latest_transaction_date: Optional[str] = None
    auto_sync_enabled: bool = True
    sync_hour: int = 9
    accounts: List[FinancialAccountRead] = Field(default_factory=list)


class FinancialConnectionsResponse(BaseModel):
    connections: List[FinancialConnectionRead] = Field(default_factory=list)


class FinancialConnectionActionResponse(BaseModel):
    success: bool
    provider: str
    connection: Optional[FinancialConnectionRead] = None
    message: Optional[str] = None


class FinancialSyncResponse(BaseModel):
    success: bool
    provider: str
    connection_id: str
    items_seen: int = 0
    items_written: int = 0
    items_updated: int = 0
    items_deleted: int = 0
    affected_dates: List[str] = Field(default_factory=list)
    rollup: Dict[str, int] = Field(default_factory=dict)
    cursor: Optional[str] = None
    message: Optional[str] = None
