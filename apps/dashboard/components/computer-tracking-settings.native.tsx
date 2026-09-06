'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function NativeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-[6px] ml-[10px] text-[11px] font-semibold uppercase leading-none tracking-[0.045em] text-[#8a8a8a]">{title}</h2>
      <div className="settings-group-card overflow-hidden">
        {children}
      </div>
    </section>
  );
}

export function NativeRow({
  icon,
  title,
  description,
  control,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-[18px] py-[7px]">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <div className="shrink-0 text-[#7a7a7a]">{icon}</div> : null}
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-[16px] text-[#1d1d1f]">{title}</p>
          {description ? (
            <p className="mt-[2px] max-w-[330px] text-[12px] leading-[15px] text-[#8a8a8a]">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end">{control}</div>
    </div>
  );
}

export function NativeToggle({
  checked,
  onClick,
  disabled,
}: {
  checked: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        'relative inline-flex h-4 w-[28px] flex-shrink-0 items-center rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.10)] transition-colors duration-200 disabled:opacity-50',
        checked ? 'bg-black' : 'bg-[#d9d9d7]',
      )}
    >
      <span
        className={cn(
          'inline-block h-3 w-3 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200',
          checked ? 'translate-x-[13px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function DiagRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={cn('text-right', ok === true ? 'text-green-700' : ok === false ? 'text-red-700' : 'text-gray-900')}>
        {value}
      </span>
    </div>
  );
}

export function formatDebugTimestamp(value: unknown): string {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return 'Unavailable';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function attributionHealthStatusClass(status?: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'healthy') return 'border-green-200 bg-green-50 text-green-700';
  if (normalized === 'catching up') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (normalized === 'degraded but usable') return 'border-orange-200 bg-orange-50 text-orange-700';
  return 'border-red-200 bg-red-50 text-red-700';
}
