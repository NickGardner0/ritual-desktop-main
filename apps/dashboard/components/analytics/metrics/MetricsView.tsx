/**
 * MetricsView - Analytics/Metrics content for unified Analytics page
 */

'use client';

import React from 'react';
import { MetricsInitialSection } from '@/components/analytics/metrics-initial-section';
import { MetricsExpandedSection } from '@/components/analytics/metrics-expanded-section';
import { MetricsShareModal } from '@/components/analytics/metrics-share-modal';
import { DateRangePicker } from '../metrics-view.shared';
import { MetricsCategoryTabs } from './MetricsCategoryTabs';
import {
  MetricsEmptyState,
  MetricsGridLoadingSkeleton,
  MetricsInitialLoadingSkeleton,
} from './MetricsLoadingStates';
import { useMetricsView } from './useMetricsView';
import type { MetricsViewProps } from '../metrics-view.shared';

export function MetricsView(props: MetricsViewProps) {
  const view = useMetricsView(props);

  if (view.shouldShowInitialLoading) {
    return <MetricsInitialLoadingSkeleton />;
  }

  return (
    <>
      {!view.hideControls && (
        <div className="mx-auto w-full max-w-[920px] flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <DateRangePicker
              className="w-auto"
              onDateRangeChange={view.setDateRange}
              initialDateRange={view.dateRange}
            />
          </div>
        </div>
      )}

      {view.analyticsError && (
        <div className="mx-auto mb-4 w-full max-w-[920px] rounded-lg border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
          <span className="font-medium">Unable to load metrics</span>
          <span className="mx-1.5 text-amber-300">·</span>
          {view.analyticsError}
        </div>
      )}

      <MetricsCategoryTabs
        activeCategoryTab={view.activeCategoryTab}
        onTabChange={(tabId) => {
          view.setActiveCategoryTab(tabId);
          view.setCardPage(0);
        }}
      />

      {view.loading || view.queryLoading ? (
        <MetricsGridLoadingSkeleton />
      ) : !view.hasRenderableMetricCards ? (
        <MetricsEmptyState />
      ) : view.selectedHabits.length > 0 || view.availableHabits.length > 0 || Boolean(view.computerActivityCard) ? (
        <>
          <MetricsInitialSection
            cardGrid={view.metricCardsContent}
            showInsights={!view.expandedHabit}
            showBarLists={!view.expandedHabit && view.filteredHabits.length > 0}
            habitBarItems={view.habitBarItems}
            streakBarItems={view.streakBarItems}
            barListRange={view.barListRange}
            onBarListRangeChange={view.setBarListRange}
            habitSparkSources={view.habitSparkSources}
            miniChartDefaultRange={view.miniChartDefaultRange}
            onRemoveHabitSpark={view.unpinHabit}
            miniChartEmptyHint={
              view.pinnedHabitIds.length === 0
                ? 'Pin a habit card above to feature it here.'
                : undefined
            }
          />

          <MetricsExpandedSection
            availableHabits={view.availableHabits}
            captureExpandedChart={view.captureExpandedChart}
            chartRef={view.chartRef}
            compareHabitId={view.compareHabitId}
            comparisonLogs={view.comparisonLogs}
            correlationData={view.correlationData}
            dateRange={view.dateRange}
            expandedHabit={view.expandedHabit}
            expandedHabitData={view.expandedHabitData}
            expandedHabitUsesGranularHeartRate={view.expandedHabitUsesGranularHeartRate}
            expandedLogs={view.expandedLogs}
            expandedTimeRange={view.expandedTimeRange}
            exportCardRef={view.exportCardRef}
            filteredHabits={view.filteredHabits}
            getHabitCardData={view.getHabitCardData}
            hasCustomDateRange={view.hasCustomDateRange}
            heartRateExpandedSeries={view.heartRateExpandedSeries}
            heartRateExpandedSummary={view.heartRateExpandedSummary}
            isCapturing={view.isCapturing}
            loadingCorrelation={view.loadingCorrelation}
            loadingExpandedLogs={view.loadingExpandedLogs}
            setCompareHabitId={view.setCompareHabitId}
            setExpandedHabit={view.setExpandedHabit}
            setExpandedTimeRange={view.setExpandedTimeRange}
          />
        </>
      ) : null}

      {view.showShareModal ? (
        <MetricsShareModal
          closeShareModal={view.closeShareModal}
          copyShareImage={view.copyShareImage}
          copyState={view.copyState}
          downloadShareImage={view.downloadShareImage}
          downloadState={view.downloadState}
          isCapturing={view.isCapturing}
          shareImageUrl={view.shareImageUrl}
          shareLabel={view.shareLabel}
        />
      ) : null}
    </>
  );
}

export type { MetricsViewProps } from '../metrics-view.shared';
