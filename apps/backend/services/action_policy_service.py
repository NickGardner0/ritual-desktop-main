"""
Backend-owned action policy enforcement for workflow and ambient actions.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

from database.models import ActionProfileDB, ActionReceiptDB, ApprovalRequestDB


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class PolicyEvaluationResult:
    outcome: str
    reason: Optional[str]
    capability: str
    action_kind: str
    approval_request_id: Optional[str] = None
    receipt_id: Optional[str] = None


DEFAULT_RULES_BY_MODE: Dict[str, Dict[str, Any]] = {
    "observe": {
        "read_scopes": ["artifacts", "facts", "activity", "calendar", "habits", "reports"],
        "write_scopes": [],
        "delivery_scopes": [],
        "approval_policy": {"default": "reject"},
        "budgets": {"max_actions": 0, "max_writes": 0, "max_external_actions": 0},
        "risk_limits": {"max_risk_level": "low"},
    },
    "draft": {
        "read_scopes": ["artifacts", "facts", "activity", "calendar", "habits", "reports"],
        "write_scopes": ["artifacts", "artifact_links", "workflow_definitions", "queue_items", "fact_suggestions"],
        "delivery_scopes": [],
        "approval_policy": {"default": "approval"},
        "budgets": {"max_actions": 8, "max_writes": 6, "max_external_actions": 0},
        "risk_limits": {"max_risk_level": "medium"},
    },
    "organize": {
        "read_scopes": ["artifacts", "facts", "activity", "calendar", "habits", "reports"],
        "write_scopes": ["artifacts", "artifact_links", "workflow_definitions", "queue_items", "facts", "tasks"],
        "delivery_scopes": [],
        "approval_policy": {"default": "approval", "calendar_events": "approval"},
        "budgets": {"max_actions": 12, "max_writes": 8, "max_external_actions": 0},
        "risk_limits": {"max_risk_level": "medium"},
    },
    "act": {
        "read_scopes": ["artifacts", "facts", "activity", "calendar", "habits", "reports"],
        "write_scopes": ["artifacts", "artifact_links", "workflow_definitions", "queue_items", "facts", "tasks"],
        "delivery_scopes": ["in_app"],
        "approval_policy": {"default": "approval", "delivery": "approval", "calendar_events": "approval"},
        "budgets": {"max_actions": 16, "max_writes": 10, "max_external_actions": 0},
        "risk_limits": {"max_risk_level": "medium"},
    },
}


class ActionPolicyService:
    def parse_rules(self, profile: ActionProfileDB) -> Dict[str, Any]:
        try:
            stored = json.loads(profile.rules_json or "{}")
        except Exception:
            stored = {}
        defaults = DEFAULT_RULES_BY_MODE.get(profile.mode, DEFAULT_RULES_BY_MODE["draft"])
        merged = {
            "read_scopes": list(stored.get("read_scopes") or defaults["read_scopes"]),
            "write_scopes": list(stored.get("write_scopes") or defaults["write_scopes"]),
            "delivery_scopes": list(stored.get("delivery_scopes") or defaults["delivery_scopes"]),
            "approval_policy": dict(defaults["approval_policy"]),
            "budgets": dict(defaults["budgets"]),
            "risk_limits": dict(defaults["risk_limits"]),
        }
        merged["approval_policy"].update(stored.get("approval_policy") or {})
        merged["budgets"].update(stored.get("budgets") or {})
        merged["risk_limits"].update(stored.get("risk_limits") or {})
        return merged

    def seed_rules_for_mode(self, mode: str) -> Dict[str, Any]:
        return dict(DEFAULT_RULES_BY_MODE.get(mode, DEFAULT_RULES_BY_MODE["draft"]))

    def _scope_for_action(self, action: Dict[str, Any]) -> str:
        capability = str(action.get("capability") or "").strip()
        if capability:
            return capability
        action_kind = str(action.get("action_kind") or "").strip()
        return action_kind or "unknown"

    async def evaluate_actions(
        self,
        session,
        *,
        profile: ActionProfileDB,
        user_id: str,
        workflow_run_id: Optional[str],
        conversation_id: Optional[str],
        proposed_actions: Iterable[Dict[str, Any]],
    ) -> List[PolicyEvaluationResult]:
        rules = self.parse_rules(profile)
        budgets = rules.get("budgets") or {}
        approval_policy = rules.get("approval_policy") or {}
        write_scopes = set(rules.get("write_scopes") or [])
        delivery_scopes = set(rules.get("delivery_scopes") or [])
        results: List[PolicyEvaluationResult] = []

        for index, action in enumerate(proposed_actions):
            action_kind = str(action.get("action_kind") or "unknown")
            capability = self._scope_for_action(action)
            payload = action.get("payload") or {}
            if index >= int(budgets.get("max_actions") or 0):
                outcome = "rejected"
                reason = "Action budget exceeded."
            elif capability in write_scopes:
                outcome = "applied"
                reason = None
            elif capability in delivery_scopes:
                outcome = "requires_approval"
                reason = "Delivery actions require explicit approval."
            elif approval_policy.get(capability) == "approval" or approval_policy.get("default") == "approval":
                outcome = "requires_approval"
                reason = "This action requires approval under the current execution profile."
            else:
                outcome = "rejected"
                reason = "Capability is not allowed by the current execution profile."

            receipt = ActionReceiptDB(
                id=str(uuid4()),
                user_id=user_id,
                workflow_run_id=workflow_run_id,
                conversation_id=conversation_id,
                action_kind=action_kind,
                capability=capability,
                target_ref=str(action.get("target_ref") or ""),
                status="approved_pending" if outcome == "requires_approval" else outcome,
                before_json=None,
                after_json=json.dumps(payload) if outcome == "applied" else None,
                undo_json=None,
                metadata_json=json.dumps({"reason": reason, "source": "policy_engine"}),
                created_at=_utc_now(),
            )
            session.add(receipt)
            await session.flush()

            approval_request_id = None
            if outcome == "requires_approval":
                approval = ApprovalRequestDB(
                    id=str(uuid4()),
                    user_id=user_id,
                    workflow_run_id=workflow_run_id,
                    action_kind=action_kind,
                    capability=capability,
                    status="pending",
                    reason=reason,
                    payload_json=json.dumps(payload),
                    proposed_action_json=json.dumps(action),
                    policy_decision_json=json.dumps({"outcome": outcome, "reason": reason}),
                    expires_at=_utc_now() + timedelta(days=7),
                    created_at=_utc_now(),
                    updated_at=_utc_now(),
                )
                session.add(approval)
                await session.flush()
                approval_request_id = approval.id

            results.append(
                PolicyEvaluationResult(
                    outcome=outcome,
                    reason=reason,
                    capability=capability,
                    action_kind=action_kind,
                    approval_request_id=approval_request_id,
                    receipt_id=receipt.id,
                )
            )
        return results


action_policy_service = ActionPolicyService()
