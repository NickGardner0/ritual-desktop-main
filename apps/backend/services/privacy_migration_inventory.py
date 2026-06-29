"""Privacy migration inventory, dry-run, and supported migration helpers.

These helpers must not delete cloud data, mark backend rows migrated, or trigger
provider/AI sync. Pass 2C supports actual local-vault migration only for
categories with category-specific extraction and verification tests.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import delete, func, select

from database.connection import get_db_session
from database.models import (
    AIConversationDB,
    AIMessageDB,
    ActivityEventDB,
    AfkEventDB,
    AiFactDB,
    ArtifactDB,
    DailyActivityRollupDB,
    DomainDailyRollupDB,
    FinancialAccountDB,
    FinancialTransactionDB,
    HabitAliasDB,
    HabitDB,
    HabitLogDB,
    ImportItemDB,
    ImportRunDB,
    ReportRunDB,
    ScheduledBlockDB,
    SmsCopilotEventDB,
    RoutineDB,
    RoutineRunDB,
    TaskDB,
    TaskEventDB,
    UserLocationPingDB,
    UserLocationStateDB,
    WatcherSyncOutboxDB,
    WearableConnectionDB,
    WearableEventDB,
    WearableRawPayloadDB,
    WearableSampleDB,
    WorkflowRunDB,
)


@dataclass(frozen=True)
class InventoryCategorySpec:
    source: str
    category: str
    model: Any
    description: str


DIRECT_USER_SPECS: tuple[InventoryCategorySpec, ...] = (
    InventoryCategorySpec("backend_turso", "habit_definitions", HabitDB, "Habit definitions"),
    InventoryCategorySpec("backend_turso", "scheduled_blocks", ScheduledBlockDB, "Scheduled calendar blocks"),
    InventoryCategorySpec("backend_turso", "import_runs", ImportRunDB, "Import run manifests"),
    InventoryCategorySpec("backend_turso", "wearable_raw_payloads", WearableRawPayloadDB, "Raw wearable provider payloads"),
    InventoryCategorySpec("backend_turso", "wearable_samples", WearableSampleDB, "Normalized wearable samples"),
    InventoryCategorySpec("backend_turso", "wearable_events", WearableEventDB, "Normalized wearable events"),
    InventoryCategorySpec("backend_turso", "wearable_connections", WearableConnectionDB, "Wearable provider connections"),
    InventoryCategorySpec("backend_turso", "location_pings", UserLocationPingDB, "Location pings"),
    InventoryCategorySpec("backend_turso", "location_state", UserLocationStateDB, "Current location state"),
    InventoryCategorySpec("backend_turso", "desktop_activity_events", ActivityEventDB, "Desktop activity events"),
    InventoryCategorySpec("backend_turso", "desktop_afk_events", AfkEventDB, "Desktop AFK events"),
    InventoryCategorySpec("backend_turso", "desktop_daily_rollups", DailyActivityRollupDB, "Desktop daily rollups"),
    InventoryCategorySpec("backend_turso", "desktop_domain_rollups", DomainDailyRollupDB, "Desktop domain rollups"),
    InventoryCategorySpec("backend_turso", "desktop_sync_outbox", WatcherSyncOutboxDB, "Desktop sync outbox rows"),
    InventoryCategorySpec("backend_turso", "ai_conversations", AIConversationDB, "AI conversations"),
    InventoryCategorySpec("backend_turso", "ai_facts", AiFactDB, "AI facts"),
    InventoryCategorySpec("backend_turso", "artifacts", ArtifactDB, "Generated artifacts"),
    InventoryCategorySpec("backend_turso", "reports", ReportRunDB, "Generated report runs"),
    InventoryCategorySpec("backend_turso", "tasks", TaskDB, "Tasks"),
    InventoryCategorySpec("backend_turso", "task_events", TaskEventDB, "Task activity events"),
    InventoryCategorySpec("backend_turso", "routines", RoutineDB, "Routines"),
    InventoryCategorySpec("backend_turso", "routine_runs", RoutineRunDB, "Routine runs"),
    InventoryCategorySpec("backend_turso", "workflows", WorkflowRunDB, "Workflow runs"),
    InventoryCategorySpec("backend_turso", "sms_copilot", SmsCopilotEventDB, "SMS copilot events"),
    InventoryCategorySpec("backend_turso", "financial_accounts", FinancialAccountDB, "Financial accounts"),
    InventoryCategorySpec("backend_turso", "financial_transactions", FinancialTransactionDB, "Financial transactions"),
)

SUPPORTED_MIGRATION_CATEGORIES = {
    "ai_conversations": "AI conversations",
    "ai_facts": "AI facts",
    "ai_messages": "AI messages",
    "artifacts": "Generated artifacts",
    "financial_accounts": "Financial accounts",
    "financial_transactions": "Financial transactions",
    "habit_definitions": "Habit definitions",
    "habit_logs": "Habit logs",
    "import_items": "Import source rows",
    "import_runs": "Import run manifests",
    "location_pings": "Location pings",
    "location_state": "Current location state",
    "reports": "Generated report runs",
    "tasks": "Tasks",
    "task_events": "Task activity events",
    "routines": "Routines",
    "routine_runs": "Routine runs",
    "scheduled_blocks": "Scheduled calendar blocks",
    "sms_copilot": "SMS copilot events",
    "wearable_events": "Normalized wearable events",
    "wearable_samples": "Normalized wearable samples",
    "workflows": "Workflow runs",
}

SUPPORTED_DELETION_CATEGORIES = {
    category: description
    for category, description in SUPPORTED_MIGRATION_CATEGORIES.items()
}

DELETION_PARENT_DEPENDENCIES = {
    "ai_conversations": {"ai_messages"},
    "financial_accounts": {"financial_transactions"},
    "habit_definitions": {"habit_logs"},
    "import_runs": {"import_items"},
    "routines": {"routine_runs", "tasks"},
    "tasks": {"task_events"},
}

DIRECT_MIGRATION_MODELS = {
    "ai_conversations": (AIConversationDB, "ai_conversation"),
    "ai_facts": (AiFactDB, "ai_fact"),
    "artifacts": (ArtifactDB, "artifact"),
    "financial_accounts": (FinancialAccountDB, "financial_account"),
    "financial_transactions": (FinancialTransactionDB, "financial_transaction"),
    "import_runs": (ImportRunDB, "import_run"),
    "location_pings": (UserLocationPingDB, "location_ping"),
    "location_state": (UserLocationStateDB, "location_state"),
    "reports": (ReportRunDB, "report_run"),
    "tasks": (TaskDB, "task"),
    "task_events": (TaskEventDB, "task_event"),
    "routines": (RoutineDB, "routine"),
    "routine_runs": (RoutineRunDB, "routine_run"),
    "scheduled_blocks": (ScheduledBlockDB, "scheduled_block"),
    "sms_copilot": (SmsCopilotEventDB, "sms_copilot_event"),
    "wearable_events": (WearableEventDB, "wearable_event"),
    "wearable_samples": (WearableSampleDB, "wearable_sample"),
    "workflows": (WorkflowRunDB, "workflow_run"),
}


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _stable_hash(value: Any) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        default=_json_default,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _records_hash(records: List[Dict[str, Any]]) -> str:
    normalized = sorted(records, key=lambda item: (item["collection"], item["record_id"]))
    return _stable_hash(normalized)


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _payload_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


async def _count_direct(session: Any, spec: InventoryCategorySpec, user_id: str) -> int:
    column = getattr(spec.model, "user_id", None)
    if column is None:
        return 0
    result = await session.execute(
        select(func.count()).select_from(spec.model).where(column == user_id)
    )
    return int(result.scalar_one() or 0)


async def _count_habit_logs(session: Any, user_id: str) -> int:
    result = await session.execute(
        select(func.count(HabitLogDB.id)).join(HabitDB).where(HabitDB.user_id == user_id)
    )
    return int(result.scalar_one() or 0)


async def _count_habit_aliases(session: Any, user_id: str) -> int:
    result = await session.execute(
        select(func.count(HabitAliasDB.id)).join(HabitDB).where(HabitDB.user_id == user_id)
    )
    return int(result.scalar_one() or 0)


async def _count_import_items(session: Any, user_id: str) -> int:
    result = await session.execute(
        select(func.count(ImportItemDB.id)).join(ImportRunDB).where(ImportRunDB.user_id == user_id)
    )
    return int(result.scalar_one() or 0)


async def _count_ai_messages(session: Any, user_id: str) -> int:
    result = await session.execute(
        select(func.count(AIMessageDB.id)).join(AIConversationDB).where(AIConversationDB.user_id == user_id)
    )
    return int(result.scalar_one() or 0)


async def get_privacy_migration_inventory(user_id: str) -> Dict[str, Any]:
    checked_at = _now_iso()
    categories: List[Dict[str, Any]] = []

    async with get_db_session() as session:
        for spec in DIRECT_USER_SPECS:
            categories.append(
                {
                    "source": spec.source,
                    "category": spec.category,
                    "description": spec.description,
                    "record_count": await _count_direct(session, spec, user_id),
                    "status": "counted",
                    "checked_at": checked_at,
                }
            )

        categories.extend(
            [
                {
                    "source": "backend_turso",
                    "category": "habit_logs",
                    "description": "Habit logs",
                    "record_count": await _count_habit_logs(session, user_id),
                    "status": "counted",
                    "checked_at": checked_at,
                },
                {
                    "source": "backend_turso",
                    "category": "habit_aliases",
                    "description": "Habit aliases",
                    "record_count": await _count_habit_aliases(session, user_id),
                    "status": "counted",
                    "checked_at": checked_at,
                },
                {
                    "source": "backend_turso",
                    "category": "import_items",
                    "description": "Import source rows",
                    "record_count": await _count_import_items(session, user_id),
                    "status": "counted",
                    "checked_at": checked_at,
                },
                {
                    "source": "backend_turso",
                    "category": "ai_messages",
                    "description": "AI messages",
                    "record_count": await _count_ai_messages(session, user_id),
                    "status": "counted",
                    "checked_at": checked_at,
                },
            ]
        )

    categories.sort(key=lambda item: (item["source"], item["category"]))
    return {
        "user_id": user_id,
        "checked_at": checked_at,
        "mode": "inventory_only",
        "deletes_cloud_data": False,
        "categories": categories,
        "total_records": sum(int(item["record_count"]) for item in categories),
    }


def _habit_payload(habit: HabitDB) -> Dict[str, Any]:
    return {
        "id": habit.id,
        "user_id": habit.user_id,
        "name": habit.name,
        "category": habit.category,
        "icon": habit.icon,
        "is_custom": bool(habit.is_custom),
        "integration_source": habit.integration_source,
        "unit_type": habit.unit_type,
        "sensor_type": habit.sensor_type,
        "metric_type": habit.metric_type,
        "created_at": _iso(habit.created_at),
        "updated_at": _iso(habit.updated_at),
    }


def _habit_log_payload(log: HabitLogDB) -> Dict[str, Any]:
    return {
        "id": log.id,
        "habit_id": log.habit_id,
        "habit_name": log.habit_name,
        "duration": log.duration or 0,
        "amount": log.amount,
        "date": log.date,
        "completed_at": _iso(log.completed_at),
        "status": log.status,
        "notes": log.notes,
        "log_metadata": log.log_metadata,
        "source": log.source,
        "origin_record_kind": log.origin_record_kind,
        "origin_record_id": log.origin_record_id,
        "location_lat": log.location_lat,
        "location_lon": log.location_lon,
        "location_accuracy_m": log.location_accuracy_m,
        "location_source": log.location_source,
        "location_place_label": log.location_place_label,
        "location_confidence": log.location_confidence,
        "location_resolved_at": _iso(log.location_resolved_at),
        "location_signal_age_ms": log.location_signal_age_ms,
    }


def _habit_migration_record(habit: HabitDB) -> Dict[str, Any]:
    return {
        "collection": "habit_definitions",
        "record_id": habit.id,
        "record_type": "habit_definition",
        "updated_at": _iso(habit.updated_at) or _iso(habit.created_at),
        "payload": _habit_payload(habit),
    }


def _habit_log_migration_record(log: HabitLogDB) -> Dict[str, Any]:
    return {
        "collection": "habit_logs",
        "record_id": log.id,
        "record_type": "habit_log",
        "updated_at": _iso(log.completed_at) or log.date,
        "payload": _habit_log_payload(log),
    }


def _model_payload(row: Any) -> Dict[str, Any]:
    return {
        column.name: _payload_value(getattr(row, column.name))
        for column in row.__table__.columns
    }


def _first_present(row: Any, names: Iterable[str]) -> Optional[str]:
    for name in names:
        if hasattr(row, name):
            value = getattr(row, name)
            if value is not None:
                return _iso(value)
    return None


def _record_id(row: Any, fallback_prefix: str) -> str:
    value = getattr(row, "id", None)
    if value is not None:
        return str(value)
    user_id = getattr(row, "user_id", None)
    if user_id is not None:
        return f"{fallback_prefix}:{user_id}"
    return f"{fallback_prefix}:{_stable_hash(_model_payload(row))}"


def _direct_migration_record(category: str, record_type: str, row: Any) -> Dict[str, Any]:
    return {
        "collection": category,
        "record_id": _record_id(row, category),
        "record_type": record_type,
        "updated_at": _first_present(
            row,
            (
                "updated_at",
                "created_at",
                "completed_at",
                "generated_at",
                "sent_at",
                "recorded_at",
                "start_time",
                "transaction_date",
                "client_ts",
            ),
        ),
        "payload": _model_payload(row),
    }


def _import_item_migration_record(item: ImportItemDB) -> Dict[str, Any]:
    return {
        "collection": "import_items",
        "record_id": item.id,
        "record_type": "import_item",
        "updated_at": item.date,
        "payload": _model_payload(item),
    }


def _ai_message_migration_record(message: AIMessageDB) -> Dict[str, Any]:
    return {
        "collection": "ai_messages",
        "record_id": message.id,
        "record_type": "ai_message",
        "updated_at": _iso(message.created_at),
        "payload": _model_payload(message),
    }


def _validate_supported_categories(categories: Optional[Iterable[str]]) -> List[str]:
    selected = [
        item.strip()
        for item in (categories or SUPPORTED_MIGRATION_CATEGORIES.keys())
        if item and item.strip()
    ]
    if not selected:
        selected = list(SUPPORTED_MIGRATION_CATEGORIES.keys())

    unsupported = sorted(set(selected) - set(SUPPORTED_MIGRATION_CATEGORIES))
    if unsupported:
        raise ValueError(f"Unsupported migration categories: {', '.join(unsupported)}")

    return sorted(set(selected))


def _validate_deletion_categories(categories: Optional[Iterable[str]]) -> List[str]:
    selected = [
        item.strip()
        for item in (categories or SUPPORTED_DELETION_CATEGORIES.keys())
        if item and item.strip()
    ]
    if not selected:
        selected = list(SUPPORTED_DELETION_CATEGORIES.keys())

    unsupported = sorted(set(selected) - set(SUPPORTED_DELETION_CATEGORIES))
    if unsupported:
        raise ValueError(f"Unsupported deletion categories: {', '.join(unsupported)}")

    selected_set = set(selected)
    missing_dependencies = {
        category: sorted(required - selected_set)
        for category, required in DELETION_PARENT_DEPENDENCIES.items()
        if category in selected_set and not required.issubset(selected_set)
    }
    if missing_dependencies:
        details = "; ".join(
            f"{category} requires {', '.join(required)}"
            for category, required in sorted(missing_dependencies.items())
        )
        raise ValueError(f"Unsafe deletion category selection: {details}")

    return sorted(selected_set)


async def _load_habit_definition_records(
    session: Any,
    user_id: str,
    *,
    offset: int = 0,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    query = (
        select(HabitDB)
        .where(HabitDB.user_id == user_id)
        .order_by(HabitDB.id.asc())
        .offset(max(0, int(offset or 0)))
    )
    if limit is not None:
        query = query.limit(max(1, int(limit)))

    result = await session.execute(query)
    return [_habit_migration_record(habit) for habit in result.scalars().all()]


async def _load_habit_log_records(
    session: Any,
    user_id: str,
    *,
    offset: int = 0,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    query = (
        select(HabitLogDB)
        .join(HabitDB)
        .where(HabitDB.user_id == user_id)
        .order_by(HabitLogDB.id.asc())
        .offset(max(0, int(offset or 0)))
    )
    if limit is not None:
        query = query.limit(max(1, int(limit)))

    result = await session.execute(query)
    return [_habit_log_migration_record(log) for log in result.scalars().all()]


async def _load_direct_records(
    session: Any,
    user_id: str,
    category: str,
    *,
    offset: int = 0,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    model, record_type = DIRECT_MIGRATION_MODELS[category]
    query = (
        select(model)
        .where(getattr(model, "user_id") == user_id)
        .order_by(getattr(model, "id", getattr(model, "user_id")).asc())
        .offset(max(0, int(offset or 0)))
    )
    if limit is not None:
        query = query.limit(max(1, int(limit)))

    result = await session.execute(query)
    return [
        _direct_migration_record(category, record_type, row)
        for row in result.scalars().all()
    ]


async def _load_import_item_records(
    session: Any,
    user_id: str,
    *,
    offset: int = 0,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    query = (
        select(ImportItemDB)
        .join(ImportRunDB)
        .where(ImportRunDB.user_id == user_id)
        .order_by(ImportItemDB.id.asc())
        .offset(max(0, int(offset or 0)))
    )
    if limit is not None:
        query = query.limit(max(1, int(limit)))

    result = await session.execute(query)
    return [_import_item_migration_record(item) for item in result.scalars().all()]


async def _load_ai_message_records(
    session: Any,
    user_id: str,
    *,
    offset: int = 0,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    query = (
        select(AIMessageDB)
        .join(AIConversationDB)
        .where(AIConversationDB.user_id == user_id)
        .order_by(AIMessageDB.id.asc())
        .offset(max(0, int(offset or 0)))
    )
    if limit is not None:
        query = query.limit(max(1, int(limit)))

    result = await session.execute(query)
    return [_ai_message_migration_record(message) for message in result.scalars().all()]


async def _load_migration_records(
    session: Any,
    user_id: str,
    category: str,
    *,
    offset: int = 0,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    if category == "habit_definitions":
        return await _load_habit_definition_records(session, user_id, offset=offset, limit=limit)
    if category == "habit_logs":
        return await _load_habit_log_records(session, user_id, offset=offset, limit=limit)
    if category == "import_items":
        return await _load_import_item_records(session, user_id, offset=offset, limit=limit)
    if category == "ai_messages":
        return await _load_ai_message_records(session, user_id, offset=offset, limit=limit)
    if category in DIRECT_MIGRATION_MODELS:
        return await _load_direct_records(session, user_id, category, offset=offset, limit=limit)
    raise ValueError(f"Unsupported migration category: {category}")


async def _delete_habit_log_records(session: Any, user_id: str) -> int:
    habit_ids = select(HabitDB.id).where(HabitDB.user_id == user_id)
    result = await session.execute(delete(HabitLogDB).where(HabitLogDB.habit_id.in_(habit_ids)))
    return int(result.rowcount or 0)


async def _delete_import_item_records(session: Any, user_id: str) -> int:
    import_run_ids = select(ImportRunDB.id).where(ImportRunDB.user_id == user_id)
    result = await session.execute(delete(ImportItemDB).where(ImportItemDB.import_run_id.in_(import_run_ids)))
    return int(result.rowcount or 0)


async def _delete_ai_message_records(session: Any, user_id: str) -> int:
    conversation_ids = select(AIConversationDB.id).where(AIConversationDB.user_id == user_id)
    result = await session.execute(delete(AIMessageDB).where(AIMessageDB.conversation_id.in_(conversation_ids)))
    return int(result.rowcount or 0)


async def _delete_direct_records(session: Any, user_id: str, category: str) -> int:
    if category == "habit_definitions":
        result = await session.execute(delete(HabitDB).where(HabitDB.user_id == user_id))
        return int(result.rowcount or 0)
    model, _record_type = DIRECT_MIGRATION_MODELS[category]
    result = await session.execute(delete(model).where(getattr(model, "user_id") == user_id))
    return int(result.rowcount or 0)


async def _delete_category_records(session: Any, user_id: str, category: str) -> int:
    if category == "habit_logs":
        return await _delete_habit_log_records(session, user_id)
    if category == "import_items":
        return await _delete_import_item_records(session, user_id)
    if category == "ai_messages":
        return await _delete_ai_message_records(session, user_id)
    if category == "habit_definitions":
        return await _delete_direct_records(session, user_id, category)
    if category in DIRECT_MIGRATION_MODELS:
        return await _delete_direct_records(session, user_id, category)
    raise ValueError(f"Unsupported deletion category: {category}")


def _deletion_execution_order(categories: Iterable[str]) -> List[str]:
    selected = set(categories)
    preferred = [
        "habit_logs",
        "import_items",
        "ai_messages",
        "financial_transactions",
        "wearable_samples",
        "wearable_events",
        "location_pings",
        "location_state",
        "ai_facts",
        "artifacts",
        "reports",
        "task_events",
        "routine_runs",
        "tasks",
        "routines",
        "workflows",
        "sms_copilot",
        "scheduled_blocks",
        "financial_accounts",
        "import_runs",
        "ai_conversations",
        "habit_definitions",
    ]
    return [category for category in preferred if category in selected]


async def build_privacy_deletion_plan(
    user_id: str,
    *,
    categories: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    selected_categories = _validate_deletion_categories(categories)
    planned_categories: List[Dict[str, Any]] = []
    all_records: List[Dict[str, Any]] = []

    async with get_db_session() as session:
        for category in selected_categories:
            records = await _load_migration_records(session, user_id, category)
            all_records.extend(records)
            planned_categories.append(
                {
                    "category": category,
                    "description": SUPPORTED_DELETION_CATEGORIES[category],
                    "record_count": len(records),
                    "source_hash": _records_hash(records),
                    "supported": True,
                    "execution": "backend_turso_delete",
                }
            )

    return {
        "user_id": user_id,
        "mode": "deletion_plan",
        "deletes_cloud_data": True,
        "changes_source_of_truth": True,
        "requires_local_receipt": True,
        "supported_categories": sorted(SUPPORTED_DELETION_CATEGORIES),
        "categories": planned_categories,
        "total_records": len(all_records),
        "source_hash": _records_hash(all_records),
        "planned_at": _now_iso(),
        "limitations": [
            "Deletes approved backend Turso behavioral rows only.",
            "Provider account disconnect, Sentry/OpenPanel/Tinybird historical erasure, E2EE sync, and File-over-App export remain separate stages.",
        ],
    }


async def execute_privacy_cloud_deletion(
    user_id: str,
    *,
    categories: Iterable[str],
    deletion_id: str,
    local_receipt_id: str,
    confirm_behavioral_cloud_deletion: bool,
) -> Dict[str, Any]:
    if not confirm_behavioral_cloud_deletion:
        raise ValueError("Cloud behavioral deletion requires explicit confirmation.")
    if not deletion_id or not deletion_id.strip():
        raise ValueError("Cloud behavioral deletion requires a deletion_id.")
    if not local_receipt_id or not local_receipt_id.strip():
        raise ValueError("Cloud behavioral deletion requires a local receipt id.")

    selected_categories = _validate_deletion_categories(categories)
    before_plan = await build_privacy_deletion_plan(user_id, categories=selected_categories)
    receipts: List[Dict[str, Any]] = []

    async with get_db_session() as session:
        for category in _deletion_execution_order(selected_categories):
            before = next(
                item
                for item in before_plan["categories"]
                if item["category"] == category
            )
            deleted_count = await _delete_category_records(session, user_id, category)
            receipts.append(
                {
                    "category": category,
                    "source": "backend_turso",
                    "status": "deleted",
                    "record_count_before": int(before["record_count"]),
                    "deleted_count": deleted_count,
                    "source_hash_before": before["source_hash"],
                    "completed_at": _now_iso(),
                }
            )
        await session.commit()

    after_plan = await build_privacy_deletion_plan(user_id, categories=selected_categories)
    return {
        "user_id": user_id,
        "mode": "deletion_execute",
        "deletion_id": deletion_id.strip(),
        "local_receipt_id": local_receipt_id.strip(),
        "deletes_cloud_data": True,
        "changes_source_of_truth": True,
        "categories": receipts,
        "requested_categories": selected_categories,
        "record_count_before": int(before_plan["total_records"]),
        "deleted_count": sum(int(item["deleted_count"]) for item in receipts),
        "remaining_count": int(after_plan["total_records"]),
        "source_hash_before": before_plan["source_hash"],
        "source_hash_after": after_plan["source_hash"],
        "completed_at": _now_iso(),
        "limitations": before_plan["limitations"],
    }


async def build_privacy_migration_plan(
    user_id: str,
    *,
    categories: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    selected_categories = _validate_supported_categories(categories)
    planned_categories: List[Dict[str, Any]] = []
    all_records: List[Dict[str, Any]] = []

    async with get_db_session() as session:
        for category in selected_categories:
            records = await _load_migration_records(session, user_id, category)
            all_records.extend(records)
            planned_categories.append(
                {
                    "category": category,
                    "description": SUPPORTED_MIGRATION_CATEGORIES[category],
                    "record_count": len(records),
                    "source_hash": _records_hash(records),
                    "supported": True,
                }
            )

    return {
        "user_id": user_id,
        "mode": "migration_plan",
        "deletes_cloud_data": False,
        "changes_source_of_truth": False,
        "supported_categories": sorted(SUPPORTED_MIGRATION_CATEGORIES),
        "categories": planned_categories,
        "total_records": len(all_records),
        "source_hash": _records_hash(all_records),
        "planned_at": _now_iso(),
    }


async def build_privacy_migration_records_batch(
    user_id: str,
    *,
    category: str,
    offset: int = 0,
    limit: int = 250,
) -> Dict[str, Any]:
    selected_category = _validate_supported_categories([category])[0]
    offset = max(0, int(offset or 0))
    limit = max(1, min(int(limit or 250), 1000))

    async with get_db_session() as session:
        all_records = await _load_migration_records(session, user_id, selected_category)
        records = all_records[offset : offset + limit]

    next_offset = offset + len(records)
    return {
        "user_id": user_id,
        "mode": "migration_records",
        "deletes_cloud_data": False,
        "changes_source_of_truth": False,
        "category": selected_category,
        "offset": offset,
        "limit": limit,
        "returned_count": len(records),
        "total_records": len(all_records),
        "next_offset": next_offset if next_offset < len(all_records) else None,
        "source_hash": _records_hash(all_records),
        "records": records,
    }


async def build_privacy_migration_dry_run(
    user_id: str,
    *,
    categories: Optional[Iterable[str]] = None,
    sample_limit: int = 5,
) -> Dict[str, Any]:
    allowed_categories = set(categories or {"habit_definitions", "habit_logs"})
    sample_limit = max(1, min(int(sample_limit or 5), 25))
    samples: List[Dict[str, Any]] = []

    async with get_db_session() as session:
        if "habit_definitions" in allowed_categories:
            result = await session.execute(
                select(HabitDB)
                .where(HabitDB.user_id == user_id)
                .order_by(HabitDB.updated_at.desc(), HabitDB.id.asc())
                .limit(sample_limit)
            )
            for habit in result.scalars().all():
                samples.append(_habit_migration_record(habit))

        if "habit_logs" in allowed_categories:
            result = await session.execute(
                select(HabitLogDB)
                .join(HabitDB)
                .where(HabitDB.user_id == user_id)
                .order_by(HabitLogDB.completed_at.desc(), HabitLogDB.id.asc())
                .limit(sample_limit)
            )
            for log in result.scalars().all():
                samples.append(_habit_log_migration_record(log))

    return {
        "user_id": user_id,
        "mode": "dry_run",
        "deletes_cloud_data": False,
        "changes_source_of_truth": False,
        "sample_limit": sample_limit,
        "categories": sorted(allowed_categories),
        "sample_count": len(samples),
        "sample_hash": _stable_hash(samples),
        "samples": samples,
    }
