"""Turbopuffer integration for cloud memory retrieval/upserts."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)
_LEGACY_INT_QUALITY_SCORE_NAMESPACES: set[str] = set()


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _sanitize_namespace_fragment(value: str, fallback: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return fallback
    sanitized = "".join(ch if (ch.isalnum() or ch in {"-", "_", "."}) else "_" for ch in raw)
    sanitized = sanitized.strip("._-")
    return sanitized or fallback


class TurbopufferService:
    def __init__(self) -> None:
        self.api_key = _env("TURBOPUFFER_API_KEY")
        self.base_url = _env("TURBOPUFFER_BASE_URL", "https://api.turbopuffer.com").rstrip("/")
        self.namespace_prefix = _env("TURBOPUFFER_NAMESPACE_PREFIX", "ritual-prod")
        self.timeout_seconds = float(_env("TURBOPUFFER_TIMEOUT_SECONDS", "8") or "8")
        self.distance_metric = _env("TURBOPUFFER_DISTANCE_METRIC", "cosine_distance") or "cosine_distance"

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def namespace_for_user(self, user_id: str) -> str:
        safe_prefix = _sanitize_namespace_fragment(self.namespace_prefix, "ritual-prod")
        safe_user = _sanitize_namespace_fragment(user_id or "unknown", "unknown")
        # Turbopuffer namespace must be URL-safe [A-Za-z0-9-_.], so avoid ":".
        return f"{safe_prefix}_{safe_user}"

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def health_check(self) -> Dict[str, Any]:
        if not self.configured:
            return {"status": "unconfigured", "provider": "turbopuffer"}

        test_ns = self.namespace_for_user("healthcheck")
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                resp = await client.post(
                    f"{self.base_url}/v2/namespaces/{test_ns}/query",
                    headers=self._headers(),
                    json={
                        "queries": [
                            {
                                "top_k": 1,
                                "rank_by": ["contextual_text_compact", "BM25", "healthcheck"],
                            }
                        ]
                    },
                )
            if resp.status_code == 404:
                # Namespace may not exist yet; connectivity/auth are still healthy.
                return {"status": "ok", "provider": "turbopuffer"}
            if resp.status_code >= 400:
                return {
                    "status": "error",
                    "provider": "turbopuffer",
                    "error": f"http_{resp.status_code}",
                }
            return {"status": "ok", "provider": "turbopuffer"}
        except Exception as exc:
            return {"status": "error", "provider": "turbopuffer", "error": str(exc)}

    async def upsert_chunk(
        self,
        user_id: str,
        doc_id: str,
        vector: List[float],
        attributes: Dict[str, Any],
    ) -> None:
        if not self.configured:
            raise RuntimeError("Turbopuffer API key is not configured")

        namespace = self.namespace_for_user(user_id)
        include_quality_score = namespace not in _LEGACY_INT_QUALITY_SCORE_NAMESPACES

        def _build_payload(include_qs: bool) -> Dict[str, Any]:
            schema = {
                "contextual_text_compact": {
                    "type": "string",
                    "full_text_search": True,
                },
                "raw_text_compact": {"type": "string"},
                "chunk_start_ts": {"type": "int"},
                "chunk_end_ts": {"type": "int"},
                "active": {"type": "int"},
                "user_id": {"type": "string"},
                "device_id": {"type": "string"},
                "chunk_id": {"type": "string"},
                "logical_chunk_id": {"type": "string"},
                "app_name": {"type": "string"},
                "window_title": {"type": "string"},
                "browser_domain": {"type": "string"},
                "content_hash": {"type": "string"},
                "session_key": {"type": "string"},
                "session_position": {"type": "int"},
                "session_chunk_count": {"type": "int"},
                "context_version": {"type": "int"},
            }
            row_attrs = dict(attributes)
            if include_qs:
                schema["quality_score"] = {"type": "float"}
            else:
                row_attrs.pop("quality_score", None)
            return {
                "distance_metric": self.distance_metric,
                "schema": schema,
                "upsert_rows": [
                    {"id": doc_id, "vector": vector, **row_attrs}
                ],
            }

        def _is_quality_score_type_conflict(body: str) -> bool:
            text = (body or "").lower()
            return (
                "quality_score" in text
                and "as int" in text
                and "incompatible value" in text
            )

        payload = _build_payload(include_quality_score)
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}/v2/namespaces/{namespace}",
                headers=self._headers(),
                json=payload,
            )
            if (
                response.status_code == 400
                and include_quality_score
                and _is_quality_score_type_conflict(response.text)
            ):
                _LEGACY_INT_QUALITY_SCORE_NAMESPACES.add(namespace)
                logger.warning(
                    "Turbopuffer namespace %s uses legacy int quality_score; retrying upserts without quality_score attribute.",
                    namespace,
                )
                response = await client.post(
                    f"{self.base_url}/v2/namespaces/{namespace}",
                    headers=self._headers(),
                    json=_build_payload(include_qs=False),
                )
        if response.status_code >= 400:
            raise RuntimeError(
                f"Turbopuffer upsert failed: status={response.status_code} body={response.text[:240]}"
            )

    async def delete_docs(self, user_id: str, doc_ids: List[str]) -> None:
        if not self.configured or not doc_ids:
            return
        namespace = self.namespace_for_user(user_id)
        payload = {"deletes": doc_ids}
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}/v2/namespaces/{namespace}",
                headers=self._headers(),
                json=payload,
            )
        if response.status_code >= 400:
            logger.warning(
                "Turbopuffer delete failed for %s docs: %s %s",
                len(doc_ids),
                response.status_code,
                response.text[:200],
            )

    async def hybrid_candidates(
        self,
        user_id: str,
        query_text: str,
        query_vector: Optional[List[float]],
        start_ms: int,
        end_ms: int,
        top_k: int = 120,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve first-stage candidates from Turbopuffer.
        Attempts `rank_by` hybrid first, then falls back to separate vector/text queries.
        """
        if not self.configured:
            raise RuntimeError("Turbopuffer API key is not configured")

        namespace = self.namespace_for_user(user_id)
        filters = [
            "And",
            [
                # Overlap semantics: include any chunk intersecting [start_ms, end_ms].
                ["chunk_end_ts", "Gte", int(start_ms)],
                ["chunk_start_ts", "Lte", int(end_ms)],
            ],
        ]
        include = [
            "chunk_id",
            "logical_chunk_id",
            "chunk_start_ts",
            "chunk_end_ts",
            "app_name",
            "window_title",
            "browser_domain",
            "text_compact",
            "raw_text_compact",
            "contextual_text_compact",
            "quality_score",
            "content_hash",
            "active",
            "session_key",
            "session_position",
            "session_chunk_count",
            "context_version",
        ]

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            if query_vector and len(query_vector) > 0:
                # Attempt 1: single hybrid query using rank_by.
                payload_rank_by = {
                    "queries": [
                        {
                            "top_k": int(top_k),
                                "include_attributes": include,
                                "filters": filters,
                                "rank_by": [
                                    ["vector", "ANN", query_vector],
                                    ["contextual_text_compact", "BM25", query_text],
                                ],
                            }
                        ]
                }
                resp = await client.post(
                    f"{self.base_url}/v2/namespaces/{namespace}/query",
                    headers=self._headers(),
                    json=payload_rank_by,
                )
                if resp.status_code < 400:
                    parsed = self._parse_query_results(resp.json())
                    if parsed:
                        return parsed

                # Attempt 2: explicit vector+text multi-query via rank_by (v2 API).
                payload_multi = {
                    "queries": [
                        {
                            "top_k": int(top_k),
                            "include_attributes": include,
                            "filters": filters,
                            "rank_by": ["vector", "ANN", query_vector],
                        },
                        {
                            "top_k": int(top_k),
                            "include_attributes": include,
                            "filters": filters,
                            "rank_by": ["contextual_text_compact", "BM25", query_text],
                        },
                    ]
                }
            else:
                # Lexical-only fallback path when query embedding is unavailable.
                payload_multi = {
                    "queries": [
                        {
                            "top_k": int(top_k),
                            "include_attributes": include,
                            "filters": filters,
                            "rank_by": ["text_compact", "BM25", query_text],
                        }
                    ]
                }

            resp2 = await client.post(
                f"{self.base_url}/v2/namespaces/{namespace}/query",
                headers=self._headers(),
                json=payload_multi,
            )
            if resp2.status_code >= 400:
                raise RuntimeError(
                    f"Turbopuffer query failed: status={resp2.status_code} body={resp2.text[:240]}"
                )
            return self._parse_query_results(resp2.json())

    def _parse_query_results(self, payload: Any) -> List[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        results = payload.get("results")
        if not isinstance(results, list):
            # Backward-compatible fallback if server uses `queries`.
            results = payload.get("queries")
        if not isinstance(results, list):
            return []

        merged: List[Dict[str, Any]] = []
        for query_result in results:
            rows = []
            if isinstance(query_result, dict):
                rows = query_result.get("rows") or query_result.get("results") or []
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                attrs: Dict[str, Any]
                if isinstance(row.get("attributes"), dict):
                    attrs = dict(row.get("attributes") or {})
                else:
                    attrs = {
                        key: value
                        for key, value in row.items()
                        if key not in {"id", "score", "similarity", "distance", "dist", "$dist"}
                    }
                score = row.get("score")
                if score is None:
                    score = row.get("similarity")
                distance = None
                if score is None:
                    distance = row.get("distance")
                    if distance is None:
                        distance = row.get("dist")
                    if distance is None:
                        distance = row.get("$dist")
                if score is None and distance is not None:
                    try:
                        distance_value = max(0.0, float(distance))
                        score = 1.0 / (1.0 + distance_value)
                    except Exception:
                        score = 0.0
                if score is None:
                    score = 0.0
                merged.append(
                    {
                        "doc_id": str(row.get("id") or ""),
                        "score": float(score or 0.0),
                        "chunk_id": attrs.get("chunk_id"),
                        "logical_chunk_id": attrs.get("logical_chunk_id"),
                        "chunk_start_ts": attrs.get("chunk_start_ts"),
                        "chunk_end_ts": attrs.get("chunk_end_ts"),
                        "app_name": attrs.get("app_name"),
                        "window_title": attrs.get("window_title"),
                        "browser_domain": attrs.get("browser_domain"),
                        "text_compact": attrs.get("text_compact"),
                        "raw_text_compact": attrs.get("raw_text_compact"),
                        "contextual_text_compact": attrs.get("contextual_text_compact"),
                        "quality_score": float(attrs.get("quality_score") or 0.0),
                        "content_hash": attrs.get("content_hash"),
                        "active": attrs.get("active"),
                        "session_key": attrs.get("session_key"),
                        "session_position": attrs.get("session_position"),
                        "session_chunk_count": attrs.get("session_chunk_count"),
                        "context_version": attrs.get("context_version"),
                    }
                )

        # Deduplicate by doc_id keeping best score.
        deduped: Dict[str, Dict[str, Any]] = {}
        for item in merged:
            doc_id = item.get("doc_id") or ""
            if not doc_id:
                continue
            existing = deduped.get(doc_id)
            if existing is None or float(item.get("score") or 0.0) > float(existing.get("score") or 0.0):
                deduped[doc_id] = item
        items = list(deduped.values())
        items.sort(key=lambda row: float(row.get("score") or 0.0), reverse=True)
        return items
