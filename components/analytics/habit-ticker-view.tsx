/**
 * Perplexity Finance-style Habit Ticker View
 * Using Tremor for production-quality sparklines
 */

'use client';

import React from 'react';
import { Card } from '@tremor/react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, X } from 'lucide-react';

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
}) => {
  const isPositive = percentChange >= 0;
  
  // Custom colors - darker emerald green and red
  const emeraldGreen = '#059669'; // Darker emerald green for positive (Tailwind emerald-600)
  const darkRed = '#822503';      // Darker red for negative
  const chartColor = isPositive ? emeraldGreen : darkRed;
  
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <div
      className="group relative cursor-pointer transition-all duration-200 hover:bg-[#F3F3F3] hover:shadow-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 p-4"
    >
      {/* Close Button - Subtle, appears on hover */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // Prevent card click
            onRemove();
          }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Remove habit"
        >
          <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-2" onClick={onClick}>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
            {habitName}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-0.5">
            {category || unit}
          </p>
        </div>
        
        {/* % Badge - Square corners */}
        <div 
          className="flex items-center gap-1 px-2 py-0.5"
          style={{ 
            backgroundColor: isPositive 
              ? 'rgba(5, 150, 105, 0.1)'  // #059669 at 10% opacity (darker green)
              : 'rgba(130, 37, 3, 0.1)'    // #822503 at 10% opacity
          }}
        >
          <TrendIcon 
            className="w-3 h-3" 
            style={{ color: chartColor }}
          />
          <span 
            className="text-xs font-semibold tabular-nums"
            style={{ color: chartColor }}
          >
            {Math.abs(percentChange).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Current Value */}
      <div className="mb-2" onClick={onClick}>
        <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
          {currentValue < 10 
            ? currentValue.toFixed(1) 
            : Math.round(currentValue).toLocaleString()}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {unit} (7-day avg)
        </p>
      </div>

      {/* Sparkline - ULTRA SUBTLE GRADIENT like Perplexity */}
      <div className="h-14 mb-2 -mx-2" onClick={onClick}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart 
              data={chartData} 
              margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
            >
              <defs>
                {/* Darker, more noticeable gradient */}
                <linearGradient 
                  id={`gradient-${habitName.replace(/\s/g, '')}`} 
                  x1="0" 
                  y1="0" 
                  x2="0" 
                  y2="1"
                >
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.25}/>
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={1.5}
                fill={`url(#gradient-${habitName.replace(/\s/g, '')})`}
                isAnimationActive={false}
                dot={false}
                connectNulls
                fillOpacity={1}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-gray-400">No data</span>
          </div>
        )}
      </div>

      {/* Bottom: Change vs Previous */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800" onClick={onClick}>
        <span 
          className="text-sm font-semibold tabular-nums"
          style={{ color: chartColor }}
        >
          {isPositive ? '+' : ''}{absoluteChange.toFixed(1)} {unit}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          vs prev week
        </span>
      </div>
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
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {habits.map((habit) => {
        const currentValue = habit.last_7_days_avg || 0;
        const previousValue = habit.prev_7_days_avg || 0;
        const percentChange = habit.weekly_amount_change_pct || 0;
        const absoluteChange = currentValue - previousValue;

        return (
          <HabitTickerCard
            key={habit.habit_id}
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
          />
        );
      })}
    </div>
  );
};

// View Toggle - Matching Select Button Style
interface ViewToggleProps {
  currentView: 'chart' | 'ticker';
  onViewChange: (view: 'chart' | 'ticker') => void;
  darkMode?: boolean;
}

export const AnalyticsViewToggle: React.FC<ViewToggleProps> = ({
  currentView,
  onViewChange,
  darkMode = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  
  const viewOptions = [
    { value: 'chart' as const, label: 'Bar' },
    { value: 'ticker' as const, label: 'Spark' }
  ];
  
  const currentOption = viewOptions.find(opt => opt.value === currentView);
  
  return (
    <div className="relative">
      <button
        id="view-toggle-dropdown-button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full md:w-auto min-w-[140px] flex items-center justify-between gap-3 px-4 py-2.5 bg-white border border-gray-300 text-sm text-gray-700 hover:bg-[#F3F3F3] transition-colors"
      >
        <span className="text-sm">{currentOption?.label || 'Select View'}</span>
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
            className="fixed bg-white border border-gray-300 shadow-xl" 
            style={{ 
              zIndex: 1000,
              top: typeof window !== 'undefined' 
                ? (document.getElementById('view-toggle-dropdown-button')?.getBoundingClientRect().bottom || 0) + 4 + window.scrollY
                : 0,
              left: typeof window !== 'undefined'
                ? document.getElementById('view-toggle-dropdown-button')?.getBoundingClientRect().left || 0
                : 0,
              width: typeof window !== 'undefined'
                ? document.getElementById('view-toggle-dropdown-button')?.offsetWidth || 140
                : 140
            }}
          >
            <div className="p-1">
              {viewOptions.map((option) => {
                return (
                  <button
                    key={option.value}
                    onClick={() => {
                      onViewChange(option.value);
                      setIsOpen(false);
                    }}
                    className={`
                      w-full flex items-center px-3 py-2 text-left hover:bg-[#F3F3F3] cursor-pointer transition-colors
                      ${currentView === option.value ? 'bg-[#F3F3F3]' : ''}
                    `}
                  >
                    <span className="text-sm text-gray-900">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
