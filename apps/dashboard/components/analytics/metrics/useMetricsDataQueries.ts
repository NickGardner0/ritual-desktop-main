'use client';

import { useEffect } from 'react';
import type { HabitData } from '../metrics-view.shared';
import {
  type MetricsDataEffectsContext,
} from './useMetricsDataQueries.helpers';
import { useMetricsCanonicalEffects } from './useMetricsCanonicalEffects';
import { useMetricsBarListAndPaintEffects } from './useMetricsBarListEffects';

export function useMetricsDataQueries(ctx: MetricsDataEffectsContext) {
  const {
    analyticsData,
    availableHabits,
    barListAnalyticsData,
    barListSummaryMetrics,
    selectedHabits,
    setSelectedHabits,
    summaryMetrics,
  } = ctx;

  useEffect(() => {
    if (availableHabits.length > 0 && selectedHabits.length === 0) {
      const allHabitIds = availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
      if (allHabitIds.length > 0) {
        setSelectedHabits(allHabitIds);
      }
    }
  }, [availableHabits, selectedHabits.length, setSelectedHabits]);

  useMetricsCanonicalEffects(ctx);
  useMetricsBarListAndPaintEffects(ctx);

  return {
    mergedBarListAnalyticsData: barListAnalyticsData,
    mergedBarListSummaryMetrics: barListSummaryMetrics,
    mergedCardAnalyticsData: analyticsData,
    mergedCardSummaryMetrics: summaryMetrics,
  };
}

/** @deprecated Use useMetricsDataQueries */
export const useMetricsDataEffects = useMetricsDataQueries;
