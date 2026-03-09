'use client';

import { cn } from '@/lib/utils';

type StatusType = 'todo' | 'in-progress' | 'in-review' | 'complete';

const COLUMN_TO_STATUS: Record<string, StatusType> = {
  todo: 'todo',
  'in-progress': 'in-progress',
  'in-review': 'in-review',
  complete: 'complete',
  // Legacy IDs for migration
  'todays-rituals': 'todo',
  'in-flow': 'in-progress',
  reflect: 'in-review',
};

export function StatusIcon({
  columnId,
  className,
}: {
  columnId: string;
  className?: string;
}) {
  const status: StatusType = COLUMN_TO_STATUS[columnId] ?? 'todo';

  if (status === 'complete') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" className="fill-foreground" />
          <path
            d="M5 8L7 10L11 6"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  if (status === 'in-review') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle
            cx="8"
            cy="8"
            r="6.5"
            className="stroke-foreground/40"
            strokeWidth="1.5"
          />
          <circle
            cx="8"
            cy="8"
            r="2.5"
            className="fill-foreground/40"
          />
        </svg>
      </div>
    );
  }

  if (status === 'in-progress') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle
            cx="8"
            cy="8"
            r="6.5"
            className="stroke-foreground/40"
            strokeWidth="1.5"
          />
          <path
            d="M8 1.5A6.5 6.5 0 0 1 14.5 8A6.5 6.5 0 0 1 8 14.5V1.5Z"
            className="fill-foreground/40"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle
          cx="8"
          cy="8"
          r="6.5"
          className="stroke-foreground/25"
          strokeWidth="1.5"
          strokeDasharray="3 2"
        />
      </svg>
    </div>
  );
}
