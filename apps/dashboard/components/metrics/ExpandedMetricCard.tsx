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
  /** true = higher is better, false = lower is better. Flips green/red for delta color. */
  higherIsBetter?: boolean | null;
  dateRangeText?: string;
  rangePreset?: string;
  onRangePresetChange?: (value: string) => void;
  rangeOptions?: RangeOption[];
  rangeLockedText?: string;
  compareControl?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  stats?: ExpandedMetricStat[];
  showStats?: boolean;
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

function normalizePercentLabel(value: React.ReactNode): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${Math.abs(value).toFixed(2)}%`;
  }

  if (typeof value === 'string') {
    return value.trim().replace(/^[+-]/, '');
  }

  return String(value);
}

export function ExpandedMetricCard({
  title,
  primaryValue,
  unit,
  deltaValue,
  deltaPercent,
  deltaDirection,
  higherIsBetter,
  dateRangeText,
  rangePreset,
  onRangePresetChange,
  rangeOptions = [],
  rangeLockedText,
  compareControl,
  actions,
  children,
  stats = [],
  showStats = false,
  onClose,
  closeLabel = 'Close expanded chart',
  className,
}: ExpandedMetricCardProps) {
  const resolvedDirection = resolveDeltaDirection(deltaDirection, deltaPercent);
  const arrow = resolvedDirection === 'up' ? '↗' : (resolvedDirection === 'down' ? '↘' : '');
  const percentLabel = normalizePercentLabel(deltaPercent);

  // When higherIsBetter is false, flip the color: up=red, down=green
  const colorDirection: DeltaDirection = resolvedDirection === 'neutral'
    ? 'neutral'
    : higherIsBetter === false
      ? (resolvedDirection === 'up' ? 'down' : 'up')
      : resolvedDirection;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-sm border border-[rgba(39,37,30,0.07)] bg-white',
        className
      )}
    >
      {/* Header — habit name top, value+unit below, matching spark card layout */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3
                data-export-title
                className="text-[14px] font-medium tracking-[-0.3px] text-[#27251E]"
              >
                {title}
              </h3>
              {(deltaValue !== undefined || percentLabel) ? (
                <span
                  className={cn(
                    'text-[13px] tracking-[-0.2px] tabular-nums',
                    colorDirection === 'up' && 'text-[#136A22]',
                    colorDirection === 'down' && 'text-[#A23544]',
                    colorDirection === 'neutral' && 'text-[rgba(39,37,30,0.4)]'
                  )}
                >
                  {arrow ? `${arrow} ` : ''}
                  {percentLabel || ''}
                </span>
              ) : null}
            </div>

            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-[20px] font-semibold leading-none tracking-[-0.5px] tabular-nums text-[#27251E]">
                {primaryValue}
              </span>
              {unit ? (
                <span className="text-[13px] leading-none tracking-[-0.2px] text-[rgba(39,37,30,0.4)]">
                  {unit}
                </span>
              ) : null}
            </div>

            {dateRangeText ? (
              <p className="mt-1 text-[11px] tracking-[-0.1px] text-[rgba(39,37,30,0.4)]">
                {dateRangeText}
              </p>
            ) : null}
          </div>

          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              data-export-close
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-[rgba(39,37,30,0.3)] transition-colors hover:text-[#27251E] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
        <div className="min-w-0 overflow-hidden">
          {rangeLockedText ? (
            <div className="inline-flex h-[28px] items-center rounded-sm border border-[rgba(39,37,30,0.08)] bg-white px-3 text-[11px] font-medium tracking-[-0.2px] text-[rgba(39,37,30,0.5)]">
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

        <div className="ml-auto flex items-center gap-1.5">
          {compareControl ? <div className="shrink-0">{compareControl}</div> : null}
          {actions ? <div className="inline-flex items-center gap-1.5">{actions}</div> : null}
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 pb-2">{children}</div>

      {/* Stats table — Perplexity Finance style */}
      {showStats && stats.length > 0 ? (() => {
        // Arrange stats into rows of 3 columns
        const cols = 3;
        const rows: ExpandedMetricStat[][] = [];
        for (let i = 0; i < stats.length; i += cols) {
          rows.push(stats.slice(i, i + cols));
        }
        return (
          <div className="border-t border-[rgba(39,37,30,0.07)]">
            {rows.map((row, rowIdx) => (
              <div
                key={rowIdx}
                className={cn(
                  'grid grid-cols-3',
                  rowIdx !== rows.length - 1 && 'border-b border-[rgba(39,37,30,0.07)]'
                )}
              >
                {row.map((stat, colIdx) => (
                  <div
                    key={`${stat.label}-${colIdx}`}
                    className={cn(
                      'flex items-center justify-between px-4 py-2',
                      colIdx !== row.length - 1 && 'border-r border-[rgba(39,37,30,0.07)]'
                    )}
                  >
                    <p className="text-[12px] text-[rgba(39,37,30,0.45)]">
                      {stat.label}
                    </p>
                    <p className="text-[12px] font-medium tabular-nums text-[#27251E]">
                      {stat.value}
                    </p>
                  </div>
                ))}
                {/* Fill empty cells in last row */}
                {row.length < cols && Array.from({ length: cols - row.length }).map((_, i) => (
                  <div key={`empty-${i}`} className="px-4 py-2" />
                ))}
              </div>
            ))}
          </div>
        );
      })() : null}
    </div>
  );
}

export default ExpandedMetricCard;
