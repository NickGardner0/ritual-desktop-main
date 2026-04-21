"""SMS chatbot eval suite (Phase 1 T1.5).

Representative prompts covering the intent-classification boundary cases
that commit f721c40 fixed (ambiguous inputs → READ, not WRITE). Acts as
a regression gate on any future prompt change.

## Usage

This file is a **scaffold**. Expected behavior is declared inline; the
runner that actually calls the orchestrator and scores outputs is wired
up in the next phase when the `/api/chat/sms` endpoint becomes easier to
invoke from backend tests. Until then:

1. Open the CASES table below.
2. Copy each `message` into the deployed SMS number on the `v2` prompt.
3. Confirm the observed intent matches `expected_intent`.
4. Confirm `should_mention` substrings appear (roughly, fuzzy) in the reply.
5. Confirm the reply has `expected_segments` (1 for single-message, >1 for
   multi-beat).

Run manually for every PR that touches SMS_STYLE_PROMPT or orchestrator
SMS routing. Once the harness is automated, it runs on CI.

## Calibration

- Safety-critical cases (SAFE_WRITE, SAFE_READ) MUST pass 100%.
- Ambiguous cases (AMBIGUOUS) MUST resolve to READ (the inviolable rule).
- Voice cases (VOICE) are rated qualitatively — looking for warmth and
  absence of banned openers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal, Optional


Intent = Literal["read", "write", "clarify"]


@dataclass(frozen=True)
class SmsCase:
    case_id: str
    category: Literal["SAFE_WRITE", "SAFE_READ", "AMBIGUOUS", "VOICE", "MULTI_SEGMENT"]
    message: str
    expected_intent: Intent
    # Substrings or concepts the reply should touch on (fuzzy match OK).
    should_mention: tuple[str, ...] = ()
    # Phrases the reply must NOT contain (e.g., filler openers).
    must_not_contain: tuple[str, ...] = ()
    # Expected number of outbound segments. None = "don't care".
    expected_segments: Optional[int] = None
    notes: str = ""


# ---------------------------------------------------------------------------
# 20 representative cases
# ---------------------------------------------------------------------------
# Keep this list stable. Add new cases at the bottom with new IDs. Never
# renumber — case IDs are referenced by regression reports.

CASES: List[SmsCase] = [
    # SAFE_WRITE — confident writes. Must log, must not ask a question.
    SmsCase("W01", "SAFE_WRITE", "30mg caffeine", "write",
            should_mention=("caffeine", "30"),
            expected_segments=1),
    SmsCase("W02", "SAFE_WRITE", "ran 5k this morning", "write",
            should_mention=("5k", "run"),
            expected_segments=1),
    SmsCase("W03", "SAFE_WRITE", "just did 45 min workout", "write",
            should_mention=("45", "workout"),
            expected_segments=1),
    SmsCase("W04", "SAFE_WRITE", "log 20oz water", "write",
            should_mention=("water", "20"),
            expected_segments=1),
    SmsCase("W05", "SAFE_WRITE", "meditated for 10 minutes", "write",
            should_mention=("meditat", "10"),
            expected_segments=1),

    # SAFE_READ — confident reads. Must NOT write, must return data or a
    # graceful "no data" message.
    SmsCase("R01", "SAFE_READ", "how was my sleep last night?", "read",
            should_mention=("sleep",),
            must_not_contain=("logged",),
            expected_segments=1),
    SmsCase("R02", "SAFE_READ", "what's my caffeine this week?", "read",
            should_mention=("caffeine",),
            must_not_contain=("logged",)),
    SmsCase("R03", "SAFE_READ", "show me my workouts", "read",
            must_not_contain=("logged",)),
    SmsCase("R04", "SAFE_READ", "did I hit my meditation streak?", "read",
            should_mention=("meditat",),
            must_not_contain=("logged",)),
    SmsCase("R05", "SAFE_READ", "how much did I walk yesterday", "read",
            should_mention=("walk",),
            must_not_contain=("logged",)),

    # AMBIGUOUS — inviolable rule: default to READ. A missed log is
    # recoverable; a wrong log corrupts history.
    SmsCase("A01", "AMBIGUOUS", "8 hours", "read",
            must_not_contain=("logged 8 hours",),
            notes="Could be sleep, fasting, work. MUST default to read — commit f721c40."),
    SmsCase("A02", "AMBIGUOUS", "water", "read",
            must_not_contain=("logged water",),
            notes="No value, no verb. Must not silently log."),
    SmsCase("A03", "AMBIGUOUS", "today", "read",
            must_not_contain=("logged",),
            notes="One-word message — should not trigger a write."),
    SmsCase("A04", "AMBIGUOUS", "coffee", "read",
            must_not_contain=("logged",),
            notes="Bare noun. Not a value+unit pair."),

    # VOICE — qualitative. Looking for warm tone, absence of banned openers.
    SmsCase("V01", "VOICE", "what's my sleep avg this month?", "read",
            must_not_contain=(
                "Sure!", "Absolutely", "I'd be happy to", "Great question",
            ),
            notes="No filler openers in v2 prompt."),
    SmsCase("V02", "VOICE", "logged 2 miles walk", "write",
            should_mention=("2",),
            must_not_contain=(
                "Logging 2 miles walk complete",
            ),
            notes="First-person ack, not robotic."),
    SmsCase("V03", "VOICE", "how was my hrv this week?", "read",
            should_mention=("hrv",),
            notes="Interpretive sentence with the number (v2 voice rule)."),

    # MULTI_SEGMENT — should produce >1 segment on v2 prompt. V1 will produce 1.
    SmsCase("M01", "MULTI_SEGMENT", "give me a full weekly recap with trends",
            "read",
            expected_segments=2,  # at most; orchestrator may also send 3
            notes="Multi-beat summary — v2 prompt should split. V1 will single-msg."),
    SmsCase("M02", "MULTI_SEGMENT", "how am i doing overall this month",
            "read",
            expected_segments=2,
            notes="Summary + interpretive — good candidate for split."),

    # Bonus safety case: combined WRITE + READ sentence. Confident WRITE wins.
    SmsCase("W06", "SAFE_WRITE", "ran 3 miles. what's my pace lately?", "write",
            should_mention=("3 miles", "ran"),
            notes="Both clauses present. Log the write, optionally answer the read."),
    SmsCase("A05", "AMBIGUOUS", "7.5", "read",
            must_not_contain=("logged",),
            notes="Bare number. Could be sleep hours, weight, anything."),
]


def cases_by_category() -> dict[str, List[SmsCase]]:
    """Group cases by category for scoped replays."""
    out: dict[str, List[SmsCase]] = {}
    for case in CASES:
        out.setdefault(case.category, []).append(case)
    return out


# ---------------------------------------------------------------------------
# Basic sanity test (runs without OpenAI)
# ---------------------------------------------------------------------------


def test_case_registry_is_well_formed() -> None:
    """Structural checks — case IDs unique, mandatory fields present."""
    ids = [c.case_id for c in CASES]
    assert len(ids) == len(set(ids)), f"duplicate case IDs: {ids}"
    assert len(CASES) >= 20, f"expected >=20 cases, got {len(CASES)}"

    categories = {c.category for c in CASES}
    assert {"SAFE_WRITE", "SAFE_READ", "AMBIGUOUS", "VOICE", "MULTI_SEGMENT"} <= categories, (
        f"missing categories in registry: {categories}"
    )

    for case in CASES:
        assert case.message, f"empty message for {case.case_id}"
        assert case.expected_intent in ("read", "write", "clarify"), (
            f"invalid expected_intent for {case.case_id}: {case.expected_intent}"
        )
        # Inviolable: every AMBIGUOUS case must default to READ.
        if case.category == "AMBIGUOUS":
            assert case.expected_intent == "read", (
                f"AMBIGUOUS case {case.case_id} must expect read (safety rule)"
            )


if __name__ == "__main__":
    # Quick sanity-check when run directly.
    test_case_registry_is_well_formed()
    total = len(CASES)
    by_cat = cases_by_category()
    print(f"SMS eval suite: {total} cases")
    for cat, items in sorted(by_cat.items()):
        print(f"  {cat}: {len(items)}")
