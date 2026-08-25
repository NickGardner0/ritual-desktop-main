'use client';

import type React from 'react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ritual/ui/select';
import { cn } from '@/lib/utils';
import type { TaskPriority } from './types';

export const taskContentMaxClass = 'w-full max-w-[var(--task-content-max,1120px)]';

export const toolbarPillClass =
  'inline-flex h-7 items-center gap-1 rounded-full border border-[var(--border-floating)] bg-[var(--surface-raised)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] shadow-none hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 disabled:opacity-50';

export function TaskPageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden text-[var(--text-primary)]', className)}>
      {children}
    </div>
  );
}
export function TaskPageHeader({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('shrink-0 pb-5', className)}>
      <div className="flex min-w-0 items-center justify-between gap-4">
        <h1 className="truncate text-[22px] font-medium leading-tight tracking-[-0.02em] text-[#27251E]">
          {title}
        </h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </header>
  );
}

export function ViewTabs<T extends string>({
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
    <div
      className={cn(
        'inline-flex min-w-0 flex-wrap items-center gap-0.5 rounded-full bg-[var(--surface-panel)] p-0.5',
        className,
      )}
      role="tablist"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'h-7 rounded-full border px-3 text-[12.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1',
            value === option.id
              ? 'border-[var(--border-floating)] bg-[var(--surface-raised)] font-medium text-[var(--text-primary)]'
              : 'border-transparent bg-transparent font-normal text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ViewPills({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: ReadonlyArray<string>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'h-7 rounded-full border px-2.5 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1',
            value === option
              ? 'border-transparent bg-[var(--surface-panel)] font-medium text-[var(--text-primary)]'
              : 'border-[var(--border-floating)] font-normal text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function UnderlineTabs<T extends string>({
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
    <div className={cn('flex items-center gap-1 border-b border-[rgba(39,37,30,0.06)] pb-px', className)}>
      {options.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              'relative px-3.5 py-2 text-[13px] font-medium tracking-[-0.1px]',
              isActive ? 'text-[#27251E]' : 'text-[rgba(39,37,30,0.4)] hover:text-[rgba(39,37,30,0.7)]',
            )}
          >
            {option.label}
            <span
              className={cn(
                'absolute bottom-0 left-3 right-3 h-[1.5px] rounded-full',
                isActive ? 'bg-[#27251E] opacity-100' : 'bg-transparent opacity-0',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export function TaskRowShell({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'ritual-snappy-row group/row min-h-[var(--task-row-height,36px)] w-full min-w-0 items-center gap-2.5 rounded-[var(--sidebar-row-radius,var(--radius-row))] px-1 py-1.5 outline-none hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function DetailCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-[8px] bg-[#f8f8f7]', className)}>
      {children}
    </section>
  );
}

export function DetailFieldRow({
  label,
  children,
  hint,
  className,
  inCard = false,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  inCard?: boolean;
}) {
  return (
    <div
      className={cn(
        'py-3',
        inCard ? 'border-b border-[rgba(39,37,30,0.06)] px-3 last:border-b-0' : 'border-b border-[var(--border-subtle)]',
        className,
      )}
    >
      <div className="grid min-h-[32px] grid-cols-[minmax(100px,140px)_minmax(0,1fr)] items-center gap-4">
        <span className="min-w-0 truncate text-[13px] text-[rgba(39,37,30,0.55)]">{label}</span>
        <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
      </div>
      {hint ? (
        <div className={cn('mt-1.5 text-[12px] text-[rgba(39,37,30,0.45)]', inCard ? 'px-3 pb-1' : 'pl-[calc(140px+1rem)]')}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function PillButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        toolbarPillClass,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function ToolbarIconButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-floating)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  placeholder,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger
        className={cn(
          'h-7 w-auto min-w-[88px] gap-1 rounded-full border border-[var(--border-floating)] bg-[var(--surface-raised)] px-3 text-[12.5px] font-normal text-[var(--text-primary)] shadow-none hover:bg-[var(--row-hover)] focus:ring-1 focus:ring-[var(--ritual-focus-ring)] focus:ring-offset-0',
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="end" className="rounded-md">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="rounded-md text-[13px]">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function InlineFieldInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-7 min-w-0 rounded-md border border-gray-200/90 bg-white px-2.5 text-[12.5px] text-[#27251E] shadow-sm outline-none placeholder:text-[rgba(39,37,30,0.4)] focus:border-gray-300 focus:ring-1 focus:ring-gray-300',
        className,
      )}
      {...props}
    />
  );
}

export function DetailTextarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-[6px] border border-[var(--border-subtle)] bg-[#f8f8f7] px-3 py-2.5 text-[14px] text-[#27251E] outline-none placeholder:text-[rgba(39,37,30,0.4)] focus:border-gray-300 focus:ring-1 focus:ring-gray-300',
        className,
      )}
      {...props}
    />
  );
}

export function priorityBars(priority: TaskPriority, muted = false) {
  if (priority === 'urgent') {
    return (
      <span className="flex h-4 w-5 items-center" aria-label="Priority urgent">
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[2px] bg-[var(--text-primary)] text-[10px] font-medium leading-none text-[var(--surface-raised)]">
          !
        </span>
      </span>
    );
  }
  const count = priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
  return (
    <span className="flex h-4 w-5 items-end gap-[2px]" aria-label={`Priority ${priority}`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-full',
            index === 0 ? 'h-1.5' : index === 1 ? 'h-2.5' : 'h-3.5',
            index < count
              ? 'bg-[var(--text-primary)]'
              : muted
                ? 'bg-[var(--border-subtle)]'
                : 'bg-[var(--border-floating)]',
          )}
        />
      ))}
    </span>
  );
}

export function useHeaderPortal(slotId = 'header-right-slot') {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = document.getElementById(slotId);
    queueMicrotask(() => setSlot(element));
  }, [slotId]);

  return slot;
}

export function HeaderPortal({
  children,
  slotId = 'header-right-slot',
}: {
  children: ReactNode;
  slotId?: string;
}) {
  const slot = useHeaderPortal(slotId);
  if (!slot) return null;
  return createPortal(children, slot);
}

export function GroupBySelect({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  const current = options.find((item) => item.id === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        density="compact"
        className={cn(
          toolbarPillClass,
          'w-auto shrink-0 font-normal text-[var(--text-secondary)] shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] [&>svg]:h-3.5 [&>svg]:w-3.5',
          className,
        )}
      >
        <SelectValue>{`View by ${current?.label ?? 'List'}`}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id} className="text-[13px]">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
