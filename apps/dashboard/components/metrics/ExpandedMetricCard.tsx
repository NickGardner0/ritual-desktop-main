'use client';

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RangeOption, RangeSegmentedControl } from './RangeSegmentedControl';

type DeltaDirection = 'up' | 'down' | 'neutral';

interface ExpandedMetricStat {
  label: string;
  value: React.ReactNode;
}

interface ExpandedMetricCardProps {
  title: string;
  primaryValue: React.ReactNode;
  unit?: string;
  deltaValue?: React.ReactNode;
  deltaPercent?: React.ReactNode;
  deltaDirection?: DeltaDirection;
  dateRangeText?: string;
  rangePreset?: string;
  onRangePresetChange?: (value: string) => void;
  rangeOptions?: RangeOption[];
  rangeLockedText?: string;
  compareControl?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  stats: ExpandedMetricStat[];
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
}

function resolveDeltaDirection(
  direction: DeltaDirection | undefined,
  deltaPercent: React.ReactNode
): DeltaDirection {
  if (direction) return direction;

  const numeric = Number(deltaPercent);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.5) return 'neutral';
  return numeric >= 0 ? 'up' : 'down';
}

export function ExpandedMetricCard({
  title,
  primaryValue,
  unit,
  deltaValue,
  deltaPercent,
  deltaDirection,
  dateRangeText,
  rangePreset,
  onRangePresetChange,
  rangeOptions = [],
  rangeLockedText,
  compareControl,
  actions,
  children,
  stats,
  onClose,
  closeLabel = 'Close expanded chart',
  className,
}: ExpandedMetricCardProps) {
  const resolvedDirection = resolveDeltaDirection(deltaDirection, deltaPercent);

  return (
    <div
      className={cn(
        'overflow-hidden border border-gray-200 bg-white',
        className
      )}
    >
      <div className="px-3 pb-2.5 pt-2.5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-[clamp(1rem,1.28vw,1.2rem)] font-semibold tracking-[-0.01em] text-gray-900">
              {title}
            </h3>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-gray-300 bg-white text-gray-500 transition-colors hover:bg-[#F3F3F3] hover:text-gray-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-0.5">
          <span className="text-[clamp(1.5rem,1.7vw,1.75rem)] font-semibold leading-none tracking-[-0.02em] tabular-nums text-gray-900">
            {primaryValue}
          </span>
          {unit ? (
            <span className="text-[clamp(0.82rem,0.98vw,0.92rem)] font-medium text-gray-500">
              {unit}
            </span>
          ) : null}
          {(deltaValue !== undefined || deltaPercent !== undefined) && (
            <span
              className={cn(
                'text-[clamp(0.82rem,0.98vw,0.92rem)] font-semibold tabular-nums',
                resolvedDirection === 'up' && 'text-emerald-700 dark:text-emerald-400',
                resolvedDirection === 'down' && 'text-rose-700 dark:text-rose-400',
                resolvedDirection === 'neutral' && 'text-gray-500'
              )}
            >
              {deltaValue ?? '--'}
              {deltaPercent !== undefined ? ` (${deltaPercent})` : ''}
            </span>
          )}
        </div>

        {dateRangeText ? (
          <p className="mt-1 text-[12px] text-gray-500">{dateRangeText}</p>
        ) : null}

        <div className="mt-2 border-t border-gray-200 pt-2">
          <div className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0 overflow-hidden">
              {rangeLockedText ? (
                <div className="inline-flex h-8 items-center border border-gray-300 bg-white px-2.5 text-xs text-gray-600">
                  {rangeLockedText}
                </div>
              ) : (
                rangePreset && onRangePresetChange && rangeOptions.length > 0 && (
                  <RangeSegmentedControl
                    value={rangePreset}
                    onValueChange={onRangePresetChange}
                    options={rangeOptions}
                    className="w-full md:w-auto"
                  />
                )
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1 md:justify-end">
              {compareControl ? (
                <div className="shrink-0">{compareControl}</div>
              ) : null}
              {actions ? (
                <div className="inline-flex items-center gap-1">{actions}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 px-3 py-2">
        {children}
      </div>

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-0 border-t border-gray-200 md:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat, index) => (
            <div
              key={`${stat.label}-${index}`}
              className={cn(
                'px-2.5 py-2',
                index !== stats.length - 1 && 'border-r border-gray-200'
              )}
            >
              <p className="text-[9px] uppercase tracking-[0.1em] text-gray-500">
                {stat.label}
              </p>
              <p className="mt-0.5 text-[clamp(0.95rem,1.2vw,1.12rem)] font-semibold leading-none tabular-nums text-gray-900">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExpandedMetricCard;
