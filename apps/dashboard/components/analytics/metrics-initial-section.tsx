'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { InsightCardsGrid } from '@/components/analytics/insight-cards';
import { VercelBarListCard } from '@/components/analytics/vercel-bar-list';
import { ComputerTimeBarList } from '@/components/analytics/computer-time-bar-list';
import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';
import type { TimeRangePreset } from '@/lib/computerActivity/contracts';

const ComputerTimeDetailSection = dynamic(
  () => import('@/components/analytics/computer-time-detail-section').then((m) => ({ default: m.ComputerTimeDetailSection })),
  { ssr: false },
);

interface MetricsInitialSectionProps {
  cardGrid: React.ReactNode;
  showInsights?: boolean;
  showBarLists?: boolean;
  habitBarItems: BarListItem[];
  streakBarItems: BarListItem[];
  barListRange: BarListRange;
  onBarListRangeChange: (range: BarListRange) => void;
  computerTimeRangePreset: TimeRangePreset;
}

export function MetricsInitialSection({
  cardGrid,
  showInsights = true,
  showBarLists = true,
  habitBarItems,
  streakBarItems,
  barListRange,
  onBarListRangeChange,
  computerTimeRangePreset,
}: MetricsInitialSectionProps) {
  const shouldShowTopRail = showInsights || habitBarItems.length > 0;

  return (
    <>
      {cardGrid}

      {shouldShowTopRail ? (
        <div className="mx-auto mt-6 w-full max-w-[960px]">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div className="min-w-0">
              {showInsights ? <InsightCardsGrid compact /> : null}
            </div>
            {showBarLists && habitBarItems.length > 0 ? (
              <div className="min-w-0 lg:max-w-[280px]">
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
                  visibleRows={8}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showBarLists ? (
        <div className="mx-auto mt-5 w-full max-w-[960px]">
          <div className="grid grid-cols-1 gap-[6px]">
            <ComputerTimeBarList activeRange={barListRange} onRangeChange={onBarListRangeChange} />
          </div>
          <ComputerTimeDetailSection externalRange={computerTimeRangePreset} />
        </div>
      ) : null}
    </>
  );
}

export default MetricsInitialSection;
