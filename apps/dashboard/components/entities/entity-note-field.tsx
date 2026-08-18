"use client";

import { useEffect, useRef, useState } from "react";
import {
  insertEntityMentionToken,
  type EntitySummary,
} from "@ritual/shared-contracts";
import { EntityMentionTypeahead, mentionQueryFromInput } from "@/components/entities/entity-link-picker";
import { EntityNoteText } from "@/components/entities/entity-note-text";
import { entityProtocolEnabled } from "@/lib/entities/feature-flag";
import { rememberEntitySummary } from "@/lib/entities/resolve";
import { cn } from "@/lib/utils";

export function EntityNoteField({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  rows = 3,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const enabled = entityProtocolEnabled();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionQuery = enabled ? mentionQueryFromInput(draft) : null;

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [focused, value]);

  const commit = (next: string) => {
    setDraft(next);
    onChange(next);
  };

  const selectMention = (summary: EntitySummary) => {
    rememberEntitySummary(summary);
    commit(insertEntityMentionToken(draft, summary.ref));
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  if (!enabled) {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onBlur?.(value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
      />
    );
  }

  if (!focused) {
    return (
      <div
        role="textbox"
        tabIndex={disabled ? -1 : 0}
        className={cn("min-h-[62px] cursor-text", className)}
        onClick={() => {
          if (disabled) return;
          setFocused(true);
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        }}
        onFocus={() => {
          if (disabled) return;
          setFocused(true);
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        }}
      >
        {value.trim() ? (
          <EntityNoteText text={value} />
        ) : (
          <span className="text-[var(--ritual-text-muted)]">{placeholder}</span>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => commit(event.target.value)}
        onBlur={() => {
          window.setTimeout(() => {
            setFocused(false);
            onBlur?.(draft);
          }, 120);
        }}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
      />
      {mentionQuery !== null ? (
        <EntityMentionTypeahead query={mentionQuery} onSelect={selectMention} />
      ) : null}
    </div>
  );
}
