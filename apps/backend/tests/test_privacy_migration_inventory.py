from __future__ import annotations

import tempfile
import unittest
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
import sys
from unittest.mock import patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import (
    AIConversationDB,
    AIMessageDB,
    AiFactDB,
    ArtifactDB,
    Base,
    FinancialAccountDB,
    FinancialTransactionDB,
    HabitDB,
    HabitLogDB,
    ImportItemDB,
    ImportRunDB,
    ReportRunDB,
    ScheduledBlockDB,
    SmsCopilotEventDB,
    UserDB,
    UserLocationPingDB,
    UserLocationStateDB,
    WearableEventDB,
    WearableSampleDB,
    WorkflowRunDB,
)
from services.privacy_migration_inventory import (
    SUPPORTED_DELETION_CATEGORIES,
    SUPPORTED_MIGRATION_CATEGORIES,
    build_privacy_deletion_plan,
    build_privacy_migration_dry_run,
    build_privacy_migration_plan,
    build_privacy_migration_records_batch,
    execute_privacy_cloud_deletion,
    get_privacy_migration_inventory,
)


class PrivacyMigrationInventoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "privacy-inventory.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with self.Session() as session:
            session.add(
                UserDB(
                    id="user-privacy-inventory",
                    email="privacy@example.com",
                    full_name="Privacy User",
                )
            )
            session.add(
                HabitDB(
                    id="habit-private",
                    user_id="user-privacy-inventory",
                    name="Private Medication",
                    category="Health",
                    icon="pill",
                    is_custom=True,
                    unit_type="count",
                    sensor_type="Manual",
                    created_at=datetime(2026, 6, 22),
                    updated_at=datetime(2026, 6, 23),
                )
            )
            session.add(
                HabitLogDB(
                    id="log-private",
                    habit_id="habit-private",
                    habit_name="Private Medication",
                    duration=0,
                    amount=2,
                    date="2026-06-23",
                    completed_at="2026-06-23T12:00:00Z",
                    status="completed",
                    notes="sensitive dosage note",
                    log_metadata='{"dose":"private"}',
                    location_place_label="Home",
                )
            )
            session.add(
                ScheduledBlockDB(
                    id="block-private",
                    user_id="user-privacy-inventory",
                    title="Therapy",
                    day="2026-06-23",
                    start_minutes=540,
                    end_minutes=600,
                )
            )
            session.add(
                ImportRunDB(
                    id="import-private",
                    user_id="user-privacy-inventory",
                    source="csv",
                    file_name="private.csv",
                    status="completed",
                )
            )
            session.add(
                ImportItemDB(
                    id="import-item-private",
                    import_run_id="import-private",
                    habit_key="csv:Private Medication",
                    habit_name="Private Medication",
                    date="2026-06-23",
                    raw_json='{"dose":"private"}',
                )
            )
            session.add(
                WearableSampleDB(
                    id="wearable-sample-private",
                    user_id="user-privacy-inventory",
                    provider="apple_health",
                    metric_type="steps",
                    value=1234,
                    unit="count",
                )
            )
            session.add(
                WearableEventDB(
                    id="wearable-event-private",
                    user_id="user-privacy-inventory",
                    provider="apple_health",
                    event_type="workout",
                    start_time=datetime(2026, 6, 23, 7, 0, 0),
                    end_time=datetime(2026, 6, 23, 8, 0, 0),
                    title="Private workout",
                )
            )
            session.add(
                UserLocationPingDB(
                    user_id="user-privacy-inventory",
                    lat=40.7,
                    lon=-73.9,
                    horizontal_accuracy_m=10,
                    source="ios_scls",
                    client_ts=1782210000000,
                    server_ts=1782210001000,
                    raw_payload='{"place":"private"}',
                )
            )
            session.add(
                UserLocationStateDB(
                    user_id="user-privacy-inventory",
                    lat=40.7,
                    lon=-73.9,
                    source="ios_scls",
                    ping_client_ts=1782210000000,
                    updated_at=1782210001000,
                    place_label="Home",
                )
            )
            session.add(
                AIConversationDB(
                    id="conversation-private",
                    user_id="user-privacy-inventory",
                    title="Private conversation",
                    channel="app",
                )
            )
            session.add(
                AIMessageDB(
                    id="message-private",
                    conversation_id="conversation-private",
                    role="user",
                    content="private AI message",
                )
            )
            session.add(
                AiFactDB(
                    id="fact-private",
                    user_id="user-privacy-inventory",
                    category="preference",
                    subject="privacy",
                    predicate="prefers",
                    value_json='{"value":"local"}',
                )
            )
            session.add(
                ArtifactDB(
                    id="artifact-private",
                    user_id="user-privacy-inventory",
                    kind="report",
                    source_type="report_run",
                    title="Private artifact",
                    body_json='{"blocks":[]}',
                )
            )
            session.add(
                ReportRunDB(
                    id="report-private",
                    schedule_id="schedule-private",
                    user_id="user-privacy-inventory",
                    cadence="weekly",
                    period_start="2026-06-17",
                    period_end="2026-06-23",
                    subject="Private report",
                )
            )
            session.add(
                WorkflowRunDB(
                    id="workflow-private",
                    workflow_definition_id="workflow-definition-private",
                    user_id="user-privacy-inventory",
                    status="completed",
                    trigger_source="manual",
                    result_json='{"result":"private"}',
                )
            )
            session.add(
                SmsCopilotEventDB(
                    id="sms-private",
                    user_id="user-privacy-inventory",
                    kind="daily_narrative",
                    dedupe_key="sms-private",
                    body="Private SMS body",
                )
            )
            session.add(
                FinancialAccountDB(
                    id="financial-account-private",
                    user_id="user-privacy-inventory",
                    connection_id="financial-connection-private",
                    provider_account_id="provider-account-private",
                    name="Private Checking",
                    account_type="depository",
                )
            )
            session.add(
                FinancialTransactionDB(
                    id="financial-transaction-private",
                    user_id="user-privacy-inventory",
                    connection_id="financial-connection-private",
                    account_id="financial-account-private",
                    provider_transaction_id="provider-transaction-private",
                    transaction_date="2026-06-23",
                    name="Private Purchase",
                    amount=42.5,
                    direction="outflow",
                )
            )
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()
        self._tmpdir.cleanup()

    @asynccontextmanager
    async def db_session(self):
        async with self.Session() as session:
            yield session

    async def test_inventory_counts_cloud_backed_behavioral_categories(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            inventory = await get_privacy_migration_inventory("user-privacy-inventory")

        counts = {item["category"]: item["record_count"] for item in inventory["categories"]}
        self.assertEqual(inventory["deletes_cloud_data"], False)
        self.assertEqual(counts["habit_definitions"], 1)
        self.assertEqual(counts["habit_logs"], 1)
        self.assertEqual(counts["scheduled_blocks"], 1)
        self.assertGreaterEqual(inventory["total_records"], 3)

    async def test_dry_run_samples_habits_and_logs_without_source_mutation(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            first = await build_privacy_migration_dry_run(
                "user-privacy-inventory",
                categories=["habit_definitions", "habit_logs"],
                sample_limit=5,
            )
            second = await build_privacy_migration_dry_run(
                "user-privacy-inventory",
                categories=["habit_definitions", "habit_logs"],
                sample_limit=5,
            )

        self.assertEqual(first["deletes_cloud_data"], False)
        self.assertEqual(first["changes_source_of_truth"], False)
        self.assertEqual(first["sample_count"], 2)
        self.assertEqual(first["sample_hash"], second["sample_hash"])
        payloads = [sample["payload"] for sample in first["samples"]]
        self.assertTrue(any(payload.get("name") == "Private Medication" for payload in payloads))
        self.assertTrue(any(payload.get("notes") == "sensitive dosage note" for payload in payloads))

    async def test_migration_plan_hashes_supported_categories_without_cloud_deletion(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            first = await build_privacy_migration_plan(
                "user-privacy-inventory",
                categories=["habit_definitions", "habit_logs"],
            )
            second = await build_privacy_migration_plan(
                "user-privacy-inventory",
                categories=["habit_logs", "habit_definitions"],
            )

        self.assertEqual(first["deletes_cloud_data"], False)
        self.assertEqual(first["changes_source_of_truth"], False)
        self.assertEqual(first["total_records"], 2)
        self.assertEqual(first["source_hash"], second["source_hash"])
        category_counts = {item["category"]: item["record_count"] for item in first["categories"]}
        self.assertEqual(category_counts["habit_definitions"], 1)
        self.assertEqual(category_counts["habit_logs"], 1)

    async def test_migration_records_batch_pages_supported_records(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            batch = await build_privacy_migration_records_batch(
                "user-privacy-inventory",
                category="habit_logs",
                offset=0,
                limit=1,
            )

        self.assertEqual(batch["deletes_cloud_data"], False)
        self.assertEqual(batch["changes_source_of_truth"], False)
        self.assertEqual(batch["returned_count"], 1)
        self.assertEqual(batch["total_records"], 1)
        self.assertIsNone(batch["next_offset"])
        self.assertEqual(batch["records"][0]["record_id"], "log-private")
        self.assertEqual(batch["records"][0]["payload"]["notes"], "sensitive dosage note")

    async def test_migration_plan_supports_approved_extension_categories(self):
        categories = sorted(SUPPORTED_MIGRATION_CATEGORIES)
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            plan = await build_privacy_migration_plan(
                "user-privacy-inventory",
                categories=categories,
            )

        self.assertEqual(plan["deletes_cloud_data"], False)
        self.assertEqual(plan["changes_source_of_truth"], False)
        self.assertEqual(plan["supported_categories"], categories)
        category_counts = {item["category"]: item["record_count"] for item in plan["categories"]}
        for category in categories:
            self.assertEqual(category_counts[category], 1, category)
        self.assertEqual(plan["total_records"], len(categories))

    async def test_migration_records_batch_returns_extension_payloads(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            batch = await build_privacy_migration_records_batch(
                "user-privacy-inventory",
                category="financial_transactions",
                offset=0,
                limit=1,
            )

        self.assertEqual(batch["returned_count"], 1)
        self.assertEqual(batch["records"][0]["record_type"], "financial_transaction")
        self.assertEqual(batch["records"][0]["payload"]["name"], "Private Purchase")
        self.assertEqual(batch["records"][0]["payload"]["amount"], 42.5)

    async def test_migration_rejects_unsupported_categories(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            with self.assertRaises(ValueError):
                await build_privacy_migration_plan(
                    "user-privacy-inventory",
                    categories=["wearable_raw_payloads"],
                )

    async def test_deletion_plan_reports_supported_categories_without_mutation(self):
        categories = sorted(SUPPORTED_DELETION_CATEGORIES)
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            plan = await build_privacy_deletion_plan(
                "user-privacy-inventory",
                categories=categories,
            )
            inventory = await get_privacy_migration_inventory("user-privacy-inventory")

        self.assertEqual(plan["deletes_cloud_data"], True)
        self.assertEqual(plan["changes_source_of_truth"], True)
        self.assertEqual(plan["requires_local_receipt"], True)
        self.assertEqual(plan["supported_categories"], categories)
        self.assertEqual(plan["total_records"], len(categories))
        counts = {item["category"]: item["record_count"] for item in inventory["categories"]}
        self.assertEqual(counts["habit_definitions"], 1)
        self.assertEqual(counts["habit_logs"], 1)

    async def test_deletion_rejects_unsafe_parent_only_selection(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            with self.assertRaises(ValueError):
                await build_privacy_deletion_plan(
                    "user-privacy-inventory",
                    categories=["habit_definitions"],
                )

    async def test_deletion_execute_removes_cloud_behavioral_rows_and_preserves_user(self):
        categories = sorted(SUPPORTED_DELETION_CATEGORIES)
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            first = await execute_privacy_cloud_deletion(
                "user-privacy-inventory",
                categories=categories,
                deletion_id="delete-1",
                local_receipt_id="receipt-1",
                confirm_behavioral_cloud_deletion=True,
            )
            second = await execute_privacy_cloud_deletion(
                "user-privacy-inventory",
                categories=categories,
                deletion_id="delete-1",
                local_receipt_id="receipt-1",
                confirm_behavioral_cloud_deletion=True,
            )
            inventory = await get_privacy_migration_inventory("user-privacy-inventory")

        self.assertEqual(first["deletes_cloud_data"], True)
        self.assertEqual(first["record_count_before"], len(categories))
        self.assertEqual(first["deleted_count"], len(categories))
        self.assertEqual(first["remaining_count"], 0)
        self.assertEqual(second["deleted_count"], 0)
        self.assertEqual(second["remaining_count"], 0)
        counts = {item["category"]: item["record_count"] for item in inventory["categories"]}
        for category in categories:
            self.assertEqual(counts[category], 0, category)

        async with self.Session() as session:
            user = await session.get(UserDB, "user-privacy-inventory")
        self.assertIsNotNone(user)

    async def test_deletion_execute_requires_confirmation_and_receipt(self):
        with patch("services.privacy_migration_inventory.get_db_session", self.db_session):
            with self.assertRaises(ValueError):
                await execute_privacy_cloud_deletion(
                    "user-privacy-inventory",
                    categories=["habit_logs"],
                    deletion_id="delete-1",
                    local_receipt_id="receipt-1",
                    confirm_behavioral_cloud_deletion=False,
                )
            with self.assertRaises(ValueError):
                await execute_privacy_cloud_deletion(
                    "user-privacy-inventory",
                    categories=["habit_logs"],
                    deletion_id="delete-1",
                    local_receipt_id="",
                    confirm_behavioral_cloud_deletion=True,
                )


if __name__ == "__main__":
    unittest.main()
