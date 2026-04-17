'use client';

import React from 'react';
import { VercelBarListCard } from '@/components/analytics/vercel-bar-list';
import { ComputerTimeBarList } from '@/components/analytics/computer-time-bar-list';
import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';
import {
  HabitMiniChartsSection,
  type HabitSparkSource,
} from '@/components/analytics/habit-mini-charts-section';

interface MetricsInitialSectionProps {
  cardGrid: React.ReactNode;
  showInsights?: boolean;
  showBarLists?: boolean;
  habitBarItems: BarListItem[];
  streakBarItems: BarListItem[];
  barListRange: BarListRange;
  onBarListRangeChange: (range: BarListRange) => void;
  habitSparkSources?: HabitSparkSource[];
  miniChartEmptyHint?: string;
}

export function MetricsInitialSection({
  cardGrid,
  showInsights: _showInsights = true,
  showBarLists = true,
  habitBarItems,
  streakBarItems,
  barListRange,
  onBarListRangeChange,
  habitSparkSources = [],
  miniChartEmptyHint,
}: MetricsInitialSectionProps) {
  return (
    <>
      {cardGrid}

      {showBarLists && habitBarItems.length > 0 ? (
        <div className="mx-auto mt-6 w-full max-w-[920px]">
          <div className="grid grid-cols-1 gap-[6px] lg:grid-cols-2">
            <VercelBarListCard
              tabs={[
                { id: 'habits', label: 'Habits' },
                { id: 'streaks', label: 'Streaks' },
              ]}
              defaultTab="habits"
              data={{
                habits: habitBarItems,
                streaks: streakBarItems,
              }}
              showRangeSelector
              activeRange={barListRange}
              onRangeChange={onBarListRangeChange}
            />
            <ComputerTimeBarList activeRange={barListRange} onRangeChange={onBarListRangeChange} />
          </div>
        </div>
      ) : null}

      {showBarLists ? (
        <div className="mx-auto mt-5 w-full max-w-[920px]">
          <HabitMiniChartsSection
            sources={habitSparkSources}
            emptyHint={miniChartEmptyHint}
          />
        </div>
      ) : null}
    </>
  );
}

export default MetricsInitialSection;
