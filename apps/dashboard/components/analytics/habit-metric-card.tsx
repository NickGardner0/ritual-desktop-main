'use client';

import React, { Suspense } from 'react';
import { X } from 'lucide-react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import {
  BarChart,
  Bar,
  ResponsiveContainer,
} from 'recharts';

export interface HabitMetricCardProps {
  habitName: string;
  currentValue: number;
  unit: string;
  change?: number;
  absoluteChange?: number;
  chartData: any[];
  isPositive: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

export const HabitMetricCard: React.FC<HabitMetricCardProps> = ({
  habitName,
  currentValue,
  unit,
  change,
  absoluteChange,
  chartData,
  isPositive,
  onClick,
  onRemove,
}) => {
  const tealGreen = '#1A7F37';
  const negativeColor = '#8a1a25';
  const isNeutral = change === undefined || Math.abs(change) < 0.5;
  const chartColor = isNeutral ? '#6B7280' : (isPositive ? tealGreen : negativeColor);
  const bgColor = isNeutral
    ? 'rgba(107, 114, 128, 0.08)'
    : (isPositive ? 'rgba(26, 127, 55, 0.12)' : 'rgba(138, 26, 37, 0.08)');

  return (
    <div
      className="group relative bg-white border border-gray-200 p-2.5 hover:bg-gray-50 transition-colors duration-150 cursor-pointer overflow-hidden min-w-0"
      onClick={onClick}
    >
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20 rounded-sm bg-white/80 p-0.5 hover:bg-white"
          aria-label="Remove habit"
        >
          <X className="w-2.5 h-2.5 text-gray-400 hover:text-gray-600" />
        </button>
      )}

      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex-1 min-w-0 overflow-hidden">
          <h3 className="font-medium text-[12px] text-gray-900 truncate leading-tight">
            {habitName}
          </h3>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider truncate">
            {unit}
          </p>
        </div>

        <div className="flex flex-col items-end shrink-0">
          <div
            className="flex items-center gap-0.5 px-1 py-0.5 whitespace-nowrap"
            style={{ backgroundColor: bgColor }}
          >
            {!isNeutral && (
              isPositive
                ? <span className="text-[9px]" style={{ color: chartColor }}>↗</span>
                : <span className="text-[9px]" style={{ color: chartColor }}>↘</span>
            )}
            <span
              className="text-[9px] font-medium tabular-nums"
              style={{ color: chartColor }}
            >
              {Math.abs(change || 0).toFixed(1)}%
            </span>
          </div>
          {absoluteChange !== undefined && (
            <span
              className="text-[9px] font-medium tabular-nums mt-0.5"
              style={{ color: chartColor }}
            >
              {absoluteChange >= 0 ? '+' : ''}{absoluteChange.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      <div className="h-[46px] my-1 overflow-hidden w-full min-w-0">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[10px] text-gray-400">No data</p>
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <BrailleSpinner className="text-xs text-gray-600" />
            </div>
          }>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <Bar
                  dataKey="value"
                  fill="#4A4A4C"
                  radius={[1, 1, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default HabitMetricCard;
