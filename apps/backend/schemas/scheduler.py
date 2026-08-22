"""Operational scheduler health contracts."""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SchedulerHealthResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_version: int = Field(alias="schemaVersion")
    status: Literal["disabled", "starting", "degraded", "healthy"]
    enabled: bool
    started_at: Optional[str] = Field(default=None, alias="startedAt")
    job_count: int = Field(alias="jobCount")
    readiness: Dict[str, Any]
    never_succeeded: List[str] = Field(alias="neverSucceeded")
    stale_jobs: List[str] = Field(alias="staleJobs")
    active_leases: List[Dict[str, Any]] = Field(alias="activeLeases")
    overlapping_leases: List[Dict[str, Any]] = Field(alias="overlappingLeases")
    duplicate_occurrence_identities: List[Dict[str, Any]] = Field(
        alias="duplicateOccurrenceIdentities"
    )
    jobs: List[Dict[str, Any]]
