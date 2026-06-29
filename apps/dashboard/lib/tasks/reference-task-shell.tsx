'use client';

import type React from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { TaskPriority } from './types';

export const taskSurfaceClass = 'bg-[var(--surface-content)] text-[var(--text-primary)]';
export const subtleBorderClass = 'border-[var(--border-subtle)]';
export const quietRowClass =
  'ritual-snappy-row rounded-sm bg-[rgba(39,37,30,0.011)] [--ritual-snappy-row-active:rgba(39,37,30,0.032)] [--ritual-snappy-row-hover:rgba(39,37,30,0.024)]';
export const controlClass =
  'rounded-sm border border-[var(--border-muted)] bg-[rgba(39,37,30,0.011)] text-[var(--text-primary)] outline-none transition focus:border-[rgba(15,23,42,0.16)] focus:bg-white';

export function ReferencePage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', taskSurfaceClass, className)}>
      {children}
    </div>
  );
}

export function ReferenceHeader({
  title,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: string;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('shrink-0 px-0 pb-5 pt-0', className)}>
      <div className="flex min-w-0 items-start justify-between gap-5">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-2 flex items-center gap-2 text-[12px] font-normal uppercase tracking-[0.13em] text-[var(--text-muted)]">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="truncate text-[30px] font-semibold leading-none tracking-normal text-[var(--text-primary)]">
            {title}
          </h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </header>
  );
}

export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'h-8 rounded-sm px-2.5 text-[14px] font-normal leading-none transition focus-visible:outline-none',
            value === option.id
              ? 'bg-[rgba(39,37,30,0.045)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function FilterChip({
  active,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'h-8 rounded-sm px-2.5 text-[14px] font-normal leading-none transition focus-visible:outline-none',
        active ? 'bg-[rgba(39,37,30,0.045)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-sm text-[var(--icon-default)] transition hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(15,23,42,0.18)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-sm border border-[var(--border-muted)] bg-[rgba(39,37,30,0.014)]', className)}>
      {children}
    </section>
  );
}

export function FieldRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-h-[42px] grid-cols-[minmax(112px,1fr)_minmax(0,auto)] items-center gap-4 border-b border-[var(--border-muted)] px-3.5 last:border-b-0', className)}>
      <span className="min-w-0 truncate text-sm font-normal text-[var(--text-secondary)]">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2">{children}</span>
    </div>
  );
}

export function InlineControl({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('h-8 min-w-0 rounded-sm border border-transparent bg-white/60 px-2.5 text-sm font-normal text-[var(--text-primary)] outline-none transition focus:border-[rgba(15,23,42,0.12)] focus:bg-white', className)}
      {...props}
    />
  );
}

export function OptionMenu<T extends string>({
  value,
  options,
  onChange,
  className,
  contentClassName,
  align = 'end',
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  ariaLabel?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-sm bg-[rgba(39,37,30,0.024)] px-2.5 text-sm font-normal text-[var(--text-primary)] transition hover:bg-[rgba(39,37,30,0.04)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(15,23,42,0.18)]',
            className,
          )}
        >
          <span className="min-w-0 truncate">{selected?.label || value}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" strokeWidth={1.7} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn(
          'min-w-[150px] border-[var(--border-subtle)] bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.10),0_1px_2px_rgba(15,23,42,0.06)]',
          contentClassName,
        )}
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className="flex h-8 items-center justify-between gap-3 px-2 text-sm font-normal text-[var(--text-primary)] focus:bg-[rgba(39,37,30,0.045)]"
          >
            <span className="truncate">{option.label}</span>
            {option.value === value ? <Check className="h-3.5 w-3.5 text-[var(--icon-default)]" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function priorityBars(priority: TaskPriority, muted = false) {
  const count = priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
  return (
    <span className="flex h-4 w-5 items-end gap-[2px]" aria-label={`Priority ${priority}`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-full',
            index === 0 ? 'h-1.5' : index === 1 ? 'h-2.5' : 'h-3.5',
            index < count ? 'bg-[#ef6c2f]' : muted ? 'bg-[rgba(39,37,30,0.16)]' : 'bg-[rgba(39,37,30,0.20)]',
          )}
        />
      ))}
    </span>
  );
}
