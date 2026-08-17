import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest

from devtools.demo_habit_fixture import (
    assert_disposable_database_url,
    cleanup_demo_fixture,
    seed_demo_fixture,
)


class _FakeHabitService:
    tinybird_enabled = False

    def __init__(self):
        self.habits = {}
        self.logs = []

    async def create_habit(self, payload, user_id):
        habit = SimpleNamespace(id=f"habit-{len(self.habits) + 1}", payload=payload)
        self.habits[habit.id] = habit
        return habit

    async def log_habit(self, habit_id, payload, user_id):
        log = SimpleNamespace(id=f"log-{len(self.logs) + 1}", payload=payload)
        self.logs.append(log)
        return log

    async def get_habit_by_id(self, habit_id, user_id):
        return self.habits.get(habit_id)

    async def delete_habit(self, habit_id, user_id):
        self.habits.pop(habit_id, None)


class DemoHabitFixtureTests(unittest.IsolatedAsyncioTestCase):
    def test_rejects_remote_and_non_temporary_databases(self):
        with self.assertRaises(ValueError):
            assert_disposable_database_url("libsql://production.turso.io?authToken=secret")
        with self.assertRaises(ValueError):
            assert_disposable_database_url("sqlite:////var/lib/ritual.db")
        self.assertIsNone(assert_disposable_database_url("sqlite:///:memory:"))

    async def test_seed_returns_cleanup_receipt_and_cleanup_is_idempotent(self):
        service = _FakeHabitService()
        database_path = Path(tempfile.gettempdir()) / "ritual-demo-fixture-test.db"
        receipt = await seed_demo_fixture(
            service,
            database_url=f"sqlite:///{database_path}",
            user_id="demo-user",
            days=5,
        )

        self.assertEqual(3, len(receipt.habit_ids))
        self.assertGreater(len(receipt.log_ids), 0)
        self.assertEqual(set(receipt.habit_ids), set(service.habits))
        self.assertEqual(list(receipt.habit_ids), receipt.to_dict()["habit_ids"])

        await cleanup_demo_fixture(service, receipt)
        await cleanup_demo_fixture(service, receipt)
        self.assertEqual({}, service.habits)

    async def test_refuses_tinybird_enabled_service(self):
        service = _FakeHabitService()
        service.tinybird_enabled = True
        with self.assertRaises(ValueError):
            await seed_demo_fixture(
                service,
                database_url="sqlite:///:memory:",
                user_id="demo-user",
            )


if __name__ == "__main__":
    unittest.main()
