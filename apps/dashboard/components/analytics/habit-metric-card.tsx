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
    <svg width="16.8" height="16.8" viewBox="0 0 16.8 16.8" fill="none" aria-hidden="true">
      <path
        d="M3.2 12.2L12 3.4M12 3.4H6.2M12 3.4V9.2"
        stroke="currentColor"
        strokeWidth="1.225"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownArrowIcon() {
  return (
    <svg width="16.8" height="16.8" viewBox="0 0 16.8 16.8" fill="none" aria-hidden="true">
      <path
        d="M3.2 4.6L12 13.4M12 13.4H6.2M12 13.4V7.6"
        stroke="currentColor"
        strokeWidth="1.225"
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
  chartType = 'spark',
  onClick,
  onRemove,
}) => {
  const numericChange = Number(change ?? 0);
  const isNeutral = change === undefined || !Number.isFinite(numericChange);
  const trend = isNeutral ? 'neutral' : (isPositive ? 'up' : 'down');
  const changeColorClass = isNeutral ? 'text-[rgba(39,37,30,0.65)]' : (isPositive ? 'text-[#136A22]' : 'text-[#A23544]');

  const formattedChange = formatPercentChange(numericChange);
  const numericAbsoluteChange = Number(absoluteChange ?? 0);
  const showAbsoluteChange = absoluteChange !== undefined && Number.isFinite(numericAbsoluteChange);
  const formattedPrimaryValue = formatPrimaryValue(currentValue, unit);
  const formattedAbsoluteChange = formatAbsoluteChange(numericAbsoluteChange);
  const sparkValues = chartData
    .map(point => Number(point?.value ?? 0))
    .filter(value => Number.isFinite(value));

  return (
    <div
      className="group relative flex h-[120px] min-w-0 cursor-pointer flex-col gap-1 overflow-hidden rounded-none border border-gray-200 bg-white px-0 py-[4px] transition-[background-color,box-shadow] duration-150 hover:bg-[rgba(39,37,30,0.02)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      onClick={onClick}
      style={{
        fontFamily: "'Inter', 'FK Grotesk Neue', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {onRemove ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="absolute right-1.5 top-1.5 z-20 rounded-sm bg-white/80 p-0.5 opacity-0 transition-opacity duration-200 hover:bg-white group-hover:opacity-100"
          aria-label="Remove habit"
        >
          <X className="h-2.5 w-2.5 text-gray-400 hover:text-gray-600" />
        </button>
      ) : null}

      <div className="w-full px-4 pb-2 pt-[2.12px]">
        <div className="flex h-[23.76px] items-center justify-between">
          <span className="truncate text-[14px] font-normal leading-[20px] tracking-[-0.2px] text-[#27251E]">
            {habitName}
          </span>
          <span className={`inline-flex items-center gap-[1px] text-[14px] font-medium leading-[20px] tracking-[-0.4px] ${changeColorClass}`}>
            {trend === 'up' ? <UpArrowIcon /> : null}
            {trend === 'down' ? <DownArrowIcon /> : null}
            {formattedChange}
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
      </div>

      <div className="w-full flex-1 pb-[6px] pt-[2px]">
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
            trend={trend}
            height={42}
          />
        )}
      </div>
    </div>
  );
};

export default HabitMetricCard;
