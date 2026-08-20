'use client';

import type React from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { TaskPriority } from './types';

export const taskSurfaceClass = 'bg-[var(--content-bg)] text-[#16181d]';
export const subtleBorderClass = 'border-[rgba(15,23,42,0.075)]';
export const controlClass =
  'rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/90 text-[#2b3038] shadow-[0_1px_2px_rgba(15,23,42,0.035)] outline-none transition focus:border-[rgba(15,23,42,0.22)] focus:bg-white';

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
    <header className={cn('shrink-0 border-b px-9 pb-4 pt-7', subtleBorderClass, className)}>
      <div className="flex min-w-0 items-start justify-between gap-5">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-2 flex items-center gap-2 text-[12px] font-[650] uppercase tracking-[0.16em] text-[#6f7680]">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="truncate text-[36px] font-[680] leading-none tracking-[-0.035em] text-[#10141d]">
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
    <div className={cn('inline-flex min-w-0 items-center gap-1 rounded-sm bg-[#eef1ea] p-1', className)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'h-8 rounded-sm px-3.5 text-[14px] font-[640] transition',
            value === option.id
              ? 'bg-white text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
              : 'text-[#6b7280] hover:bg-white/55 hover:text-[#20242b]',
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
        'h-8 rounded-sm px-3 text-[14px] font-[640] transition',
        active ? 'bg-[#e8eee1] text-[#111827]' : 'text-[#68707b] hover:bg-[#f0f2ed] hover:text-[#22262d]',
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
        'inline-flex h-8 w-8 items-center justify-center rounded-sm text-[#747b85] transition hover:bg-[#eef1ea] hover:text-[#171b22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111827]',
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
    <section className={cn('overflow-hidden rounded-[8px] border border-[rgba(15,23,42,0.07)] bg-[#f4f5f2]', className)}>
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
    <div className={cn('grid min-h-[48px] grid-cols-[minmax(120px,1fr)_minmax(0,auto)] items-center gap-4 border-b border-[rgba(15,23,42,0.065)] px-4 last:border-b-0', className)}>
      <span className="min-w-0 truncate text-[15px] font-[560] text-[#6a717b]">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2">{children}</span>
    </div>
  );
}

export function InlineControl({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('h-8 min-w-0 rounded-sm border border-transparent bg-white/82 px-2.5 text-[14px] font-[560] text-[#22262d] outline-none focus:border-[rgba(15,23,42,0.16)]', className)}
      {...props}
    />
  );
}

export function InlineSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn('h-8 min-w-0 rounded-sm border border-transparent bg-white/82 px-2.5 text-[14px] font-[560] text-[#22262d] outline-none focus:border-[rgba(15,23,42,0.16)]', className)}
      {...props}
    />
  );
}

export function priorityBars(priority: TaskPriority, muted = false) {
  const count = priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
  const fillClass =
    priority === 'low'
      ? 'bg-[#2f6e45]'
      : priority === 'high'
        ? 'bg-[#941304]'
        : 'bg-[#ef6c2f]';
  return (
    <span className="flex h-4 w-5 items-end gap-[2px]" aria-label={`Priority ${priority}`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-full',
            index === 0 ? 'h-1.5' : index === 1 ? 'h-2.5' : 'h-3.5',
            index < count ? fillClass : muted ? 'bg-[#d4d8d2]' : 'bg-[#c9cec6]',
          )}
        />
      ))}
    </span>
  );
}
