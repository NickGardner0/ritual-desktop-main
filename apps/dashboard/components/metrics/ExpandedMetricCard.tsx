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

  return (
    <div
      className={cn(
        'overflow-hidden border border-[rgba(39,37,30,0.07)] bg-white',
        className
      )}
    >
      {/* Header */}
      <div className="border-b border-[rgba(39,37,30,0.07)] px-4 pb-2 pt-[6px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3
              data-export-title
              className="break-words text-[16px] font-medium leading-none tracking-[-0.4px] text-[#27251E]"
            >
              {title}
            </h3>
            {unit ? (
              <span className="text-[12px] leading-none tracking-[-0.4px] text-[rgba(39,37,30,0.4)]">
                {unit}
              </span>
            ) : null}
          </div>

          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              data-export-close
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.5)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="mt-0.5 flex items-baseline gap-x-1.5">
          <span className="text-[16px] font-medium leading-[16px] tracking-[-0.4px] tabular-nums text-[#27251E]">
            {primaryValue}
          </span>

          {(deltaValue !== undefined || percentLabel) ? (
            <span
              className={cn(
                'text-[14.5px] leading-[16px] tracking-[-0.4px] tabular-nums',
                resolvedDirection === 'up' && 'text-[#136A22]',
                resolvedDirection === 'down' && 'text-[#A23544]',
                resolvedDirection === 'neutral' && 'text-[#6B7280]'
              )}
            >
              {deltaValue !== undefined ? <>{deltaValue}</> : null}
              {percentLabel ? (
                <>
                  {deltaValue !== undefined ? ' ' : ''}
                  {arrow ? `${arrow} ` : ''}
                  {percentLabel}
                </>
              ) : null}
            </span>
          ) : null}
        </div>

        {dateRangeText ? (
          <p className="mt-0.5 text-[12px] leading-[16px] tracking-[-0.4px] text-[rgba(39,37,30,0.65)]">{dateRangeText}</p>
        ) : null}
      </div>

      {/* Controls + Chart */}
      <div className="px-2 pb-2 pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="min-w-0 overflow-hidden">
            {rangeLockedText ? (
              <div className="inline-flex h-[31px] items-center border border-[rgba(39,37,30,0.07)] bg-white px-2.5 text-[12px] font-medium tracking-[-0.4px] text-[rgba(39,37,30,0.65)]">
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

        <div className="mt-1">{children}</div>
      </div>

      {/* Stats grid */}
      {showStats && stats.length > 0 ? (
        <div className="grid auto-cols-fr grid-flow-col border-t border-[rgba(39,37,30,0.07)] bg-[rgba(39,26,0,0.04)]">
          {stats.map((stat, index) => (
            <div
              key={`${stat.label}-${index}`}
              className={cn(
                'flex items-center justify-between bg-white px-2 py-2',
                index !== stats.length - 1 && 'border-r border-[rgba(39,37,30,0.07)]'
              )}
            >
              <p className="text-[14px] tracking-[-0.4px] text-[rgba(39,37,30,0.65)]">
                {stat.label}
              </p>
              <p className="text-[14px] font-medium tracking-[-0.4px] tabular-nums text-[#27251E]">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ExpandedMetricCard;
