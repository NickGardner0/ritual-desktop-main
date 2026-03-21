"""Unit tests for Plaid spending normalization rules."""

from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.plaid_service import (
    PlaidService,
    is_transfer_like_transaction,
    normalize_transaction_direction,
    transaction_counts_toward_spending,
)


class PlaidSpendingLogicTests(unittest.TestCase):
    def test_depository_outflow_counts_toward_spending(self):
        transaction = {
            "amount": 42.15,
            "pending": False,
            "personal_finance_category": {"primary": "GENERAL_SERVICES"},
            "transaction_code": "purchase",
        }

        self.assertTrue(transaction_counts_toward_spending(transaction, "depository"))
        self.assertEqual(normalize_transaction_direction(42.15, "depository"), "outflow")

    def test_pending_transaction_does_not_count(self):
        transaction = {
            "amount": 19.99,
            "pending": True,
            "personal_finance_category": {"primary": "GENERAL_MERCHANDISE"},
        }

        self.assertFalse(transaction_counts_toward_spending(transaction, "depository"))

    def test_non_depository_account_does_not_count(self):
        transaction = {
            "amount": 88.5,
            "pending": False,
            "personal_finance_category": {"primary": "GENERAL_MERCHANDISE"},
        }

        self.assertFalse(transaction_counts_toward_spending(transaction, "credit"))

    def test_inflow_does_not_count(self):
        transaction = {
            "amount": -1200.0,
            "pending": False,
            "personal_finance_category": {"primary": "INCOME"},
        }

        self.assertFalse(transaction_counts_toward_spending(transaction, "depository"))
        self.assertEqual(normalize_transaction_direction(-1200.0, "depository"), "inflow")

    def test_transfer_and_credit_card_payment_are_excluded(self):
        transfer_transaction = {
            "amount": 350.0,
            "pending": False,
            "personal_finance_category": {"primary": "TRANSFER_OUT"},
            "transaction_code": "transfer",
        }
        card_payment_transaction = {
            "amount": 125.0,
            "pending": False,
            "personal_finance_category": {
                "primary": "LOAN_PAYMENTS",
                "detailed": "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
            },
            "transaction_code": "bill payment",
        }

        self.assertTrue(is_transfer_like_transaction(transfer_transaction))
        self.assertTrue(is_transfer_like_transaction(card_payment_transaction))
        self.assertFalse(transaction_counts_toward_spending(transfer_transaction, "depository"))
        self.assertFalse(transaction_counts_toward_spending(card_payment_transaction, "depository"))


class PlaidLinkTokenConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_link_token_for_initial_connect_includes_products(self):
        service = PlaidService()
        service.client_id = "client-id"
        service.secret = "secret"
        service.env = "production"
        service.redirect_uri = "https://app.ritual.so/integrations"
        service.country_codes = ["US"]
        service.products = ["transactions"]
        service.days_requested = 180
        service.webhook_url = "https://api.ritual.so/api/financial/plaid/webhook"

        captured = {}

        async def fake_post(path, payload):
            captured["path"] = path
            captured["payload"] = payload
            return {"link_token": "link-sandbox-token"}

        service._post = fake_post  # type: ignore[method-assign]

        await service.create_link_token("user-123")

        self.assertEqual(captured["path"], "/link/token/create")
        self.assertEqual(captured["payload"]["products"], ["transactions"])
        self.assertEqual(captured["payload"]["transactions"], {"days_requested": 180})
        self.assertEqual(captured["payload"]["redirect_uri"], "https://app.ritual.so/integrations")

    async def test_create_link_token_for_update_mode_omits_products(self):
        service = PlaidService()
        service.client_id = "client-id"
        service.secret = "secret"
        service.env = "production"
        service.redirect_uri = "https://app.ritual.so/integrations"
        service.country_codes = ["US"]

        captured = {}

        async def fake_post(path, payload):
            captured["path"] = path
            captured["payload"] = payload
            return {"link_token": "link-update-token"}

        service._post = fake_post  # type: ignore[method-assign]

        await service.create_link_token(
            "user-123",
            access_token="access-token",
            account_selection_enabled=True,
        )

        self.assertEqual(captured["path"], "/link/token/create")
        self.assertEqual(captured["payload"]["access_token"], "access-token")
        self.assertEqual(captured["payload"]["update"], {"account_selection_enabled": True})
        self.assertNotIn("products", captured["payload"])
        self.assertNotIn("transactions", captured["payload"])

    async def test_production_requires_redirect_uri(self):
        service = PlaidService()
        service.client_id = "client-id"
        service.secret = "secret"
        service.env = "production"
        service.redirect_uri = None

        with self.assertRaises(RuntimeError):
            await service.create_link_token("user-123")


if __name__ == "__main__":
    unittest.main()
