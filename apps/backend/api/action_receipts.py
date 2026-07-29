"""API router for action receipts and undo."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException

from schemas.workflows import ActionReceiptRead, ActionReceiptUndoResponse
from services.action_receipt_service import action_receipt_service


def create_action_receipts_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/action-receipts", tags=["action-receipts"])

    @router.get("/{receipt_id}", response_model=ActionReceiptRead)
    async def get_action_receipt(receipt_id: str, current_user=Depends(get_current_user)):
        receipt = await action_receipt_service.get_receipt(current_user["id"], receipt_id)
        if not receipt:
            raise HTTPException(status_code=404, detail="Action receipt not found")
        return receipt

    @router.post("/{receipt_id}/undo", response_model=ActionReceiptUndoResponse)
    async def undo_action_receipt(receipt_id: str, current_user=Depends(get_current_user)):
        try:
            return await action_receipt_service.undo_receipt(current_user["id"], receipt_id)
        except LookupError:
            raise HTTPException(status_code=404, detail="Action receipt not found") from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
