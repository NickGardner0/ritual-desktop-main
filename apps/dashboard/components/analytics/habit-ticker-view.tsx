/**
 * Perplexity Finance-style Habit Ticker View
 * Clean, minimal spark cards for habit trend visualization
 */

'use client';

import React from 'react';
import { HabitMetricCard } from './habit-metric-card';

interface HabitTickerCardProps {
  habitName: string;
  category?: string;
  unit: string;
  percentChange?: number;
  absoluteChange: number;
  chartData: { value: number }[];
  currentValue: number;
  higherIsBetter?: boolean | null;
  onClick?: () => void;
  onRemove?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  darkMode?: boolean;
}

export const HabitTickerCard: React.FC<HabitTickerCardProps> = ({
  habitName,
  unit,
  percentChange,
  absoluteChange,
  chartData,
  currentValue,
  higherIsBetter,
  onClick,
  onRemove,
  isPinned,
  onTogglePin,
}) => {
  return (
    <HabitMetricCard
      habitName={habitName}
      currentValue={currentValue}
      unit={unit}
      change={percentChange}
      absoluteChange={absoluteChange}
      chartData={chartData}
      isPositive={(percentChange ?? 0) >= 0}
      higherIsBetter={higherIsBetter}
      onClick={onClick}
      onRemove={onRemove}
      isPinned={isPinned}
      onTogglePin={onTogglePin}
    />
  );
};

interface HabitTickerGridProps {
  habits: Array<{
    habit_id: string;
    habit_name: string;
    category?: string;
    unit: string;
    display_value?: number;
    absolute_change?: number;
    last_7_days_avg: number;
    prev_7_days_avg: number;
    weekly_amount_change_pct: number;
    chartData: { value: number }[];
    higherIsBetter?: boolean | null;
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
      className="mx-auto grid w-full max-w-[888px] grid-cols-1 gap-[5px] sm:grid-cols-2 lg:grid-cols-4"
    >
      {validHabits.map((habit, index) => {
        const currentValue = Number.isFinite(habit.display_value)
          ? Number(habit.display_value)
          : (habit.last_7_days_avg || 0);
        const previousValue = habit.prev_7_days_avg || 0;
        const percentChange = habit.weekly_amount_change_pct || 0;
        const absoluteChange = Number.isFinite(habit.absolute_change)
          ? Number(habit.absolute_change)
          : (currentValue - previousValue);

        return (
          <div key={habit.habit_id || `habit-${index}`} className="min-w-0">
            <HabitTickerCard
              habitName={habit.habit_name}
              category={habit.category}
              unit={habit.unit || 'count'}
              percentChange={percentChange}
              absoluteChange={absoluteChange}
              chartData={habit.chartData || []}
              currentValue={currentValue}
              higherIsBetter={habit.higherIsBetter}
              onClick={() => onHabitClick?.(habit.habit_id)}
              onRemove={onHabitRemove ? () => onHabitRemove(habit.habit_id) : undefined}
              darkMode={darkMode}
            />
          </div>
        );
      })}
    </div>
  );
};

export default HabitTickerGrid;
