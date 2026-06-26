"""External privacy erasure plans and execution receipts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from services.privacy_policy import (
    SENSITIVE_TINYBIRD_DATASOURCES,
    SENSITIVE_TYPESENSE_COLLECTIONS,
)
from services.privacy_private_sync import delete_private_sync_envelopes


EXECUTABLE_TARGETS = {
    "private_sync_envelopes": "Encrypted Private Sync envelopes",
    "tinybird": "Tinybird analytics datasources",
    "typesense": "Typesense search indexes",
}

MANUAL_TARGETS = {
    "openpanel": "OpenPanel product analytics workspace",
    "sentry": "Sentry crash diagnostics workspace",
    "trigger": "Trigger.dev job/event history",
    "external_providers": "Connected third-party provider accounts",
}

SUPPORTED_EXTERNAL_ERASURE_TARGETS = {
    **EXECUTABLE_TARGETS,
    **MANUAL_TARGETS,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_targets(targets: Optional[Iterable[str]]) -> List[str]:
    selected = list(targets or SUPPORTED_EXTERNAL_ERASURE_TARGETS)
    invalid = [target for target in selected if target not in SUPPORTED_EXTERNAL_ERASURE_TARGETS]
    if invalid:
        raise ValueError(f"Unsupported external erasure target: {', '.join(sorted(invalid))}")
    if not selected:
        raise ValueError("Select at least one external erasure target.")
    return [target for target in SUPPORTED_EXTERNAL_ERASURE_TARGETS if target in selected]


def _manual_receipt(target: str) -> Dict[str, Any]:
    return {
        "target": target,
        "label": MANUAL_TARGETS[target],
        "status": "manual_required",
        "deleted_count": 0,
        "instructions": (
            "No trusted in-repo deletion API is configured for this processor. "
            "Use the provider dashboard or support erasure workflow and attach this receipt to the local vault."
        ),
    }


def build_external_erasure_plan(
    user_id: str,
    *,
    targets: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    selected = _validate_targets(targets)
    planned_targets: List[Dict[str, Any]] = []

    for target in selected:
        if target == "private_sync_envelopes":
            planned_targets.append({
                "target": target,
                "label": EXECUTABLE_TARGETS[target],
                "status": "supported_by_api",
                "execution": "backend_private_sync_delete",
            })
        elif target == "tinybird":
            planned_targets.append({
                "target": target,
                "label": EXECUTABLE_TARGETS[target],
                "status": "supported_by_api",
                "execution": "tinybird_delete_api",
                "datasources": sorted(SENSITIVE_TINYBIRD_DATASOURCES),
            })
        elif target == "typesense":
            planned_targets.append({
                "target": target,
                "label": EXECUTABLE_TARGETS[target],
                "status": "supported_by_api",
                "execution": "typesense_delete_by_user",
                "collections": sorted(SENSITIVE_TYPESENSE_COLLECTIONS),
            })
        else:
            planned_targets.append(_manual_receipt(target))

    return {
        "user_id": user_id,
        "mode": "external_erasure_plan",
        "deletes_cloud_data": True,
        "requires_local_receipt": True,
        "targets": planned_targets,
        "supported_targets": sorted(SUPPORTED_EXTERNAL_ERASURE_TARGETS),
        "planned_at": _now_iso(),
        "limitations": [
            "Targets without a configured deletion API return manual-required receipts instead of pretending erasure completed.",
            "Tinybird deletes are scoped by user_id against sensitive datasources known to Ritual's privacy policy.",
            "Typesense deletes are scoped by user_id across sensitive search collections.",
        ],
    }


def _tinybird_delete_condition(user_id: str) -> str:
    escaped_user_id = user_id.replace("\\", "\\\\").replace("'", "\\'")
    return f"user_id = '{escaped_user_id}'"


async def _execute_tinybird_erasure(user_id: str, tinybird_service: Any = None) -> Dict[str, Any]:
    if tinybird_service is None:
        try:
            from services.tinybird_service import TinybirdService

            tinybird_service = TinybirdService()
        except Exception as error:
            return {
                "target": "tinybird",
                "status": "unavailable",
                "deleted_count": 0,
                "error": str(error),
            }

    datasource_receipts: List[Dict[str, Any]] = []
    condition = _tinybird_delete_condition(user_id)
    for datasource in sorted(SENSITIVE_TINYBIRD_DATASOURCES):
        try:
            result = await tinybird_service.delete_by_condition(
                datasource,
                condition,
                wait_for_completion=True,
            )
            datasource_receipts.append({
                "datasource": datasource,
                "status": "deleted" if result.get("success") else "failed",
                "deleted_count": int(result.get("deleted_count") or result.get("rows_deleted") or 0),
                "result": result,
            })
        except Exception as error:
            datasource_receipts.append({
                "datasource": datasource,
                "status": "failed",
                "deleted_count": 0,
                "error": str(error),
            })

    return {
        "target": "tinybird",
        "status": "completed" if all(item["status"] == "deleted" for item in datasource_receipts) else "partial",
        "deleted_count": sum(int(item["deleted_count"]) for item in datasource_receipts),
        "datasources": datasource_receipts,
    }


async def _execute_typesense_erasure(user_id: str, search_service: Any = None) -> Dict[str, Any]:
    if search_service is None:
        try:
            from services.search_service import SearchService

            search_service = SearchService()
        except Exception as error:
            return {
                "target": "typesense",
                "status": "unavailable",
                "deleted_count": 0,
                "error": str(error),
            }

    result = await search_service.delete_user_indexed_documents(
        user_id,
        collections=sorted(SENSITIVE_TYPESENSE_COLLECTIONS),
    )
    return {
        "target": "typesense",
        **result,
    }


async def execute_external_erasure(
    user_id: str,
    *,
    targets: Iterable[str],
    erasure_id: str,
    local_receipt_id: str,
    confirm_external_erasure: bool,
    tinybird_service: Any = None,
    search_service: Any = None,
) -> Dict[str, Any]:
    if not confirm_external_erasure:
        raise ValueError("External erasure requires explicit confirmation.")
    if not erasure_id or not erasure_id.strip():
        raise ValueError("External erasure requires an erasure_id.")
    if not local_receipt_id or not local_receipt_id.strip():
        raise ValueError("External erasure requires a local receipt id.")

    selected = _validate_targets(targets)
    receipts: List[Dict[str, Any]] = []

    for target in selected:
        if target == "private_sync_envelopes":
            result = await delete_private_sync_envelopes(user_id, enforce_device=False)
            receipts.append({
                "target": target,
                "status": "deleted",
                "deleted_count": int(result.get("deleted_count") or 0),
                "result": result,
            })
        elif target == "tinybird":
            receipts.append(await _execute_tinybird_erasure(user_id, tinybird_service))
        elif target == "typesense":
            receipts.append(await _execute_typesense_erasure(user_id, search_service))
        else:
            receipts.append(_manual_receipt(target))

    return {
        "user_id": user_id,
        "mode": "external_erasure_execute",
        "erasure_id": erasure_id.strip(),
        "local_receipt_id": local_receipt_id.strip(),
        "deletes_cloud_data": True,
        "targets": receipts,
        "requested_targets": selected,
        "deleted_count": sum(int(item.get("deleted_count") or 0) for item in receipts),
        "manual_required_count": sum(1 for item in receipts if item.get("status") == "manual_required"),
        "completed_at": _now_iso(),
        "limitations": build_external_erasure_plan(user_id, targets=selected)["limitations"],
    }
