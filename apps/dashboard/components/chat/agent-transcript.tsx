'use client';

import type { SessionItem } from '@ritual/agent';

export function AgentTranscript({
  items,
  streamingText,
  isStreaming,
}: {
  items: SessionItem[];
  streamingText?: string;
  isStreaming?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <AgentItem key={`${item.type}-${item.seq}`} item={item} />
      ))}
      {streamingText ? (
        <div className="text-[13px] leading-[1.55] text-[var(--ritual-text-primary)]">
          {streamingText}
        </div>
      ) : null}
      {isStreaming && !streamingText ? (
        <div className="text-[13px] text-[var(--ritual-text-muted)]">Thinking…</div>
      ) : null}
    </div>
  );
}

function AgentItem({ item }: { item: SessionItem }) {
  switch (item.type) {
    case 'user':
      return (
        <div className="max-w-[92%] self-start rounded-[12px] bg-[var(--ritual-surface-panel)] px-3 py-2 text-[13px] leading-5 text-[var(--ritual-text-primary)]">
          {item.payload.text}
        </div>
      );
    case 'assistant_text':
      return (
        <div className="text-[13px] leading-[1.55] text-[var(--ritual-text-primary)]">
          {item.payload.text}
        </div>
      );
    case 'tool_called':
      return (
        <div className="rounded-md bg-[var(--ritual-surface-recessed)] px-3 py-2 text-[12px] text-[var(--ritual-text-secondary)]">
          <span className="font-medium text-[var(--ritual-text-primary)]">{item.payload.name}</span>
          {' '}running
        </div>
      );
    case 'tool_result': {
      const failed = item.payload.status === 'error';
      return (
        <div className="rounded-md border border-[var(--ritual-border-default)] bg-[var(--ritual-surface-raised)] px-3 py-2 text-[12px] text-[var(--ritual-text-secondary)]">
          <span className="font-medium text-[var(--ritual-text-primary)]">{item.payload.name}</span>
          {failed ? ' failed' : ' done'}
          {item.payload.receipt?.habit_name ? (
            <div className="mt-1 text-[11px] text-[var(--ritual-text-muted)]">
              {item.payload.receipt.action_kind} · {item.payload.receipt.habit_name}
            </div>
          ) : null}
        </div>
      );
    }
    case 'approval_ask':
      return (
        <div className="rounded-md border border-[var(--ritual-border-default)] px-3 py-2 text-[12px] text-[var(--ritual-text-secondary)]">
          Approval needed for <span className="font-medium text-[var(--ritual-text-primary)]">{item.payload.name}</span>
        </div>
      );
    case 'approval':
      return (
        <div className="text-[12px] text-[var(--ritual-text-muted)]">
          {item.payload.decision === 'deny' ? 'Denied' : 'Approved'}
        </div>
      );
    case 'system':
      return (
        <div className="text-center text-[12px] italic text-[var(--ritual-text-muted)]">
          {item.payload.text}
        </div>
      );
    default:
      return null;
  }
}
