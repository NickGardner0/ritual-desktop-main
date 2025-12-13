/**
 * Perplexity Finance-style Habit Ticker View
 * Clean, minimal spark cards for habit trend visualization
 */

'use client';

import React from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { X } from 'lucide-react';

// Custom tooltip with frosty macOS-native look
const SparkTooltip = ({ active, payload, unit }: any) => {
  if (active && payload && payload.length) {
    return (
      <div 
        className="px-2 py-1.5 text-xs border border-gray-300/60 shadow-lg"
        style={{
          background: 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'blur(12px) saturate(180%)',
          WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        }}
      >
        <span className="text-gray-900 font-medium tabular-nums">
          {payload[0].value?.toFixed(1)} {unit}
        </span>
      </div>
    );
  }
  return null;
};

interface HabitTickerCardProps {
  habitName: string;
  category?: string;
  unit: string;
  currentValue: number;
  previousValue: number;
  percentChange: number;
  absoluteChange: number;
  chartData: { value: number }[];
  onClick?: () => void;
  onRemove?: () => void;
  darkMode?: boolean;
  stabilityClass?: 'stable' | 'moderate' | 'variable';
  consistencyScore?: number;
}

export const HabitTickerCard: React.FC<HabitTickerCardProps> = ({
  habitName,
  category,
  unit,
  currentValue,
  previousValue,
  percentChange,
  absoluteChange,
  chartData,
  onClick,
  onRemove,
  darkMode = false,
  stabilityClass,
  consistencyScore,
}) => {
  const isPositive = percentChange >= 0;
  const isNeutral = Math.abs(percentChange) < 0.5; // Consider < 0.5% as neutral
  
  // Perplexity-style colors
  const tealGreen = '#0D9488';    // Teal for positive
  const warmRed = '#B91C1C';      // Warm red for negative
  const chartColor = isNeutral ? '#6B7280' : (isPositive ? tealGreen : warmRed);
  const bgColor = isNeutral 
    ? 'rgba(107, 114, 128, 0.08)' 
    : (isPositive ? 'rgba(13, 148, 136, 0.08)' : 'rgba(185, 28, 28, 0.08)');

  // Stability indicator styling
  const getStabilityIndicator = () => {
    if (!stabilityClass) return null;
    const indicators = {
      stable: { color: 'text-teal-600', bg: 'bg-teal-100', label: '●' },
      moderate: { color: 'text-amber-600', bg: 'bg-amber-100', label: '◐' },
      variable: { color: 'text-gray-500', bg: 'bg-gray-100', label: '○' },
    };
    return indicators[stabilityClass];
  };
  const stabilityIndicator = getStabilityIndicator();

  return (
    <div
      className="group relative cursor-pointer bg-[#FAFAF9] border border-gray-300 p-2.5 hover:bg-[#F5F5F4] transition-colors duration-150 overflow-hidden min-w-0"
      onClick={onClick}
    >
      {/* Close Button - Top right corner in padding area, appears on hover */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          aria-label="Remove habit"
        >
          <X className="w-3 h-3 text-gray-400 hover:text-gray-600" />
        </button>
      )}

      {/* Header Row: Name + Badge + Change */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1">
            <h3 className="font-medium text-[12px] text-gray-900 truncate leading-tight">
              {habitName}
            </h3>
            {stabilityIndicator && (
              <span 
                className={`text-[9px] ${stabilityIndicator.color}`} 
                title={`${stabilityClass} consistency${consistencyScore ? ` (${consistencyScore}%)` : ''}`}
              >
                {stabilityIndicator.label}
              </span>
            )}
          </div>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider truncate">
            {unit}
          </p>
        </div>
        
        {/* Right side: Badge + Absolute Change - flush to right edge */}
        <div className="flex flex-col items-end shrink-0">
          {/* % Badge - Perplexity style */}
          <div 
            className="flex items-center gap-0.5 px-1 py-0.5 rounded-sm whitespace-nowrap"
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
              {Math.abs(percentChange).toFixed(1)}%
            </span>
          </div>
          {/* Absolute change under percentage */}
          <span 
            className="text-[9px] font-medium tabular-nums mt-0.5"
            style={{ color: chartColor }}
          >
            {isPositive ? '+' : ''}{absoluteChange.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Sparkline */}
      <div className="h-[40px] my-1 overflow-hidden w-full min-w-0">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart 
              data={chartData} 
              margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
            >
              <defs>
                <linearGradient 
                  id={`gradient-${habitName.replace(/[^a-zA-Z0-9]/g, '')}`} 
                  x1="0" 
                  y1="0" 
                  x2="0" 
                  y2="1"
                >
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.15}/>
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Tooltip 
                content={<SparkTooltip unit={unit} />}
                cursor={{ stroke: chartColor, strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={1.5}
                fill={`url(#gradient-${habitName.replace(/[^a-zA-Z0-9]/g, '')})`}
                isAnimationActive={false}
                dot={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-[10px] text-gray-400">No data</span>
          </div>
        )}
      </div>

      {/* Bottom: Current Value */}
      <p className="text-base font-semibold text-gray-900 tabular-nums leading-tight">
        {currentValue < 10 
          ? currentValue.toFixed(2) 
          : currentValue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
      </p>
    </div>
  );
};

interface HabitTickerGridProps {
  habits: Array<{
    habit_id: string;
    habit_name: string;
    category?: string;
    unit: string;
    last_7_days_avg: number;
    prev_7_days_avg: number;
    weekly_amount_change_pct: number;
    chartData: { value: number }[];
    stability_class?: 'stable' | 'moderate' | 'variable';
    consistency_score?: number;
  }>;
  onHabitClick?: (habitId: string) => void;
  onHabitRemove?: (habitId: string) => void;
  darkMode?: boolean;
}

export const HabitTickerGrid: React.FC<HabitTickerGridProps> = ({
  habits,
  onHabitClick,
  onHabitRemove,
  darkMode = false,
}) => {
  // Filter out any invalid habits (missing habit_id)
  const validHabits = habits.filter(habit => habit && habit.habit_id);
  
  if (validHabits.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-sm">No habit data to display</p>
      </div>
    );
  }

  return (
    <div 
      className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
    >
      {validHabits.map((habit, index) => {
        const currentValue = habit.last_7_days_avg || 0;
        const previousValue = habit.prev_7_days_avg || 0;
        const percentChange = habit.weekly_amount_change_pct || 0;
        const absoluteChange = currentValue - previousValue;

        return (
          <div key={habit.habit_id || `habit-${index}`} className="min-w-0">
            <HabitTickerCard
              habitName={habit.habit_name}
              category={habit.category}
              unit={habit.unit || 'count'}
              currentValue={currentValue}
              previousValue={previousValue}
              percentChange={percentChange}
              absoluteChange={absoluteChange}
              chartData={habit.chartData || []}
              onClick={() => onHabitClick?.(habit.habit_id)}
              onRemove={onHabitRemove ? () => onHabitRemove(habit.habit_id) : undefined}
              darkMode={darkMode}
              stabilityClass={habit.stability_class}
              consistencyScore={habit.consistency_score}
            />
          </div>
        );
      })}
    </div>
  );
};

// View Toggle - Dropdown style matching habits filter
interface ViewToggleProps {
  currentView: 'chart' | 'ticker';
  onViewChange: (view: 'chart' | 'ticker') => void;
  darkMode?: boolean;
}

export const AnalyticsViewToggle: React.FC<ViewToggleProps> = ({
  currentView,
  onViewChange,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  
  const viewOptions = [
    { value: 'ticker' as const, label: 'Spark' },
    { value: 'chart' as const, label: 'Bar' }
  ];
  
  const currentOption = viewOptions.find(opt => opt.value === currentView);
  
  return (
    <div className="relative">
      <button
        id="view-toggle-dropdown-button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-gray-300 text-sm text-gray-700 hover:bg-[#F3F3F3] transition-colors min-w-[100px]"
      >
        <span className="text-sm">{currentOption?.label || 'View'}</span>
        <svg 
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isOpen && (
        <>
          <div 
            className="fixed inset-0" 
            style={{ zIndex: 999 }}
            onClick={() => setIsOpen(false)}
          />
          <div 
            className="absolute left-0 top-full mt-1 bg-white border border-gray-300 shadow-lg z-[1000] min-w-[120px]"
          >
            <div className="p-1">
              {viewOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F3F3F3] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={currentView === option.value}
                    onChange={() => {
                      onViewChange(option.value);
                      setIsOpen(false);
                    }}
                    className="analytics-checkbox"
                  />
                  <span className="text-sm text-gray-900">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
