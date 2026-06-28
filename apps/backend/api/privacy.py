"""Privacy migration inventory and dry-run API routes."""

from __future__ import annotations

from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from services.privacy_migration_inventory import (
    build_privacy_migration_dry_run,
    build_privacy_migration_plan,
    build_privacy_migration_records_batch,
    build_privacy_deletion_plan,
    execute_privacy_cloud_deletion,
    get_privacy_migration_inventory,
)
from services.privacy_external_erasure import (
    build_external_erasure_plan,
    execute_external_erasure,
)
from services.privacy_policy import (
    can_send_to_cloud,
    request_cloud_consents,
    request_privacy_mode,
)
from services.privacy_private_sync import (
    delete_private_sync_envelopes,
    list_private_sync_devices,
    list_private_sync_envelopes,
    list_private_sync_key_grants,
    put_private_sync_envelopes,
    put_private_sync_key_grants,
    register_private_sync_device,
    revoke_private_sync_device,
)


class MigrationDryRunRequest(BaseModel):
    categories: Optional[List[str]] = None
    sample_limit: int = 5


class MigrationPlanRequest(BaseModel):
    categories: Optional[List[str]] = None


class MigrationRecordsRequest(BaseModel):
    category: str
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=250, ge=1, le=1000)


class DeletionPlanRequest(BaseModel):
    categories: Optional[List[str]] = None


class DeletionExecuteRequest(BaseModel):
    deletion_id: str = Field(min_length=1)
    categories: List[str] = Field(min_length=1)
    local_receipt_id: str = Field(min_length=1)
    confirm_behavioral_cloud_deletion: bool = False


class ExternalErasurePlanRequest(BaseModel):
    targets: Optional[List[str]] = None


class ExternalErasureExecuteRequest(BaseModel):
    erasure_id: str = Field(min_length=1)
    targets: List[str] = Field(min_length=1)
    local_receipt_id: str = Field(min_length=1)
    confirm_external_erasure: bool = False


class PrivateSyncEnvelopeInput(BaseModel):
    envelope_id: str = Field(min_length=1)
    collection: str = Field(min_length=1)
    record_id: str = Field(min_length=1)
    record_type: str = Field(min_length=1)
    revision: int = Field(ge=1)
    key_version: int = Field(default=1, ge=1)
    algorithm: str = Field(min_length=1)
    nonce: str = Field(min_length=1)
    ciphertext: str = Field(min_length=1)
    aad: str = Field(min_length=1)
    ciphertext_sha256: str = Field(min_length=1)
    tombstone: bool = False
    client_updated_at: Optional[str] = None


class PrivateSyncEnvelopePutRequest(BaseModel):
    client_id: Optional[str] = None
    envelopes: List[PrivateSyncEnvelopeInput] = Field(min_length=1, max_length=500)


class PrivateSyncDeviceRegisterRequest(BaseModel):
    device_id: str = Field(min_length=1)
    device_name: str = Field(min_length=1)
    platform: Optional[str] = None
    public_key: Optional[str] = None


class PrivateSyncKeyGrantInput(BaseModel):
    grant_id: str = Field(min_length=1)
    recipient_device_id: str = Field(min_length=1)
    key_version: int = Field(ge=1)
    algorithm: str = Field(min_length=1)
    nonce: str = Field(min_length=1)
    ciphertext: str = Field(min_length=1)
    aad: str = Field(min_length=1)
    ciphertext_sha256: str = Field(min_length=1)


class PrivateSyncKeyGrantPutRequest(BaseModel):
    grants: List[PrivateSyncKeyGrantInput] = Field(min_length=1, max_length=500)


def create_privacy_router(*, get_current_user: Callable[..., object]) -> APIRouter:
    router = APIRouter(prefix="/api/privacy", tags=["privacy"])

    def require_encrypted_sync(http_request: Request) -> None:
        decision = can_send_to_cloud(
            data_class="habit_log",
            destination="turso_encrypted_sync",
            purpose="encrypted_sync",
            mode=request_privacy_mode(http_request.headers),
            consents=request_cloud_consents(http_request.headers),
        )
        if not decision.allowed:
            raise HTTPException(status_code=403, detail=decision.reason)

    def private_sync_device_id(http_request: Request) -> str:
        device_id = http_request.headers.get("x-ritual-private-sync-device-id")
        if not device_id:
            raise HTTPException(status_code=403, detail="Private Sync device registration is required.")
        return device_id

    @router.get("/migration-inventory")
    async def migration_inventory(current_user=Depends(get_current_user)):
        try:
            return await get_privacy_migration_inventory(current_user["id"])
        except Exception:
            raise HTTPException(status_code=500, detail="Migration inventory could not be generated.")

    @router.post("/migration-dry-run")
    async def migration_dry_run(
        request: MigrationDryRunRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await build_privacy_migration_dry_run(
                current_user["id"],
                categories=request.categories,
                sample_limit=request.sample_limit,
            )
        except Exception:
            raise HTTPException(status_code=500, detail="Migration dry-run could not be generated.")

    @router.get("/migration-dry-run")
    async def migration_dry_run_get(
        categories: Optional[str] = Query(None),
        sample_limit: int = Query(5, ge=1, le=25),
        current_user=Depends(get_current_user),
    ):
        try:
            parsed_categories = [
                item.strip()
                for item in (categories or "").split(",")
                if item.strip()
            ] or None
            return await build_privacy_migration_dry_run(
                current_user["id"],
                categories=parsed_categories,
                sample_limit=sample_limit,
            )
        except Exception:
            raise HTTPException(status_code=500, detail="Migration dry-run could not be generated.")

    @router.post("/migration-plan")
    async def migration_plan(
        request: MigrationPlanRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await build_privacy_migration_plan(
                current_user["id"],
                categories=request.categories,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Migration plan could not be generated.")

    @router.post("/migration-records")
    async def migration_records(
        request: MigrationRecordsRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await build_privacy_migration_records_batch(
                current_user["id"],
                category=request.category,
                offset=request.offset,
                limit=request.limit,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Migration records could not be generated.")

    @router.post("/deletion-plan")
    async def deletion_plan(
        request: DeletionPlanRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await build_privacy_deletion_plan(
                current_user["id"],
                categories=request.categories,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Deletion plan could not be generated.")

    @router.post("/deletion-execute")
    async def deletion_execute(
        request: DeletionExecuteRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await execute_privacy_cloud_deletion(
                current_user["id"],
                categories=request.categories,
                deletion_id=request.deletion_id,
                local_receipt_id=request.local_receipt_id,
                confirm_behavioral_cloud_deletion=request.confirm_behavioral_cloud_deletion,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Cloud behavioral deletion could not be completed.")

    @router.post("/external-erasure-plan")
    async def external_erasure_plan(
        request: ExternalErasurePlanRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return build_external_erasure_plan(
                current_user["id"],
                targets=request.targets,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="External erasure plan could not be generated.")

    @router.post("/external-erasure-execute")
    async def external_erasure_execute(
        request: ExternalErasureExecuteRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await execute_external_erasure(
                current_user["id"],
                targets=request.targets,
                erasure_id=request.erasure_id,
                local_receipt_id=request.local_receipt_id,
                confirm_external_erasure=request.confirm_external_erasure,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="External erasure could not be completed.")

    @router.post("/e2ee/envelopes")
    async def put_e2ee_envelopes(
        request: PrivateSyncEnvelopePutRequest,
        http_request: Request,
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        device_id = private_sync_device_id(http_request)
        try:
            envelopes = [item.model_dump() for item in request.envelopes]
            return await put_private_sync_envelopes(
                current_user["id"],
                envelopes,
                device_id=device_id,
                client_id=request.client_id,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync envelopes could not be stored.")

    @router.get("/e2ee/envelopes")
    async def get_e2ee_envelopes(
        http_request: Request,
        since_server_revision: int = Query(0, ge=0),
        limit: int = Query(500, ge=1, le=500),
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        device_id = private_sync_device_id(http_request)
        try:
            return await list_private_sync_envelopes(
                current_user["id"],
                device_id=device_id,
                since_server_revision=since_server_revision,
                limit=limit,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync envelopes could not be listed.")

    @router.delete("/e2ee/envelopes")
    async def delete_e2ee_envelopes(
        http_request: Request,
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        try:
            return await delete_private_sync_envelopes(current_user["id"])
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync envelopes could not be deleted.")

    @router.post("/e2ee/devices")
    async def register_e2ee_device(
        request: PrivateSyncDeviceRegisterRequest,
        http_request: Request,
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        try:
            return await register_private_sync_device(
                current_user["id"],
                device_id=request.device_id,
                device_name=request.device_name,
                platform=request.platform,
                public_key=request.public_key,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync device could not be registered.")

    @router.get("/e2ee/devices")
    async def list_e2ee_devices(
        http_request: Request,
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        try:
            return await list_private_sync_devices(current_user["id"])
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync devices could not be listed.")

    @router.post("/e2ee/devices/{device_id}/revoke")
    async def revoke_e2ee_device(
        device_id: str,
        http_request: Request,
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        requester_device_id = private_sync_device_id(http_request)
        try:
            return await revoke_private_sync_device(
                current_user["id"],
                requester_device_id=requester_device_id,
                device_id=device_id,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync device could not be revoked.")

    @router.post("/e2ee/key-grants")
    async def put_e2ee_key_grants(
        request: PrivateSyncKeyGrantPutRequest,
        http_request: Request,
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        sender_device_id = private_sync_device_id(http_request)
        try:
            return await put_private_sync_key_grants(
                current_user["id"],
                [grant.model_dump() for grant in request.grants],
                sender_device_id=sender_device_id,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync key grants could not be stored.")

    @router.get("/e2ee/key-grants")
    async def list_e2ee_key_grants(
        http_request: Request,
        current_user=Depends(get_current_user),
    ):
        require_encrypted_sync(http_request)
        device_id = private_sync_device_id(http_request)
        try:
            return await list_private_sync_key_grants(
                current_user["id"],
                device_id=device_id,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error))
        except Exception:
            raise HTTPException(status_code=500, detail="Private sync key grants could not be listed.")

    return router
