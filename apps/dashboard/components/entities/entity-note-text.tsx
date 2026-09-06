"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitEntityMentionText, stripEntityMentionTokens } from "@ritual/shared-contracts";
import { LiveEntityPill } from "@/components/entities/live-entity-pill";
import { entityProtocolEnabled } from "@/lib/entities/feature-flag";
import { cn } from "@/lib/utils";

const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => <p className="mb-1 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: ReactNode }) => <ul className="mb-1 list-disc pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="mb-1 list-decimal pl-4 last:mb-0">{children}</ol>,
  li: ({ children }: { children?: ReactNode }) => <li className="leading-5">{children}</li>,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} className="underline underline-offset-2" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }: { children?: ReactNode }) => <strong className="font-medium">{children}</strong>,
  em: ({ children }: { children?: ReactNode }) => <em>{children}</em>,
  h1: ({ children }: { children?: ReactNode }) => <p className="mb-1 font-medium last:mb-0">{children}</p>,
  h2: ({ children }: { children?: ReactNode }) => <p className="mb-1 font-medium last:mb-0">{children}</p>,
  h3: ({ children }: { children?: ReactNode }) => <p className="mb-1 font-medium last:mb-0">{children}</p>,
  code: ({ children }: { children?: ReactNode }) => (
    <code className="font-mono text-[0.9em]">{children}</code>
  ),
  img: () => null,
};

function MarkdownSegment({ value }: { value: string }) {
  if (!value) return null;
  const isBlock = value.includes("\n");
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        ...markdownComponents,
        p: ({ children }: { children?: ReactNode }) =>
          isBlock ? <p className="mb-1 last:mb-0">{children}</p> : <span>{children}</span>,
      }}
    >
      {value}
    </ReactMarkdown>
  );
}

export function EntityNoteText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!entityProtocolEnabled()) {
    return (
      <div className={cn("whitespace-pre-wrap", className)}>
        <MarkdownSegment value={stripEntityMentionTokens(text)} />
      </div>
    );
  }

  const parts = splitEntityMentionText(text);
  if (!parts.length) {
    return (
      <div className={cn(className)}>
        <MarkdownSegment value={text} />
      </div>
    );
  }

  return (
    <div className={cn(className)}>
      {parts.map((part, index) => {
        if (part.kind === "text") {
          return <MarkdownSegment key={`text-${index}`} value={part.value} />;
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
    </div>
  );
}
