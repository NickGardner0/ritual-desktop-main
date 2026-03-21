"""Unit tests for financial connection settings helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.financial_connection_service import FinancialConnectionService


class FinancialConnectionSettingsTests(unittest.TestCase):
    def test_get_sync_settings_defaults(self):
        settings = FinancialConnectionService.get_sync_settings(None)

        self.assertTrue(settings["auto_sync_enabled"])
        self.assertEqual(settings["sync_hour"], 9)
        self.assertEqual(settings["excluded_account_ids"], [])

    def test_get_sync_settings_parses_exclusions(self):
        settings = FinancialConnectionService.get_sync_settings(
            '{"auto_sync_enabled": false, "sync_hour": 14, "excluded_account_ids": ["acc_1", "acc_2"]}'
        )

        self.assertFalse(settings["auto_sync_enabled"])
        self.assertEqual(settings["sync_hour"], 14)
        self.assertEqual(settings["excluded_account_ids"], ["acc_1", "acc_2"])

    def test_error_requires_reconnect_for_item_login_required(self):
        self.assertTrue(
            FinancialConnectionService.error_requires_reconnect(
                {"error_code": "ITEM_LOGIN_REQUIRED"}
            )
        )

    def test_error_requires_reconnect_for_pending_disconnect_webhook(self):
        self.assertTrue(
            FinancialConnectionService.error_requires_reconnect(
                {"webhook_code": "PENDING_DISCONNECT"}
            )
        )

    def test_error_requires_reconnect_ignores_non_reauth_errors(self):
        self.assertFalse(
            FinancialConnectionService.error_requires_reconnect(
                {"error_code": "INTERNAL_SERVER_ERROR"}
            )
        )


if __name__ == "__main__":
    unittest.main()
