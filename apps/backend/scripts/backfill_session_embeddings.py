#!/usr/bin/env python3
"""
Backfill script: embed all session_retrieval_docs from activity.db → Turbopuffer.

Usage:
    cd apps/backend
    python scripts/backfill_session_embeddings.py

Requires OPENAI_API_KEY and TURBOPUFFER_API_KEY in environment or .env files.
"""

import asyncio
import os
import sys
import time

# Load env vars from .env files
for env_file in [".env", "../dashboard/.env.local", "../dashboard/.env.local.dev"]:
    try:
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    if k and k not in os.environ:
                        os.environ[k] = v
    except FileNotFoundError:
        pass

# Ensure backend root is on the path
backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_root not in sys.path:
    sys.path.insert(0, backend_root)

from services.session_embedding_service import (
    get_embedding_status,
    process_session_embeddings,
)

BATCH_SIZE = 48
PAUSE_BETWEEN_BATCHES_S = 1.0  # Rate limit: ~48 embeddings per second


async def main():
    print("=" * 60)
    print("Session Embedding Backfill")
    print("=" * 60)

    status = await get_embedding_status()
    total = status.get("total_session_docs", 0)
    pending = status.get("pending", 0)
    embedded = status.get("embedded", 0)
    tp_ok = status.get("turbopuffer_configured", False)

    print(f"  Total session docs:  {total}")
    print(f"  Already embedded:    {embedded}")
    print(f"  Pending:             {pending}")
    print(f"  Turbopuffer:         {'configured' if tp_ok else 'NOT CONFIGURED'}")
    print(f"  OpenAI API key:      {'set' if os.getenv('OPENAI_API_KEY') else 'NOT SET'}")
    print()

    if not tp_ok:
        print("ERROR: Turbopuffer is not configured. Set TURBOPUFFER_API_KEY.")
        sys.exit(1)
    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY is not set.")
        sys.exit(1)
    if pending == 0:
        print("Nothing to backfill — all docs are already embedded.")
        return

    start_time = time.time()
    total_processed = 0
    total_failed = 0
    batch_num = 0

    while True:
        batch_num += 1
        result = await process_session_embeddings(batch_size=BATCH_SIZE)

        processed = result.get("processed", 0)
        failed = result.get("failed", 0)
        remaining = result.get("remaining", 0)
        elapsed = result.get("elapsed_ms", 0)

        total_processed += processed
        total_failed += failed

        pct = round((total_processed / pending) * 100, 1) if pending > 0 else 100
        elapsed_total = int(time.time() - start_time)

        print(
            f"  Batch {batch_num}: +{processed} embedded, {failed} failed, "
            f"{remaining} remaining ({pct}% done, {elapsed}ms, total {elapsed_total}s)"
        )

        if remaining == 0 or processed == 0:
            break

        # Brief pause to avoid rate limiting
        await asyncio.sleep(PAUSE_BETWEEN_BATCHES_S)

    elapsed_total = int(time.time() - start_time)
    print()
    print("=" * 60)
    print(f"  Backfill complete!")
    print(f"  Embedded:  {total_processed}")
    print(f"  Failed:    {total_failed}")
    print(f"  Duration:  {elapsed_total}s")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
