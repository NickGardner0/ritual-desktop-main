"use client";

import type { EntitySummary } from "@ritual/shared-contracts";

export function UnknownEntity({
  summary,
}: {
  summary?: EntitySummary | null;
}) {
  return (
    <div className="rounded-md border border-[var(--ritual-border-subtle)] bg-[var(--ritual-surface-panel)] px-3 py-2 text-[13px] text-[var(--ritual-text-muted)]">
      {summary?.title || "This object is unavailable."}
    </div>
  );
}
