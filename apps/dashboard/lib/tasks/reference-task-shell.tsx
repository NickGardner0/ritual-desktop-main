'use client';

/**
 * @deprecated Use `@/lib/tasks/task-ui-shell` instead.
 * Re-export shim for backward compatibility during migration.
 */
import type React from 'react';
import type { ReactNode } from 'react';

export {
  TaskPageShell as ReferencePage,
  TaskPageHeader as ReferenceHeader,
  ViewTabs as SegmentedTabs,
  ViewPills as FilterChip,
  ToolbarIconButton as IconButton,
  DetailFieldRow as FieldRow,
  InlineFieldInput as InlineControl,
  PillSelect,
  priorityBars,
  taskContentMaxClass,
} from './task-ui-shell';

import { cn } from '@/lib/utils';

/** @deprecated */
export const taskSurfaceClass = 'bg-[var(--content-bg)] text-[var(--text-primary)]';
/** @deprecated */
export const subtleBorderClass = 'border-[var(--border-subtle)]';
/** @deprecated */
export const controlClass =
  'rounded-sm border border-gray-200/90 bg-white px-2.5 text-[12.5px] text-[#27251E] shadow-sm outline-none focus:border-gray-300 focus:ring-1 focus:ring-gray-300';

/** @deprecated Use flat DetailFieldRow sections instead */
export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-[6px] border border-[var(--border-subtle)]', className)}>
      {children}
    </section>
  );
}

/** @deprecated Use PillSelect instead */
export function InlineSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-7 min-w-0 rounded-sm border border-gray-200/90 bg-white px-2.5 text-[12.5px] text-[#27251E] shadow-sm outline-none focus:border-gray-300',
        className,
      )}
      {...props}
    />
  );
}
