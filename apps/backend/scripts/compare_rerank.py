"""
Compare search results WITH vs WITHOUT Cohere reranking.

Runs the same query through search_context_memory_impl twice:
  1. With Cohere reranking enabled (normal path)
  2. With reranking disabled (first-stage ranking only)

Prints a side-by-side comparison of citation ordering.

Usage:
    cd apps/backend
    python scripts/compare_rerank.py [--query "What did I do yesterday"]
"""

import argparse
import asyncio
import os
import sys
import time

from dotenv import load_dotenv

load_dotenv()

# Ensure backend modules are importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import AsyncMock, patch

from services.watcher_service_search import search_context_memory_impl


class _DummyWatcherService:
    def __init__(self):
        self.db_path = None


def _truncate(text: str, max_len: int = 60) -> str:
    text = text.replace("\n", " ").strip()
    return text[:max_len] + "..." if len(text) > max_len else text


async def run_search(query: str, *, disable_rerank: bool = False):
    """Run search_context_memory_impl, optionally disabling reranking."""
    if disable_rerank:
        async def _noop_rerank(*, query, rerank_intent="", candidates, top_n=50):
            return {
                "provider": "none",
                "items": [],
                "rerank_attempted": False,
                "rerank_latency_ms": 0,
                "cache_hits": 0,
                "cache_misses": 0,
                "deduped_candidates": len(candidates),
            }

        with patch(
            "services.memory_rerank_service.rerank_candidates",
            _noop_rerank,
        ):
            start = time.time()
            result = await search_context_memory_impl(
                service=_DummyWatcherService(),
                user_id="local",
                query=query,
                days_back=7,
                limit=15,
                allow_legacy_fallback=False,
            )
            elapsed = time.time() - start
    else:
        start = time.time()
        result = await search_context_memory_impl(
            service=_DummyWatcherService(),
            user_id="local",
            query=query,
            days_back=7,
            limit=15,
            allow_legacy_fallback=False,
        )
        elapsed = time.time() - start

    return result, elapsed


def print_citations(label: str, result: dict, elapsed: float):
    citations = result.get("citations") or []
    debug = result.get("debug") or {}
    rerank = debug.get("rerank") or {}

    print(f"\n{'=' * 80}")
    print(f"  {label}")
    print(f"  Query: {result.get('query')}")
    print(f"  Mode: {result.get('mode_used')}  |  Status: {result.get('status')}")
    print(f"  Results: {result.get('result_count')}  |  Citations: {len(citations)}")
    print(f"  Rerank provider: {rerank.get('provider', 'N/A')}  |  Latency: {rerank.get('rerank_latency_ms', 'N/A')}ms")
    print(f"  Total elapsed: {elapsed:.2f}s")
    print(f"{'=' * 80}")
    print(f"  {'#':<4} {'Score':<8} {'App':<18} {'Snippet'}")
    print(f"  {'─' * 4} {'─' * 8} {'─' * 18} {'─' * 46}")

    for i, c in enumerate(citations[:15]):
        score = c.get("relevance_score") or c.get("score") or 0.0
        app = _truncate(str(c.get("app_name") or "?"), 16)
        snippet = _truncate(str(c.get("snippet") or c.get("text_compact") or ""), 45)
        print(f"  {i + 1:<4} {score:<8.4f} {app:<18} {snippet}")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", default="What did I do yesterday?")
    args = parser.parse_args()
    query = args.query

    print(f"\nRunning comparison for: \"{query}\"")
    print(f"Cohere key set: {bool(os.getenv('COHERE_API_KEY'))}")
    print(f"OpenAI key set: {bool(os.getenv('OPENAI_API_KEY'))}")

    # Run WITHOUT reranking first (faster)
    print("\n[1/2] Running WITHOUT reranking...")
    result_no_rerank, elapsed_no = await run_search(query, disable_rerank=True)

    # Run WITH reranking
    print("[2/2] Running WITH reranking...")
    result_reranked, elapsed_yes = await run_search(query, disable_rerank=False)

    # Print results
    print_citations("WITHOUT RERANKING (first-stage only)", result_no_rerank, elapsed_no)
    print_citations("WITH RERANKING (Cohere)", result_reranked, elapsed_yes)

    # Compare ordering
    no_rerank_cites = result_no_rerank.get("citations") or []
    reranked_cites = result_reranked.get("citations") or []

    if no_rerank_cites and reranked_cites:
        no_rerank_order = [
            _truncate(str(c.get("snippet") or c.get("text_compact") or ""), 30)
            for c in no_rerank_cites[:10]
        ]
        reranked_order = [
            _truncate(str(c.get("snippet") or c.get("text_compact") or ""), 30)
            for c in reranked_cites[:10]
        ]

        if no_rerank_order == reranked_order:
            print("\n>> Ordering is IDENTICAL — reranking did not change the result order.")
        else:
            changed = sum(1 for a, b in zip(no_rerank_order, reranked_order) if a != b)
            print(f"\n>> Ordering DIFFERS in {changed}/{min(len(no_rerank_order), len(reranked_order))} of the top positions.")
            print(f">> Latency cost: +{elapsed_yes - elapsed_no:.2f}s")


if __name__ == "__main__":
    asyncio.run(main())
