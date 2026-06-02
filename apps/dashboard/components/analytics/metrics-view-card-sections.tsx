'use client';

import { useEffect, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import { COMPUTER_HABIT_DISPLAY_NAME } from '@/lib/computer-time-habit';
import {
  buildMetricStreakData,
  buildMetricsBarData,
  formatMetricBarValue,
  getMetricCategoryForHabit,
  inferHigherIsBetter,
  type MetricDailyRow,
  type MetricHabitLike,
} from '@/components/analytics/metrics-derived';
import type { HabitSparkSource } from '@/components/analytics/habit-mini-charts-section';
import {
  CARDS_PER_PAGE,
  COMPUTER_ACTIVITY_CARD_ID,
  HabitTickerCard,
  SortableMetricCard,
  buildLocalMetricDailyRows,
  getRangeDates,
  type BarListItem,
  type ChartDataPoint,
  type HabitData,
} from './metrics-view.shared';

function hasPositiveComputerDailyRows(rows: MetricDailyRow[]): boolean {
  return rows.some((row) => Number(row.active_hours || row.value || row.daily_value || row.total_amount || 0) > 0);
}

function factRowsToComputerDailyRows(rows: MetricDailyRow[] | undefined): MetricDailyRow[] {
  const normalized: MetricDailyRow[] = [];
  for (const row of rows || []) {
    const day = String(row.day || row.date || '').slice(0, 10);
    if (!day) continue;
    const hours = Math.max(0, Number(row.active_hours ?? row.daily_value ?? row.value ?? row.total_amount ?? 0));
    normalized.push({
      ...row,
      day,
      active_hours: hours,
      active_ms: Math.round(hours * 60 * 60 * 1000),
      events_count: Number(row.events_count || row.completed_count || 0),
    });
  }
  return normalized;
}

function firstNonEmptyMetricRows(...candidates: Array<MetricDailyRow[] | undefined>): MetricDailyRow[] {
  for (const rows of candidates) {
    if (Array.isArray(rows) && rows.length > 0) return rows;
  }
  return [];
}

export function useMetricsCardSections(ctx: Record<string, any>) {
  const {
    activeCategoryTab,
    appliedCardOrder,
    barListRange,
    clampedCardPage,
    computerActivityCard,
    computerActivityDaily,
    detectedComputerHabitId,
    dndSensors,
    expandedHabit,
    filterContext,
    filteredHabitIds,
    filteredHabits,
    getHabitCardData,
    handleDragEnd,
    habitLogsByHabitId,
    mergedCardAnalyticsData,
    mergedBarListAnalyticsData,
    mergedBarListSummaryMetrics,
    pinnedHabitIds,
    selectedHabits,
    setExpandedHabit,
    setLocalSelectedHabits,
    togglePinnedHabit,
    visibleCardIdsRef,
  } = ctx;

  const barListDerivedData = useMemo(() => {
    const { from: rangeFrom, to: rangeTo } = getRangeDates(barListRange as RangeKey);
    const habitBarData = buildMetricsBarData({
      habits: filteredHabits,
      analyticsDataByHabit: mergedBarListAnalyticsData,
      summaryByHabit: mergedBarListSummaryMetrics,
      rangeFrom,
      rangeTo,
      computerActivityDaily,
    });
    const streakData = buildMetricStreakData(habitBarData, mergedBarListAnalyticsData);
    return {
      habitBarData,
      streakData,
    };
  }, [
    barListRange,
    computerActivityDaily,
    filteredHabits,
    mergedBarListAnalyticsData,
    mergedBarListSummaryMetrics,
  ]);

  const habitBarItems = useMemo<BarListItem[]>(() => {
    const { habitBarData } = barListDerivedData;
    if (!habitBarData.length) return [];
    const maxVal = Math.max(...habitBarData.map((habit) => Math.abs(habit.avg)), 1);
    return [...habitBarData]
      .sort((left, right) => right.avg - left.avg)
      .map((habit) => ({
        name: habit.name,
        value: formatMetricBarValue(habit.avg, habit.unit),
        change: habit.change,
        changeLabel: habit.changeLabel,
        higherIsBetter: habit.higherIsBetter ?? undefined,
        barPercent: Math.round((Math.abs(habit.avg) / maxVal) * 100),
      }));
  }, [barListDerivedData]);

  const habitSparkSources = useMemo<HabitSparkSource[]>(() => {
    if (pinnedHabitIds.length === 0) return [];
    const computerActivityHabit: MetricHabitLike = {
      habit_id: COMPUTER_ACTIVITY_CARD_ID,
      habit_name: COMPUTER_HABIT_DISPLAY_NAME,
      unit_type: 'Hours',
    };
    // Mini charts let the user scrub from 1D to MAX (5Y), but the bar-list
    // analytics fetch only covers the current bar-list range + a prior
    // window. To avoid truncating history on wider mini-chart ranges, build
    // daily rows straight from the local log store (which holds the user's
    // full history) for the wider window; fall back to the API data only if
    // local logs are missing.
    const today = format(new Date(), 'yyyy-MM-dd');
    const fiveYearsAgo = format(subDays(new Date(), 365 * 5), 'yyyy-MM-dd');

    const sources: HabitSparkSource[] = [];
    for (const habitId of pinnedHabitIds) {
      if (habitId === COMPUTER_ACTIVITY_CARD_ID) {
        const factBackedComputerDaily = detectedComputerHabitId
          ? factRowsToComputerDailyRows(firstNonEmptyMetricRows(
              mergedCardAnalyticsData[detectedComputerHabitId] as MetricDailyRow[] | undefined,
              mergedBarListAnalyticsData[detectedComputerHabitId] as MetricDailyRow[] | undefined,
            ))
          : [];
        const resolvedComputerDaily = hasPositiveComputerDailyRows(computerActivityDaily)
          ? computerActivityDaily
          : factBackedComputerDaily;
        sources.push({
          habitId,
          name: COMPUTER_HABIT_DISPLAY_NAME,
          unit: 'Hours',
          higherIsBetter: inferHigherIsBetter(computerActivityHabit.habit_name, 'Hours'),
          logs: [],
          computerActivityDaily: resolvedComputerDaily,
        });
        continue;
      }
      const habit = filteredHabits.find((candidate: HabitData) => candidate.habit_id === habitId);
      if (!habit) continue;
      const unit = habit.unit_type || mergedBarListSummaryMetrics[habitId]?.unit || 'count';
      const localLogs = habitLogsByHabitId.get(habitId) || [];
      const wideRangeDailyRows = buildLocalMetricDailyRows(habit, localLogs, fiveYearsAgo, today);
      const logs = wideRangeDailyRows.length > 0
        ? wideRangeDailyRows
        : firstNonEmptyMetricRows(
            mergedCardAnalyticsData[habitId] as MetricDailyRow[] | undefined,
            mergedBarListAnalyticsData[habitId] as MetricDailyRow[] | undefined,
          );
      sources.push({
        habitId,
        name: habit.habit_name,
        unit,
        higherIsBetter: inferHigherIsBetter(habit.habit_name, unit),
        logs,
      });
    }
    return sources;
  }, [
    computerActivityDaily,
    detectedComputerHabitId,
    filteredHabits,
    habitLogsByHabitId,
    mergedCardAnalyticsData,
    mergedBarListAnalyticsData,
    mergedBarListSummaryMetrics,
    pinnedHabitIds,
  ]);

  const streakBarItems = useMemo<BarListItem[]>(() => {
    const { streakData } = barListDerivedData;
    if (!streakData.length) return [];
    const maxStreak = Math.max(...streakData.map((streak) => streak.streak), 1);
    return streakData.map((streak) => ({
      name: streak.name,
      value: `${streak.streak}d`,
      barPercent: Math.round((streak.streak / maxStreak) * 100),
    }));
  }, [barListDerivedData]);
  const metricCardIds = useMemo(() => {
    const validSelectedHabits = selectedHabits.filter((id: string): id is string => !!id);
    const selectedFilteredHabitIds = validSelectedHabits.filter((id: string) => filteredHabitIds.includes(id));
    const isComputerSelected = detectedComputerHabitId
      ? validSelectedHabits.includes(detectedComputerHabitId)
      : true;
    const showComputerCard = Boolean(computerActivityCard) && isComputerSelected;

    const habitsToShow = validSelectedHabits.length > 0
      ? selectedFilteredHabitIds
      : filteredHabitIds;

    const unorderedIds = [...habitsToShow];
    if (showComputerCard) {
      unorderedIds.push(COMPUTER_ACTIVITY_CARD_ID);
    }

    const metricCardIds = appliedCardOrder.length > 0
      ? [
          ...appliedCardOrder.filter((id: string) => unorderedIds.includes(id)),
          ...unorderedIds.filter((id: string) => !appliedCardOrder.includes(id)),
        ]
      : unorderedIds;

    return metricCardIds;
  }, [
    appliedCardOrder,
    computerActivityCard,
    detectedComputerHabitId,
    filteredHabitIds,
    selectedHabits,
  ]);

  useEffect(() => {
    visibleCardIdsRef.current = metricCardIds;
  }, [metricCardIds, visibleCardIdsRef]);

  const metricCardsContent = useMemo(() => {
    const computerCardData = computerActivityCard;
    const visibleIds = activeCategoryTab
      ? metricCardIds.filter((id) => {
          if (id === COMPUTER_ACTIVITY_CARD_ID) {
            return activeCategoryTab === 'digital';
          }
          const habit = filteredHabits.find((candidate: HabitData) => candidate.habit_id === id);
          return habit ? getMetricCategoryForHabit(habit.habit_name, habit.category) === activeCategoryTab : false;
        })
      : metricCardIds;

    const totalPages = Math.ceil(visibleIds.length / CARDS_PER_PAGE);
    const safeCardPage = Math.min(clampedCardPage, Math.max(totalPages - 1, 0));
    const pageStart = safeCardPage * CARDS_PER_PAGE;
    const pageIds = visibleIds.slice(pageStart, pageStart + CARDS_PER_PAGE);

    return (
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={pageIds} strategy={rectSortingStrategy}>
          <div
            className={`mx-auto relative w-full max-w-[920px] transition-opacity duration-300 ${
              expandedHabit ? 'opacity-40 pointer-events-auto' : 'opacity-100'
            }`}
          >
            <div className="grid w-full grid-cols-2 gap-[6px] sm:grid-cols-3 lg:grid-cols-4">
              {pageIds.map((habitId: string) => {
                const cardData = habitId === COMPUTER_ACTIVITY_CARD_ID
                  ? computerCardData
                  : getHabitCardData(habitId);
                const habit = habitId === COMPUTER_ACTIVITY_CARD_ID
                  ? null
                  : filteredHabits.find((candidate: HabitData) => candidate.habit_id === habitId);

                let tickerName: string;
                let tickerUnit: string;
                let tickerCurrentValue: number;
                let tickerPercentChange: number | undefined;
                let tickerAbsoluteChange: number;
                let tickerChartData: { value: number }[];
                let tickerHigherIsBetter: boolean | null | undefined;

                if (habitId === COMPUTER_ACTIVITY_CARD_ID && computerCardData) {
                  tickerName = COMPUTER_HABIT_DISPLAY_NAME;
                  tickerUnit = computerCardData.unit || 'hours';
                  tickerCurrentValue = computerCardData.currentValue || 0;
                  tickerPercentChange = computerCardData.change;
                  tickerAbsoluteChange = computerCardData.absoluteChange || 0;
                  tickerChartData = (computerCardData.chartData || []).map((point: ChartDataPoint) => ({ value: point.value || 0 }));
                  tickerHigherIsBetter = computerCardData.higherIsBetter;
                } else if (cardData && habit) {
                  tickerName = cardData.habitName || habit.habit_name || 'Unknown';
                  tickerUnit = cardData.unit || habit.unit_type || 'count';
                  tickerCurrentValue = cardData.currentValue || 0;
                  tickerPercentChange = cardData.change;
                  tickerAbsoluteChange = cardData.absoluteChange || 0;
                  tickerChartData = (cardData.chartData || []).map((point: ChartDataPoint) => ({ value: point.value || 0 }));
                  tickerHigherIsBetter = cardData.higherIsBetter;
                } else if (habit) {
                  tickerName = habit.habit_name || 'Unknown';
                  tickerUnit = habit.unit_type || 'count';
                  tickerCurrentValue = 0;
                  tickerPercentChange = undefined;
                  tickerAbsoluteChange = 0;
                  tickerChartData = [];
                  tickerHigherIsBetter = inferHigherIsBetter(habit.habit_name, habit.unit_type);
                } else {
                  return null;
                }

                // Pin key matches how `buildMetricsBarData` keys the series
                // (computer activity uses the sentinel, not the detected habit id).
                const pinHabitId = habitId;
                return (
                  <SortableMetricCard key={habitId} id={habitId}>
                    <HabitTickerCard
                      habitName={tickerName}
                      unit={tickerUnit}
                      currentValue={tickerCurrentValue}
                      percentChange={tickerPercentChange}
                      absoluteChange={tickerAbsoluteChange}
                      chartData={tickerChartData}
                      higherIsBetter={tickerHigherIsBetter}
                      isPinned={pinnedHabitIds.includes(pinHabitId)}
                      onTogglePin={() => togglePinnedHabit(pinHabitId)}
                      onClick={() => {
                        if (habitId === COMPUTER_ACTIVITY_CARD_ID) return;
                        setExpandedHabit(expandedHabit === habitId ? null : habitId);
                      }}
                      onRemove={() => {
                        const removedHabitId = habitId === COMPUTER_ACTIVITY_CARD_ID
                          ? detectedComputerHabitId
                          : habitId;
                        if (!removedHabitId) return;
                        if (filterContext) {
                          filterContext.setSelectedHabits((prev: string[]) => prev.filter((id) => id !== removedHabitId));
                        } else {
                          setLocalSelectedHabits((prev: string[]) => prev.filter((id: string) => id !== removedHabitId));
                        }
                        if (expandedHabit === habitId) {
                          setExpandedHabit(null);
                        }
                      }}
                    />
                  </SortableMetricCard>
                );
              })}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    );
  }, [
    activeCategoryTab,
    clampedCardPage,
    computerActivityCard,
    detectedComputerHabitId,
    dndSensors,
    expandedHabit,
    filterContext,
    filteredHabitIds,
    filteredHabits,
    getHabitCardData,
    handleDragEnd,
    metricCardIds,
    pinnedHabitIds,
    setExpandedHabit,
    setLocalSelectedHabits,
    togglePinnedHabit,
  ]);

  return {
    habitBarItems,
    habitSparkSources,
    metricCardsContent,
    streakBarItems,
  };
}
