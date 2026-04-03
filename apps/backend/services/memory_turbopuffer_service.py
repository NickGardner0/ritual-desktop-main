"""Turbopuffer integration for cloud memory retrieval/upserts."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)
_LEGACY_INT_QUALITY_SCORE_NAMESPACES: set[str] = set()
_LEGACY_LEXICAL_RANK_NAMESPACES: set[str] = set()


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
                "fts_app_name": {
                    "type": "string",
                    "full_text_search": True,
                },
                "fts_window_title": {
                    "type": "string",
                    "full_text_search": True,
                },
                "fts_document_title": {
                    "type": "string",
                    "full_text_search": True,
                },
                "fts_browser_domain": {
                    "type": "string",
                    "full_text_search": True,
                },
                "fts_parent_context": {
                    "type": "string",
                    "full_text_search": True,
                },
                "fts_document_path": {
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
                "source_kind": {"type": "string"},
                "session_id": {"type": "string"},
                "app_name": {"type": "string"},
                "window_title": {"type": "string"},
                "document_title": {"type": "string"},
                "document_path": {
                    "type": "string",
                    "full_text_search": True,
                },
                "browser_domain": {"type": "string"},
                "ax_richness_score": {"type": "float"},
                "content_hash": {"type": "string"},
                "session_key": {"type": "string"},
                "session_position": {"type": "int"},
                "session_chunk_count": {"type": "int"},
                "session_count": {"type": "int"},
                "context_version": {"type": "int"},
                "capture_quality": {"type": "float"},
                "raw_visible_text": {"type": "string"},
                "contextual_retrieval_text": {"type": "string"},
                "parent_context": {"type": "string"},
            }
            row_attrs = dict(attributes)
            row_attrs.setdefault("fts_app_name", str(attributes.get("app_name") or ""))
            row_attrs.setdefault("fts_window_title", str(attributes.get("window_title") or ""))
            row_attrs.setdefault("fts_document_title", str(attributes.get("document_title") or ""))
            row_attrs.setdefault("fts_document_path", str(attributes.get("document_path") or ""))
            row_attrs.setdefault("fts_browser_domain", str(attributes.get("browser_domain") or ""))
            row_attrs.setdefault("fts_parent_context", str(attributes.get("parent_context") or ""))
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

    def _legacy_lexical_rank(self, query_text: str) -> List[Any]:
        return ["contextual_text_compact", "BM25", query_text]

    def _weighted_lexical_rank(self, query_text: str) -> List[Any]:
        return [
            "Sum",
            [
                ["Product", 2.2, ["contextual_text_compact", "BM25", query_text]],
                ["Product", 1.8, ["fts_document_title", "BM25", query_text]],
                ["Product", 1.6, ["fts_document_path", "BM25", query_text]],
                ["Product", 1.4, ["fts_window_title", "BM25", query_text]],
                ["Product", 1.0, ["fts_parent_context", "BM25", query_text]],
                ["Product", 0.8, ["fts_browser_domain", "BM25", query_text]],
                ["Product", 0.4, ["fts_app_name", "BM25", query_text]],
            ],
        ]

    def _supports_weighted_lexical_rank(self, namespace: str) -> bool:
        return namespace not in _LEGACY_LEXICAL_RANK_NAMESPACES

    def _is_weighted_lexical_schema_miss(self, body: str) -> bool:
        text = (body or "").lower()
        return (
            "does not exist in namespace" in text
            and ("fts_document_title" in text or "fts_window_title" in text or "fts_document_path" in text or "fts_parent_context" in text or "fts_browser_domain" in text or "fts_app_name" in text)
        )

    def _build_multi_query_payload(
        self,
        *,
        top_k: int,
        include: List[str],
        filters: List[Any],
        retrieval_queries: List[Dict[str, Any]],
        weighted_lexical: bool,
    ) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
        payload_multi: Dict[str, Any] = {
            "consistency": {"level": "strong"},
            "queries": [],
        }
        list_meta: List[Dict[str, Any]] = []

        for retrieval_query in retrieval_queries:
            query_type = str(retrieval_query.get("type") or "original").strip().lower()
            query_text = str(retrieval_query.get("text") or "").strip()
            query_weight = float(retrieval_query.get("weight") or 1.0)
            query_vector = retrieval_query.get("vector")
            vector_rank_mode = str(retrieval_query.get("vector_rank_mode") or "ANN").strip()
            rank_by: Optional[List[Any]] = None
            source = "fts"
            rank_strategy = "bm25_weighted" if weighted_lexical else "bm25_legacy"

            if query_type in {"vec", "hyde"} and isinstance(query_vector, list) and query_vector:
                source = "vec"
                rank_strategy = f"vector_{vector_rank_mode.lower()}"
                rank_by = ["vector", vector_rank_mode, query_vector]
            elif query_type == "original":
                payload_multi["queries"].append(
                    {
                        "top_k": int(top_k),
                        "include_attributes": include,
                        "filters": filters,
                        "rank_by": (
                            self._weighted_lexical_rank(query_text)
                            if weighted_lexical
                            else self._legacy_lexical_rank(query_text)
                        ),
                    }
                )
                list_meta.append(
                    {
                        "source": "fts",
                        "query_type": query_type,
                        "query_text": query_text,
                        "weight": query_weight,
                        "rank_strategy": rank_strategy,
                    }
                )
                if isinstance(query_vector, list) and query_vector:
                    payload_multi["queries"].append(
                        {
                            "top_k": int(top_k),
                            "include_attributes": include,
                            "filters": filters,
                            "rank_by": ["vector", vector_rank_mode, query_vector],
                        }
                    )
                    list_meta.append(
                        {
                            "source": "vec",
                            "query_type": query_type,
                            "query_text": query_text,
                            "weight": query_weight,
                            "rank_strategy": f"vector_{vector_rank_mode.lower()}",
                        }
                    )
                continue
            else:
                rank_by = (
                    self._weighted_lexical_rank(query_text)
                    if weighted_lexical
                    else self._legacy_lexical_rank(query_text)
                )
            if rank_by is None:
                continue
            payload_multi["queries"].append(
                {
                    "top_k": int(top_k),
                    "include_attributes": include,
                    "filters": filters,
                    "rank_by": rank_by,
                }
            )
            list_meta.append(
                {
                    "source": source,
                    "query_type": query_type,
                    "query_text": query_text,
                    "weight": query_weight,
                    "rank_strategy": rank_strategy,
                }
            )
        return payload_multi, list_meta

    async def hybrid_candidates(
        self,
        user_id: str,
        queries: List[Dict[str, Any]],
        start_ms: int,
        end_ms: int,
        top_k: int = 120,
    ) -> Dict[str, Any]:
        """Retrieve first-stage ranked lists from Turbopuffer."""
        if not self.configured:
            raise RuntimeError("Turbopuffer API key is not configured")

        namespace = self.namespace_for_user(user_id)
        retrieval_queries = [query for query in queries if isinstance(query, dict) and str(query.get("text") or "").strip()]
        if not retrieval_queries:
            return {"lists": [], "candidate_count_raw": 0}
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
            "source_kind",
            "session_id",
            "app_name",
            "window_title",
            "document_title",
            "document_path",
            "browser_domain",
            "text_compact",
            "raw_text_compact",
            "contextual_text_compact",
            "raw_visible_text",
            "contextual_retrieval_text",
            "parent_context",
            "quality_score",
            "capture_quality",
            "content_hash",
            "active",
            "session_key",
            "session_position",
            "session_chunk_count",
            "session_count",
            "context_version",
        ]
        weighted_lexical = self._supports_weighted_lexical_rank(namespace)
        payload_multi, list_meta = self._build_multi_query_payload(
            top_k=top_k,
            include=include,
            filters=filters,
            retrieval_queries=retrieval_queries,
            weighted_lexical=weighted_lexical,
        )

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            resp2 = await client.post(
                f"{self.base_url}/v2/namespaces/{namespace}/query",
                headers=self._headers(),
                json=payload_multi,
            )
            if resp2.status_code >= 400:
                if weighted_lexical and self._is_weighted_lexical_schema_miss(resp2.text):
                    _LEGACY_LEXICAL_RANK_NAMESPACES.add(namespace)
                    logger.warning(
                        "Turbopuffer namespace %s is missing weighted lexical FTS attrs; caching legacy lexical rank fallback for this process.",
                        namespace,
                    )
                elif weighted_lexical:
                    logger.warning(
                        "Weighted Turbopuffer lexical query failed for namespace %s, retrying with legacy lexical rank: %s",
                        namespace,
                        resp2.text[:240],
                    )
                payload_multi, list_meta = self._build_multi_query_payload(
                    top_k=top_k,
                    include=include,
                    filters=filters,
                    retrieval_queries=retrieval_queries,
                    weighted_lexical=False,
                )
                resp2 = await client.post(
                    f"{self.base_url}/v2/namespaces/{namespace}/query",
                    headers=self._headers(),
                    json=payload_multi,
                )
            if resp2.status_code >= 400:
                raise RuntimeError(
                    f"Turbopuffer query failed: status={resp2.status_code} body={resp2.text[:240]}"
                )
            return self._parse_query_results(resp2.json(), list_meta=list_meta)

    def _parse_query_results(self, payload: Any, *, list_meta: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {"lists": [], "candidate_count_raw": 0}
        results = payload.get("results")
        if not isinstance(results, list):
            # Backward-compatible fallback if server uses `queries`.
            results = payload.get("queries")
        if not isinstance(results, list):
            return {"lists": [], "candidate_count_raw": 0}

        ranked_lists: List[Dict[str, Any]] = []
        raw_count = 0
        for list_index, query_result in enumerate(results):
            rows = []
            if isinstance(query_result, dict):
                rows = query_result.get("rows") or query_result.get("results") or []
            if not isinstance(rows, list):
                continue
            meta = list_meta[list_index] if list_index < len(list_meta) else {}
            parsed_rows: List[Dict[str, Any]] = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw_count += 1
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
                parsed_rows.append(
                    {
                        "doc_id": str(row.get("id") or ""),
                        "score": float(score or 0.0),
                        "source": meta.get("source") or "fts",
                        "query_type": meta.get("query_type") or "original",
                        "query_text": meta.get("query_text") or "",
                        "query_weight": float(meta.get("weight") or 1.0),
                        "rank_strategy": meta.get("rank_strategy") or "",
                        "chunk_id": attrs.get("chunk_id"),
                        "logical_chunk_id": attrs.get("logical_chunk_id"),
                        "chunk_start_ts": attrs.get("chunk_start_ts"),
                        "chunk_end_ts": attrs.get("chunk_end_ts"),
                        "source_kind": attrs.get("source_kind"),
                        "session_id": attrs.get("session_id"),
                        "app_name": attrs.get("app_name"),
                        "window_title": attrs.get("window_title"),
                        "document_title": attrs.get("document_title"),
                        "document_path": attrs.get("document_path"),
                        "browser_domain": attrs.get("browser_domain"),
                        "text_compact": attrs.get("text_compact"),
                        "raw_text_compact": attrs.get("raw_text_compact"),
                        "contextual_text_compact": attrs.get("contextual_text_compact"),
                        "raw_visible_text": attrs.get("raw_visible_text"),
                        "contextual_retrieval_text": attrs.get("contextual_retrieval_text"),
                        "parent_context": attrs.get("parent_context"),
                        "quality_score": float(attrs.get("quality_score") or 0.0),
                        "capture_quality": float(attrs.get("capture_quality") or 0.0),
                        "content_hash": attrs.get("content_hash"),
                        "active": attrs.get("active"),
                        "session_key": attrs.get("session_key"),
                        "session_position": attrs.get("session_position"),
                        "session_chunk_count": attrs.get("session_chunk_count"),
                        "session_count": attrs.get("session_count"),
                        "context_version": attrs.get("context_version"),
                    }
                )
            deduped: Dict[str, Dict[str, Any]] = {}
            for item in parsed_rows:
                doc_id = item.get("doc_id") or ""
                if not doc_id:
                    continue
                existing = deduped.get(doc_id)
                if existing is None or float(item.get("score") or 0.0) > float(existing.get("score") or 0.0):
                    deduped[doc_id] = item
            items = list(deduped.values())
            items.sort(key=lambda row: float(row.get("score") or 0.0), reverse=True)
            ranked_lists.append(
                {
                    "source": meta.get("source") or "fts",
                    "query_type": meta.get("query_type") or "original",
                    "query_text": meta.get("query_text") or "",
                    "weight": float(meta.get("weight") or 1.0),
                    "items": items,
                }
            )
        return {"lists": ranked_lists, "candidate_count_raw": raw_count}
