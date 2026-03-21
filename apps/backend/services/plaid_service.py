"""
Plaid API client and normalization helpers for spending sync.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

PLAID_ENV_URLS = {
    "sandbox": "https://sandbox.plaid.com",
    "development": "https://development.plaid.com",
    "production": "https://production.plaid.com",
}


def parse_csv_env(value: Optional[str], default: List[str]) -> List[str]:
    if not value:
        return default
    items = [item.strip() for item in value.split(",")]
    return [item for item in items if item]


class PlaidAPIError(RuntimeError):
    def __init__(
        self,
        *,
        status_code: int,
        error_type: Optional[str] = None,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
        display_message: Optional[str] = None,
        request_id: Optional[str] = None,
        raw: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.status_code = status_code
        self.error_type = error_type
        self.error_code = error_code
        self.error_message = error_message or "Plaid request failed."
        self.display_message = display_message
        self.request_id = request_id
        self.raw = raw or {}
        super().__init__(self.display_message or self.error_message)

    @classmethod
    def from_response(cls, response: httpx.Response) -> "PlaidAPIError":
        payload: Dict[str, Any]
        try:
            payload = response.json()
        except Exception:
            payload = {"error_message": response.text}

        return cls(
            status_code=response.status_code,
            error_type=payload.get("error_type"),
            error_code=payload.get("error_code"),
            error_message=payload.get("error_message") or response.text,
            display_message=payload.get("display_message"),
            request_id=payload.get("request_id"),
            raw=payload,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status_code": self.status_code,
            "error_type": self.error_type,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "display_message": self.display_message,
            "request_id": self.request_id,
        }


def parse_plaid_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def normalize_transaction_direction(amount: float, account_type: Optional[str]) -> str:
    del account_type
    return "outflow" if amount > 0 else "inflow"


def is_transfer_like_transaction(transaction: Dict[str, Any]) -> bool:
    personal_category = transaction.get("personal_finance_category") or {}
    primary = str(personal_category.get("primary") or "").upper()
    detailed = str(personal_category.get("detailed") or "").upper()
    transaction_code = str(transaction.get("transaction_code") or "").lower()

    if primary in {"TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"}:
        return True
    if detailed in {"LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"}:
        return True
    if transaction_code in {"transfer", "bill payment"}:
        return True
    return False


def transaction_counts_toward_spending(
    transaction: Dict[str, Any], account_type: Optional[str]
) -> bool:
    amount = float(transaction.get("amount") or 0.0)
    pending = bool(transaction.get("pending"))
    normalized_account_type = str(account_type or "").lower()

    if normalized_account_type != "depository":
        return False
    if pending:
        return False
    if amount <= 0:
        return False
    if is_transfer_like_transaction(transaction):
        return False
    return True


class PlaidService:
    def __init__(self) -> None:
        self.client_id = os.getenv("PLAID_CLIENT_ID")
        self.secret = os.getenv("PLAID_SECRET")
        self.env = (os.getenv("PLAID_ENV") or "sandbox").strip().lower()
        self.base_url = PLAID_ENV_URLS.get(self.env, PLAID_ENV_URLS["sandbox"])
        self.client_name = os.getenv("PLAID_CLIENT_NAME") or "Ritual"
        self.country_codes = parse_csv_env(os.getenv("PLAID_COUNTRY_CODES"), ["US"])
        self.products = parse_csv_env(os.getenv("PLAID_PRODUCTS"), ["transactions"])
        self.days_requested = max(
            30, min(int(os.getenv("PLAID_DAYS_REQUESTED") or "730"), 730)
        )
        self.webhook_url = (os.getenv("PLAID_WEBHOOK_URL") or "").strip() or None
        self.redirect_uri = (os.getenv("PLAID_REDIRECT_URI") or "").strip() or None

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.secret)

    def _require_config(self) -> None:
        if not self.configured:
            raise RuntimeError(
                "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET."
            )

    async def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._require_config()
        body = {
            "client_id": self.client_id,
            "secret": self.secret,
            **payload,
        }
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=body)
        if response.status_code >= 400:
            logger.error("Plaid request failed: %s %s", response.status_code, response.text)
            raise PlaidAPIError.from_response(response)
        return response.json()

    def _validate_link_configuration(self) -> None:
        if self.env != "production":
            return
        if not self.redirect_uri:
            raise RuntimeError(
                "PLAID_REDIRECT_URI is required in production to support OAuth institutions like Capital One."
            )
        if not self.redirect_uri.startswith("https://"):
            raise RuntimeError(
                "PLAID_REDIRECT_URI must be an https URL in production."
            )

    async def create_link_token(
        self,
        user_id: str,
        *,
        access_token: Optional[str] = None,
        account_selection_enabled: bool = False,
    ) -> Dict[str, Any]:
        self._validate_link_configuration()
        payload: Dict[str, Any] = {
            "client_name": self.client_name,
            "language": "en",
            "country_codes": self.country_codes,
            "user": {"client_user_id": user_id},
        }
        if self.webhook_url:
            payload["webhook"] = self.webhook_url
        if self.redirect_uri:
            payload["redirect_uri"] = self.redirect_uri
        if access_token:
            payload["access_token"] = access_token
            if account_selection_enabled:
                payload["update"] = {"account_selection_enabled": True}
        else:
            payload["products"] = self.products
            if "transactions" in self.products:
                payload["transactions"] = {"days_requested": self.days_requested}
        return await self._post("/link/token/create", payload)

    async def exchange_public_token(self, public_token: str) -> Dict[str, Any]:
        return await self._post(
            "/item/public_token/exchange",
            {"public_token": public_token},
        )

    async def get_item(self, access_token: str) -> Dict[str, Any]:
        return await self._post("/item/get", {"access_token": access_token})

    async def fetch_accounts(self, access_token: str) -> List[Dict[str, Any]]:
        response = await self._post("/accounts/get", {"access_token": access_token})
        accounts: List[Dict[str, Any]] = []
        for account in response.get("accounts", []):
            balances = account.get("balances") or {}
            accounts.append(
                {
                    "provider_account_id": account["account_id"],
                    "name": account.get("name") or account.get("official_name") or "Account",
                    "official_name": account.get("official_name"),
                    "mask": account.get("mask"),
                    "account_type": account.get("type") or "other",
                    "account_subtype": account.get("subtype"),
                    "currency": balances.get("iso_currency_code")
                    or balances.get("unofficial_currency_code")
                    or "USD",
                }
            )
        return accounts

    def _normalize_transaction(
        self,
        transaction: Dict[str, Any],
        account_types: Dict[str, Optional[str]],
    ) -> Dict[str, Any]:
        provider_account_id = transaction["account_id"]
        account_type = account_types.get(provider_account_id)
        amount = float(transaction.get("amount") or 0.0)
        personal_category = transaction.get("personal_finance_category") or {}

        return {
            "provider_transaction_id": transaction["transaction_id"],
            "provider_account_id": provider_account_id,
            "transaction_date": transaction.get("date") or transaction.get("authorized_date"),
            "authorized_at": parse_plaid_datetime(transaction.get("authorized_datetime")),
            "posted_at": parse_plaid_datetime(transaction.get("datetime")),
            "name": transaction.get("name") or "Transaction",
            "merchant_name": transaction.get("merchant_name"),
            "amount": amount,
            "currency": transaction.get("iso_currency_code")
            or transaction.get("unofficial_currency_code")
            or "USD",
            "direction": normalize_transaction_direction(amount, account_type),
            "pending": bool(transaction.get("pending")),
            "raw_category_json": json.dumps(personal_category) if personal_category else None,
            "raw_transaction_code": transaction.get("transaction_code"),
            "counts_toward_spending": transaction_counts_toward_spending(
                transaction, account_type
            ),
        }

    async def fetch_transactions(
        self,
        access_token: str,
        start_date: Optional[str] = None,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        del start_date
        accounts = await self.fetch_accounts(access_token)
        account_types = {
            account["provider_account_id"]: account.get("account_type") for account in accounts
        }

        added: List[Dict[str, Any]] = []
        modified: List[Dict[str, Any]] = []
        removed: List[Dict[str, Any]] = []
        next_cursor = cursor
        total_seen = 0

        while True:
            payload: Dict[str, Any] = {
                "access_token": access_token,
                "count": 500,
            }
            if next_cursor:
                payload["cursor"] = next_cursor

            response = await self._post("/transactions/sync", payload)
            added.extend(
                [
                    self._normalize_transaction(item, account_types)
                    for item in response.get("added", [])
                ]
            )
            modified.extend(
                [
                    self._normalize_transaction(item, account_types)
                    for item in response.get("modified", [])
                ]
            )
            removed.extend(
                [
                    {"provider_transaction_id": item["transaction_id"]}
                    for item in response.get("removed", [])
                ]
            )
            total_seen += (
                len(response.get("added", []))
                + len(response.get("modified", []))
                + len(response.get("removed", []))
            )
            next_cursor = response.get("next_cursor") or next_cursor

            if not response.get("has_more"):
                break

        return {
            "accounts": accounts,
            "cursor": next_cursor,
            "added": added,
            "modified": modified,
            "removed": removed,
            "total_seen": total_seen,
        }


plaid_service = PlaidService()
