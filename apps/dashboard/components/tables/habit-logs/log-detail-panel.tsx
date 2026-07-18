'use client';

import React, { useState, useCallback } from 'react';
import { X, Copy, Check, ChevronDown } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  getCategoryFillClass,
  normalizeCategoryLabel,
} from '@/lib/category-token';
import { formatSourceLabel } from '@/lib/source-label';
import {
  formatHabitLogDisplayDate,
  formatHabitLogDisplayTime,
} from '@/lib/habit-log-time';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type { HabitLog } from '@/components/habit-logs/types';

interface LogDetailPanelProps {
  log: HabitLog | null;
  open: boolean;
  onClose: () => void;
  onQuickEdit?: (
    log: HabitLog,
    updates: Partial<Pick<HabitLog, 'status' | 'date' | 'integration_source' | 'completed_at'>>,
  ) => void;
  isUpdating?: boolean;
  availableSources?: string[];
}

const STATUS_OPTIONS: Array<{ value: HabitLog['status']; label: string; dotClass: string }> = [
  { value: 'completed', label: 'Completed', dotClass: 'bg-emerald-500' },
  { value: 'skipped', label: 'Skipped', dotClass: 'bg-amber-500' },
  { value: 'missed', label: 'Missed', dotClass: 'bg-rose-500' },
];

function formatLogValue(log: HabitLog): string {
  if (log.duration && log.duration > 0) {
    const hours = log.duration / 3600;
    if (hours >= 1) return `${hours.toFixed(1)} Hours`;
    return `${Math.round(log.duration / 60)} Minutes`;
  }

  if (log.amount !== undefined && log.amount > 0) {
    const amountString = log.amount.toFixed(log.amount < 10 ? 1 : 0);
    return `${amountString} ${log.unit_type || ''}`.trim();
  }

  return '—';
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/60">
      <span className="text-[13px] font-medium text-neutral-500 shrink-0">{label}</span>
      <div className="text-right min-w-0">{children}</div>
    </div>
  );
}

export function LogDetailPanel({
  log,
  open,
  onClose,
  onQuickEdit,
  isUpdating = false,
  availableSources = [],
}: LogDetailPanelProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = useCallback(async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // Ignore clipboard errors
    }
  }, []);

  if (!log) return null;

  const displayDate = formatHabitLogDisplayDate(log, 'MMMM d, yyyy');
  const displayTime = formatHabitLogDisplayTime(log);
  const displayValue = formatLogValue(log);
  const normalizedCategory = normalizeCategoryLabel(log.category);
  const isEditable = log.editable !== false && Boolean(log.habit_id);

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[420px] overflow-y-auto p-0 border-l border-border"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-[18px] font-medium text-neutral-900 truncate">
                {log.habit_name}
              </SheetTitle>
              <p className="mt-1 text-[13px] text-neutral-500">
                {displayDate} &middot; {displayTime}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-sm p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </SheetHeader>

        <div className="px-6 py-2">
          <DetailRow label="Date">
            <span className="text-[14px] text-neutral-900 tabular-nums">{displayDate}</span>
          </DetailRow>

          <DetailRow label="Time">
            <span className="text-[14px] text-neutral-700 tabular-nums">{displayTime}</span>
          </DetailRow>

          <DetailRow label="Value">
            <div className="flex items-center justify-end gap-2">
              <span className="text-[14px] text-neutral-900 tabular-nums">{displayValue}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(displayValue, 'value')}
                className="text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                {copiedField === 'value' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </DetailRow>

          <DetailRow label="Category">
            <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-black/[0.06] bg-[#F2F1EF] px-2 py-[3px]">
              <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', getCategoryFillClass(log.category))} />
              <span className="text-[12px] font-medium leading-none text-neutral-600">
                {normalizedCategory}
              </span>
            </span>
          </DetailRow>

          <DetailRow label="Status">
            {onQuickEdit && isEditable ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-[14px] text-neutral-900 hover:text-neutral-700 transition-colors"
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <BrailleSpinner className="text-sm text-neutral-500" />
                    ) : (
                      <>
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            STATUS_OPTIONS.find((s) => s.value === log.status)?.dotClass || 'bg-emerald-500',
                          )}
                        />
                        <span className="capitalize">{log.status}</span>
                        <ChevronDown className="h-3 w-3 text-neutral-400" />
                      </>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[160px]">
                  {STATUS_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => {
                        if (option.value !== log.status) {
                          onQuickEdit(log, { status: option.value });
                        }
                      }}
                    >
                      <span className={cn('h-2 w-2 rounded-full mr-2', option.dotClass)} />
                      <span className="flex-1 text-sm">{option.label}</span>
                      {option.value === log.status && <Check className="h-3.5 w-3.5 text-neutral-700" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[14px] text-neutral-900">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    STATUS_OPTIONS.find((s) => s.value === log.status)?.dotClass || 'bg-emerald-500',
                  )}
                />
                <span className="capitalize">{log.status}</span>
              </span>
            )}
          </DetailRow>

          <DetailRow label="Source">
            {onQuickEdit && isEditable && availableSources.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-[14px] text-neutral-700 hover:text-neutral-900 transition-colors"
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <BrailleSpinner className="text-sm text-neutral-500" />
                    ) : (
                      <>
                        <span>{formatSourceLabel(log.integration_source || 'manual', log.habit_name)}</span>
                        <ChevronDown className="h-3 w-3 text-neutral-400" />
                      </>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[190px]">
                  {availableSources.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => {
                        if (option !== (log.integration_source || 'manual')) {
                          onQuickEdit(log, { integration_source: option });
                        }
                      }}
                    >
                      <span className="flex-1 capitalize text-sm">{option}</span>
                      {option === (log.integration_source || 'manual') && (
                        <Check className="h-3.5 w-3.5 text-neutral-700" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="text-[14px] text-neutral-700">
                {formatSourceLabel(log.integration_source || 'manual', log.habit_name)}
              </span>
            )}
          </DetailRow>

          {log.notes && log.notes !== 'none' && (
            <DetailRow label="Notes">
              <div className="flex items-start justify-end gap-2">
                <p className="text-[14px] text-neutral-700 text-right whitespace-pre-wrap break-words max-w-[240px]">
                  {log.notes}
                </p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(log.notes || '', 'notes')}
                  className="mt-0.5 shrink-0 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  {copiedField === 'notes' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </DetailRow>
          )}

          {log.id && (
            <DetailRow label="Log ID">
              <div className="flex items-center justify-end gap-2">
                <span className="text-[12px] text-neutral-400 font-mono truncate max-w-[180px]">
                  {log.id}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(log.id, 'id')}
                  className="shrink-0 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  {copiedField === 'id' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </DetailRow>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default LogDetailPanel;
