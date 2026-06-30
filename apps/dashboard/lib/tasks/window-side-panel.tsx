'use client';

import type React from 'react';
import { useEffect, type ReactNode } from 'react';
import { ChevronsRight } from 'lucide-react';

import { cn } from '@/lib/utils';

export function WindowSidePanel({
  open,
  onClose,
  title,
  headerActions,
  children,
  className,
  widthClassName = 'w-[min(480px,calc(100vw-48px))]',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
  widthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex flex-col border-l border-[var(--border-subtle)] bg-[var(--content-bg)] shadow-[-8px_0_32px_-12px_rgba(15,23,42,0.12)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        widthClassName,
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-[var(--icon-muted)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
          aria-label="Close panel"
          title="Close panel"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-[12.5px] font-medium text-[rgba(39,37,30,0.55)]">
          {title}
        </div>
        <div className="flex w-7 items-center justify-end">{headerActions ?? null}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </aside>
  );
}
