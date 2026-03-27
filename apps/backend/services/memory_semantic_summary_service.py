"""
Semantic summary generation for context snapshots.

Processes context_snapshots that lack a semantic summary, generating
a concise LLM-produced description of what the user was doing.
Runs as a background task, not in the hot capture path.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BATCH_SIZE = int(os.environ.get("SEMANTIC_SUMMARY_BATCH_SIZE", "20"))
MODEL = os.environ.get("SEMANTIC_SUMMARY_MODEL", "gpt-4o-mini")
MAX_TOKENS = 120  # summaries should be short


def _get_openai_client():
    """Lazy import to avoid startup cost when not used."""
    from openai import OpenAI
    return OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _ensure_summary_column(conn: sqlite3.Connection) -> None:
    """Add semantic_summary column to context_snapshots if it doesn't exist."""
    try:
        conn.execute("SELECT semantic_summary FROM context_snapshots LIMIT 0")
    except sqlite3.OperationalError:
        conn.execute(
            "ALTER TABLE context_snapshots ADD COLUMN semantic_summary TEXT DEFAULT NULL"
        )
        conn.commit()
        logger.info("Added semantic_summary column to context_snapshots")


def _fetch_unsummarized(conn: sqlite3.Connection, limit: int) -> List[Dict[str, Any]]:
    """Fetch snapshots that don't have a semantic summary yet."""
    rows = conn.execute(
        """
        SELECT id, app_name, window_title, document_path, document_title,
               browser_domain, browser_url,
               substr(COALESCE(visible_text_raw, visible_text_norm, ''), 1, 1200) as visible_text,
               ax_richness_score, ts
        FROM context_snapshots
        WHERE semantic_summary IS NULL
          AND length(COALESCE(visible_text_raw, visible_text_norm, '')) > 30
        ORDER BY ax_richness_score DESC, ts DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def _save_summaries(conn: sqlite3.Connection, summaries: List[tuple]) -> None:
    """Batch update summaries. summaries = [(summary_text, snapshot_id), ...]"""
    conn.executemany(
        "UPDATE context_snapshots SET semantic_summary = ? WHERE id = ?",
        summaries,
    )
    conn.commit()


# ---------------------------------------------------------------------------
# LLM summary generation
# ---------------------------------------------------------------------------

SUMMARY_SYSTEM_PROMPT = """You generate one-sentence semantic summaries of what a user was doing on their computer, based on screen capture evidence.

Rules:
- Output ONLY a single sentence, 10-25 words
- Describe the ACTIVITY, not the app: "Editing vector search scoring in vector.rs" not "Using Cursor"
- Be specific: mention file names, URLs, feature names, or task context when available
- If the evidence is thin (just an app name), say what can be inferred: "Browsing in Chrome" or "Working in Cursor"
- NEVER speculate beyond the evidence. No filler words like "likely", "possibly", "various"
- No quotes, no markdown, no punctuation at the end except a period"""


def _build_evidence_text(snapshot: Dict[str, Any]) -> str:
    """Build a compact evidence string for the LLM."""
    parts = []
    if snapshot.get("app_name"):
        parts.append(f"App: {snapshot['app_name']}")
    if snapshot.get("window_title"):
        parts.append(f"Window: {snapshot['window_title']}")
    if snapshot.get("document_path"):
        parts.append(f"File: {snapshot['document_path']}")
    elif snapshot.get("document_title"):
        parts.append(f"Document: {snapshot['document_title']}")
    if snapshot.get("browser_domain"):
        parts.append(f"Domain: {snapshot['browser_domain']}")
    if snapshot.get("browser_url"):
        url = snapshot["browser_url"]
        if len(url) > 200:
            url = url[:200]
        parts.append(f"URL: {url}")
    visible = (snapshot.get("visible_text") or "").strip()
    if visible:
        parts.append(f"Screen text: {visible[:600]}")
    return "\n".join(parts)


def generate_summaries_batch(
    snapshots: List[Dict[str, Any]],
) -> List[Optional[str]]:
    """Generate semantic summaries for a batch of snapshots using OpenAI."""
    if not snapshots:
        return []

    client = _get_openai_client()
    results: List[Optional[str]] = []

    for snapshot in snapshots:
        evidence = _build_evidence_text(snapshot)
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": evidence},
                ],
                max_tokens=MAX_TOKENS,
                temperature=0.1,
            )
            summary = (response.choices[0].message.content or "").strip()
            # Remove trailing period variations and normalize
            if summary and not summary.endswith("."):
                summary += "."
            results.append(summary)
        except Exception as e:
            logger.warning(f"Failed to summarize snapshot {snapshot.get('id')}: {e}")
            results.append(None)

    return results


# ---------------------------------------------------------------------------
# Main processing function
# ---------------------------------------------------------------------------

def process_pending_summaries(db_path: str, batch_size: int = BATCH_SIZE) -> Dict[str, Any]:
    """
    Process a batch of context snapshots that need semantic summaries.
    Returns stats about what was processed.
    """
    start = time.time()

    conn = sqlite3.connect(db_path, timeout=5.0)
    conn.row_factory = sqlite3.Row

    _ensure_summary_column(conn)

    snapshots = _fetch_unsummarized(conn, batch_size)
    if not snapshots:
        conn.close()
        return {"processed": 0, "remaining": 0, "elapsed_ms": 0}

    # Check remaining count
    remaining = conn.execute(
        """SELECT COUNT(*) FROM context_snapshots
           WHERE semantic_summary IS NULL
             AND length(COALESCE(visible_text_raw, visible_text_norm, '')) > 30"""
    ).fetchone()[0]

    summaries = generate_summaries_batch(snapshots)

    # Save successful summaries
    updates = []
    success_count = 0
    for snapshot, summary in zip(snapshots, summaries):
        if summary:
            updates.append((summary, snapshot["id"]))
            success_count += 1
        else:
            # Mark as processed even on failure to avoid retrying forever
            updates.append(("", snapshot["id"]))

    if updates:
        _save_summaries(conn, updates)

    conn.close()
    elapsed_ms = int((time.time() - start) * 1000)

    logger.info(
        f"Semantic summaries: processed={success_count}/{len(snapshots)}, "
        f"remaining={remaining - len(snapshots)}, elapsed={elapsed_ms}ms"
    )

    return {
        "processed": success_count,
        "batch_size": len(snapshots),
        "remaining": max(0, remaining - len(snapshots)),
        "elapsed_ms": elapsed_ms,
    }


def process_pending_summaries_conn(
    conn: sqlite3.Connection,
    batch_size: int = BATCH_SIZE,
) -> Dict[str, Any]:
    """
    Process semantic summaries using an existing SQLite connection.
    Caller owns connection lifecycle and any replica sync behavior.
    """
    start = time.time()
    conn.row_factory = sqlite3.Row

    _ensure_summary_column(conn)

    snapshots = _fetch_unsummarized(conn, batch_size)
    if not snapshots:
        return {"processed": 0, "remaining": 0, "elapsed_ms": 0}

    remaining = conn.execute(
        """SELECT COUNT(*) FROM context_snapshots
           WHERE semantic_summary IS NULL
             AND length(COALESCE(visible_text_raw, visible_text_norm, '')) > 30"""
    ).fetchone()[0]

    summaries = generate_summaries_batch(snapshots)
    updates = []
    success_count = 0
    for snapshot, summary in zip(snapshots, summaries):
        if summary:
            updates.append((summary, snapshot["id"]))
            success_count += 1
        else:
            updates.append(("", snapshot["id"]))

    if updates:
        _save_summaries(conn, updates)

    elapsed_ms = int((time.time() - start) * 1000)
    logger.info(
        f"Semantic summaries: processed={success_count}/{len(snapshots)}, "
        f"remaining={remaining - len(snapshots)}, elapsed={elapsed_ms}ms"
    )
    return {
        "processed": success_count,
        "batch_size": len(snapshots),
        "remaining": max(0, remaining - len(snapshots)),
        "elapsed_ms": elapsed_ms,
    }
