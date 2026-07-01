'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export const SETTINGS_MUTED_TEXT_CLASS = 'text-[#616161]';

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className={cn('text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>{label}</span>
      <span className="text-[13px] text-gray-900">{value}</span>
    </div>
  );
}

export function SegmentButton({ children, active, onClick, small }: { children: React.ReactNode; active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-sm border text-[13px] font-medium transition-all',
        small ? 'px-2 py-1' : 'px-3 py-1.5',
        active
          ? 'border-gray-900 bg-gray-900 text-white'
          : `border-gray-200 bg-white ${SETTINGS_MUTED_TEXT_CLASS} hover:bg-[#F3F3F3]`,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Pill toggle shared by this settings panel so the visual language is consistent
 * regardless of underlying primitive.
 */
export function GreenToggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-[28px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-[#3c7783]' : 'bg-[#d9d9d7]',
      )}
    >
      <span
        className={cn(
          'inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[13px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
