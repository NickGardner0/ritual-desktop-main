from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.day_recap_service import (
    NormalizedEvidence,
    RecapWorkstream,
    build_recap_workstreams,
    render_day_recap,
)


def _evidence(
    *,
    evidence_id: str,
    source: str,
    start_ts: int,
    end_ts: int,
    app: str = "",
    domain: str = "",
    title: str = "",
    document_path: str = "",
    semantic_summary: str = "",
    raw_text: str = "",
    confidence: float = 0.7,
    entity_tokens: set[str] | None = None,
):
    return NormalizedEvidence(
        evidence_id=evidence_id,
        source=source,
        start_ts=start_ts,
        end_ts=end_ts,
        app=app,
        domain=domain,
        title=title,
        document_path=document_path,
        semantic_summary=semantic_summary,
        raw_text=raw_text,
        confidence=confidence,
        entity_tokens=entity_tokens or set(),
    )


def test_build_recap_workstreams_merges_adjacent_browser_entities():
    rows = [
        _evidence(
            evidence_id="1",
            source="context_snapshot",
            start_ts=1_000,
            end_ts=2_000,
            app="Google Chrome",
            domain="mail.google.com",
            title="Inbox - Gmail",
            raw_text="Replying to email about Ritual release",
            entity_tokens={"gmail", "ritual", "release"},
        ),
        _evidence(
            evidence_id="2",
            source="context_snapshot",
            start_ts=6_000,
            end_ts=8_000,
            app="Google Chrome",
            domain="docs.google.com",
            title="Ritual beta launch plan - Google Docs",
            raw_text="Updating launch checklist and beta copy",
            entity_tokens={"google", "docs", "ritual", "launch"},
        ),
    ]

    workstreams = build_recap_workstreams(rows, [])

    assert len(workstreams) == 1
    assert workstreams[0].kind in {"research", "admin", "communication", "browsing"}
    assert "gmail" in workstreams[0].supporting_entities


def test_build_recap_workstreams_splits_large_gaps_and_respects_meeting_overlap():
    rows = [
        _evidence(
            evidence_id="code-1",
            source="session_doc",
            start_ts=1_000,
            end_ts=8_000,
            app="Cursor",
            title="watcher.rs",
            document_path="/Users/nick/ritual-desktop-main/apps/desktop/src-tauri/src/watcher.rs",
            semantic_summary="Updating watcher startup logic",
            raw_text="Prefer bundled watcher helper before ~/.ritual/bin fallback",
            entity_tokens={"watcher", "bundled", "tauri"},
        ),
        _evidence(
            evidence_id="meeting-1",
            source="context_snapshot",
            start_ts=2_000_000,
            end_ts=2_050_000,
            app="Google Chrome",
            title="Weekly sync meeting",
            raw_text="Discussing beta launch and onboarding issues",
            entity_tokens={"meeting", "beta", "launch"},
        ),
    ]
    calendar_events = [
        {
            "title": "Weekly sync",
            "start_ts": 1_990_000,
            "end_ts": 2_060_000,
        }
    ]

    workstreams = build_recap_workstreams(rows, calendar_events)

    assert len(workstreams) == 2
    assert workstreams[0].kind == "coding"
    assert workstreams[1].kind == "meeting"


def test_render_day_recap_preserves_chronology_and_notes():
    workstreams = [
        RecapWorkstream(
            kind="coding",
            start_ts=1_000,
            end_ts=8_000,
            primary_title="watcher.rs changes",
            supporting_entities=["Cursor", "watcher.rs"],
            source_evidence_ids=["1"],
            confidence=0.9,
            narrative_priority=1.0,
            sentences=["You were coding against `watcher.rs`.", "Strong evidence pointed to updating watcher startup logic."],
        ),
        RecapWorkstream(
            kind="meeting",
            start_ts=20_000,
            end_ts=28_000,
            primary_title="Weekly sync",
            supporting_entities=["calendar"],
            source_evidence_ids=["2"],
            confidence=0.8,
            narrative_priority=0.9,
            sentences=["You spent this block in meeting-related work around Weekly sync."],
        ),
    ]

    rendered = render_day_recap(
        anchor_date="2026-04-01",
        timezone_name="UTC",
        workstreams=workstreams,
        degradation_notes=["Cloud semantic retrieval was sparse."],
        bundle={"calendar_events": []},
    )

    assert "**2026-04-01**" in rendered
    assert rendered.index("watcher.rs changes") < rendered.index("Weekly sync")
    assert "Recap quality notes" in rendered
