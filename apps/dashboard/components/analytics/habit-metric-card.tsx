'use client';

import React from 'react';
import { X } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer } from 'recharts';
import { PerplexityMiniSparkChart } from '@/components/charts/PerplexityMiniSparkChart';

export interface HabitMetricCardProps {
  habitName: string;
  currentValue: number;
  unit: string;
  change?: number;
  absoluteChange?: number;
  chartData: any[];
  isPositive: boolean;
  higherIsBetter?: boolean | null;
  chartType?: 'spark' | 'bar';
  onClick?: () => void;
  onRemove?: () => void;
}

function formatWithMaxDecimals(value: number, maxFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function formatTrimmedFixed(value: number, fractionDigits: number): string {
  return value
    .toFixed(fractionDigits)
    .replace(/(\.\d*?[1-9])0+$/u, '$1')
    .replace(/\.0+$/u, '');
}

function prefersWholeValue(unit: string): boolean {
  const normalized = unit.toLowerCase();
  return normalized.includes('count')
    || normalized.includes('step')
    || normalized.includes('page');
}

function formatPrimaryValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '--';

  if (prefersWholeValue(unit)) {
    return formatWithMaxDecimals(value, 0);
  }

  const absValue = Math.abs(value);
  if (absValue >= 1000) return formatWithMaxDecimals(value, 0);
  if (absValue >= 100) return formatWithMaxDecimals(value, 1);
  return formatWithMaxDecimals(value, 2);
}

function formatPercentChange(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  const absValue = Math.abs(value);
  return `${absValue.toFixed(absValue >= 10 ? 1 : 2)}%`;
}

function formatAbsoluteChange(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const absValue = Math.abs(value);
  const precision = absValue < 1 ? 2 : 1;
  return formatTrimmedFixed(value, precision);
}

function UpArrowIcon() {
  return (
    <svg width="15.2" height="15.2" viewBox="0 0 16.8 16.8" fill="none" aria-hidden="true">
      <path
        d="M3.2 12.2L12 3.4M12 3.4H6.2M12 3.4V9.2"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownArrowIcon() {
  return (
    <svg width="15.2" height="15.2" viewBox="0 0 16.8 16.8" fill="none" aria-hidden="true">
      <path
        d="M3.2 4.6L12 13.4M12 13.4H6.2M12 13.4V7.6"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const HabitMetricCard: React.FC<HabitMetricCardProps> = ({
  habitName,
  currentValue,
  unit,
  change,
  absoluteChange,
  chartData,
  isPositive,
  higherIsBetter,
  chartType = 'spark',
  onClick,
  onRemove,
}) => {
  const numericChange = Number(change ?? 0);
  const isNeutral = change === undefined || !Number.isFinite(numericChange);
  const trend = isNeutral ? 'neutral' : (isPositive ? 'up' : 'down');
  // Arrow direction always reflects raw change. Color reflects whether the change
  // is an improvement: if higherIsBetter is unknown, fall back to direction-only.
  const isImprovement = isNeutral
    ? false
    : (higherIsBetter == null ? isPositive : (higherIsBetter ? isPositive : !isPositive));
  const changeColorClass = isNeutral
    ? 'text-[rgba(39,37,30,0.65)]'
    : (isImprovement ? 'text-[#136A22]' : 'text-[#A23544]');
  const sparkTrend = trend;

  const formattedChange = isNeutral ? null : formatPercentChange(numericChange);
  const numericAbsoluteChange = Number(absoluteChange ?? 0);
  const showAbsoluteChange = absoluteChange !== undefined && Number.isFinite(numericAbsoluteChange);
  const formattedPrimaryValue = formatPrimaryValue(currentValue, unit);
  const formattedAbsoluteChange = formatAbsoluteChange(numericAbsoluteChange);
  const sparkValues = chartData
    .map(point => Number(point?.value ?? 0))
    .filter(value => Number.isFinite(value));
  const isSparkCard = chartType === 'spark';

  return (
    <div
      className={`group relative flex min-w-0 cursor-pointer flex-col gap-1 overflow-hidden border border-[rgba(39,37,30,0.08)] bg-white px-0 duration-200 ease-out hover:border-[rgba(39,37,30,0.13)] hover:bg-[rgba(39,37,30,0.015)] hover:shadow-[0_1px_6px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] ${
        isSparkCard ? 'h-[100px] rounded-sm py-[2px]' : 'h-[120px] rounded-sm py-[4px]'
      }`}
      onClick={onClick}
      style={{
        transition: 'border-color 200ms ease-out, background-color 200ms ease-out, box-shadow 200ms ease-out',
        fontFamily: "'Inter', 'FK Grotesk Neue', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {onRemove ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="absolute right-1.5 top-1.5 z-20 rounded-full bg-white p-0.5 opacity-0 shadow-sm transition-opacity duration-200 group-hover:opacity-100 hover:shadow-md"
          aria-label="Remove habit"
        >
          <X className="h-2.5 w-2.5 text-gray-400 hover:text-gray-600" />
        </button>
      ) : null}

      <div className={`w-full ${isSparkCard ? 'px-3 pb-[2px] pt-[2px]' : 'px-4 pb-2 pt-[2.12px]'}`}>
        {isSparkCard ? (
          <div className="grid grid-cols-[minmax(0,1fr)_78px] items-start gap-x-2">
            <div className="min-w-0">
              <div className="truncate text-[12.75px] font-medium leading-[17px] tracking-[-0.24px] text-[#27251E]">
                {habitName}
              </div>
              <div className="mt-[1px] flex min-w-0 items-baseline gap-1 text-[11px] font-medium leading-[14px] tracking-[-0.18px] text-[rgba(39,37,30,0.62)]">
                <span className="tabular-nums">{formattedPrimaryValue}</span>
                <span className="truncate">{unit}</span>
              </div>
            </div>

            <div className="flex min-w-[78px] flex-col items-end text-right">
              <span className={`inline-flex items-center justify-end gap-[1px] text-[12.5px] font-medium leading-[17px] tracking-[-0.16px] tabular-nums ${changeColorClass}`}>
                {trend === 'up' ? <UpArrowIcon /> : null}
                {trend === 'down' ? <DownArrowIcon /> : null}
                {formattedChange ?? '—'}
              </span>
              <span className="mt-[1px] min-h-[14px] text-[11px] font-medium leading-[14px] tracking-[-0.18px] text-[rgba(39,37,30,0.62)] tabular-nums">
                {showAbsoluteChange ? `${numericAbsoluteChange >= 0 ? '+' : ''}${formattedAbsoluteChange}` : ''}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-[23.76px] items-center justify-between">
              <span className="truncate text-[14px] font-normal leading-[20px] tracking-[-0.2px] text-[#27251E]">
                {habitName}
              </span>
              <span className={`inline-flex items-center gap-[1px] text-[14px] font-medium leading-[20px] tracking-[-0.4px] ${changeColorClass}`}>
                {trend === 'up' ? <UpArrowIcon /> : null}
                {trend === 'down' ? <DownArrowIcon /> : null}
                {formattedChange ?? '—'}
              </span>
            </div>

            <div className="flex h-[17px] items-center justify-between">
              <div className="flex min-w-0 items-baseline gap-1">
                <span className="text-[12px] font-medium leading-[16px] tracking-[-0.4px] tabular-nums text-[rgba(39,37,30,0.65)]">
                  {formattedPrimaryValue}
                </span>
                <span className="truncate text-[12px] font-medium leading-[16px] tracking-[-0.4px] text-[rgba(39,37,30,0.65)]">
                  {unit}
                </span>
              </div>

              {showAbsoluteChange ? (
                <span className="text-[12px] font-medium leading-[16px] tracking-[-0.4px] text-[rgba(39,37,30,0.65)] tabular-nums">
                  {numericAbsoluteChange >= 0 ? '+' : ''}
                  {formattedAbsoluteChange}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className={`w-full flex-1 ${isSparkCard ? 'pb-[2px] pt-0' : 'pb-[6px] pt-[2px]'}`}>
        {chartType === 'bar' ? (
          <div style={{ width: '100%', height: 42, overflow: 'hidden' }}>
            {chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-gray-400">No data</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 2, right: 8, left: 8, bottom: 2 }}>
                  <Bar
                    dataKey="value"
                    fill="#4A4A4C"
                    radius={[1, 1, 0, 0]}
                    isAnimationActive={false}
                    maxBarSize={12}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          <PerplexityMiniSparkChart
            values={sparkValues}
            trend={sparkTrend}
            height={30}
          />
        )}
      </div>
    </div>
  );
};

export default HabitMetricCard;
