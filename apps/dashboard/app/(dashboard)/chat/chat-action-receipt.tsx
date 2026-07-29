'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { apiJsonWithAuth } from '@/lib/api/client';

export type ChatActionReceipt = {
  receipt_id: string;
  action_kind: string;
  habit_id?: string | null;
  habit_name?: string | null;
  was_inserted?: boolean;
  undoable?: boolean;
  log_id?: string | null;
  amount?: number | null;
  date?: string | null;
};

export function chatActionReceiptsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CHAT_ACTION_RECEIPTS !== '0';
}

function describeReceipt(receipt: ChatActionReceipt): string {
  const name = receipt.habit_name || 'a habit';
  if (receipt.action_kind === 'createHabit') {
    return `Created habit “${name}”`;
  }
  if (receipt.amount != null) {
    return `Logged ${name}: ${receipt.amount}`;
  }
  return `Logged ${name}`;
}

export function ChatActionReceiptList({
  receipts,
  onUndone,
}: {
  receipts: ChatActionReceipt[];
  onUndone?: (receiptId: string) => void;
}) {
  if (!chatActionReceiptsEnabled() || !receipts.length) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {receipts.map((receipt) => (
        <ChatActionReceiptCard
          key={receipt.receipt_id}
          receipt={receipt}
          onUndone={onUndone}
        />
      ))}
    </div>
  );
}

function ChatActionReceiptCard({
  receipt,
  onUndone,
}: {
  receipt: ChatActionReceipt;
  onUndone?: (receiptId: string) => void;
}) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(true);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUndo = async () => {
    if (busy || undone || !receipt.undoable) return;
    setBusy(true);
    setError(null);
    try {
      await apiJsonWithAuth(`/api/action-receipts/${receipt.receipt_id}/undo`, getToken, {
        method: 'POST',
      });
      setUndone(true);
      onUndone?.(receipt.receipt_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-[12px] font-medium text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{undone ? 'Change undone' : 'Ritual changed…'}</span>
        <span className="text-[11px] text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] text-foreground">{describeReceipt(receipt)}</p>
            {receipt.was_inserted === false ? (
              <p className="mt-0.5 text-[11px]">Already applied (idempotent retry)</p>
            ) : null}
            {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
          </div>
          {receipt.undoable && !undone ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUndo()}
              className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy ? 'Undoing…' : 'Undo'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
