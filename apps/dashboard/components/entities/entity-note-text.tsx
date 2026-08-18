"use client";

import { splitEntityMentionText, stripEntityMentionTokens } from "@ritual/shared-contracts";
import { LiveEntityPill } from "@/components/entities/live-entity-pill";
import { entityProtocolEnabled } from "@/lib/entities/feature-flag";
import { cn } from "@/lib/utils";

export function EntityNoteText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!entityProtocolEnabled()) {
    return <span className={cn("whitespace-pre-wrap", className)}>{stripEntityMentionTokens(text)}</span>;
  }

  const parts = splitEntityMentionText(text);
  if (!parts.length) {
    return <span className={cn("whitespace-pre-wrap", className)}>{text}</span>;
  }

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {parts.map((part, index) => {
        if (part.kind === "text") {
          return <span key={`text-${index}`}>{part.value}</span>;
        }
        if (part.kind === "unknown") {
          return (
            <span
              key={`unknown-${index}`}
              className="inline-flex max-w-full items-center rounded-full border border-[var(--ritual-border-subtle)] bg-[var(--ritual-surface-panel)] px-2 py-0.5 text-[12px] text-[var(--ritual-text-muted)]"
            >
              Unknown
            </span>
          );
        }
        return (
          <LiveEntityPill
            key={`${part.ref.type}:${part.ref.id}:${index}`}
            entityRef={part.ref}
            className="align-middle"
          />
        );
      })}
    </span>
  );
}
