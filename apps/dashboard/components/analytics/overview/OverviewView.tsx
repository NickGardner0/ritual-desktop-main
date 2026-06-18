/**
 * OverviewView - Dashboard/Index content extracted for unified Analytics page
 */

'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Spinner } from '@/components/ui/kibo-ui/spinner';
import { OverviewInitialSection } from '@/components/analytics/overview-initial-section';
import { MetricContextPanel } from '@/components/analytics/metric-context-panel';
import { OverviewBackendUnavailable } from './OverviewBackendUnavailable';
import { OverviewDeleteModal } from './OverviewDeleteModal';
import { OverviewEmptyState } from './OverviewEmptyState';
import { useOverviewMetrics } from './useOverviewMetrics';
import type { OverviewViewProps } from './types';

const HabitSelectionModal = dynamic(
  () => import('@/components/habit-selection-modal').then((m) => ({ default: m.HabitSelectionModal })),
  { ssr: false },
);

const DataImportModal = dynamic(
  () => import('@/components/data-import-modal').then((m) => ({ default: m.DataImportModal })),
  { ssr: false },
);

export function OverviewView(props: OverviewViewProps) {
  const metrics = useOverviewMetrics(props);

  if (metrics.shouldShowLoadingSpinner) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div
      className="relative h-[calc(100vh-160px)] overflow-hidden transition-[padding-right] duration-150 ease-out sm:pr-[var(--overview-context-pane-width)]"
      style={metrics.overviewContextStyle}
      onClick={metrics.selectedContextHabitId ? metrics.handleCloseContext : undefined}
    >
      <div className="h-full min-w-0 overflow-hidden">
        <OverviewInitialSection
          hideControls={metrics.hideControls}
          isDesktopShell={metrics.isDesktopShell}
          habits={metrics.habits}
          orderedHabits={metrics.orderedHabits}
          displayLogs={metrics.scrubberDisplayLogs}
          dateRange={metrics.dateRange}
          onDateRangeChange={metrics.setDateRange}
          scrubberSelectedDate={metrics.scrubberSelectedDate}
          onScrubberHover={metrics.handleScrubberHover}
          onScrubberSelect={metrics.handleScrubberSelect}
          onShowSelectionModal={metrics.handleOpenSelectionModal}
          onShowImportModal={metrics.handleOpenImportModal}
          onReorder={metrics.handleReorder}
          getHabitMetricDisplay={metrics.getHabitMetricDisplay}
          getHabitMetricClassName={metrics.getHabitMetricClassName}
          scrubberHoveredDate={metrics.scrubberHoveredDate}
          scrubberHoveredValues={metrics.scrubberHoveredValues}
          activeTooltip={metrics.activeTooltip}
          setActiveTooltip={metrics.setActiveTooltip}
          getHabitMetricStats={metrics.getHabitMetricStats}
          onUpdateHabitDetails={metrics.handleUpdateHabitDetails}
          updatingHabitId={
            metrics.updateHabitMutation.isPending
              ? metrics.updateHabitMutation.variables?.habitId
              : null
          }
          confirmDelete={metrics.confirmDelete}
          deletingHabit={metrics.deletingHabit}
          selectedContextHabitId={metrics.selectedContextHabitId}
          onOpenContext={metrics.handleOpenContext}
        />

        {metrics.isBackendUnavailable && (
          <OverviewBackendUnavailable
            onRetry={() => {
              metrics.fetchHabits();
              metrics.fetchHabitLogs();
            }}
          />
        )}

        {!metrics.isBackendUnavailable && metrics.habits.length === 0 && !metrics.isLoading && (
          <OverviewEmptyState
            onOpenSelectionModal={metrics.handleOpenSelectionModal}
            onOpenImportModal={metrics.handleOpenImportModal}
            onOpenIntegrations={() => metrics.router.push('/integrations')}
            onOpenSettings={() => metrics.router.push('/dashboard?openSettings=account')}
            onOpenCommandPalette={metrics.handleOpenCommandPalette}
          />
        )}
      </div>

      <MetricContextPanel
        model={metrics.metricContextModel}
        isLoading={metrics.isMetricContextLoading}
        onClose={metrics.handleCloseContext}
      />

      {metrics.showSelectionModal && (
        <HabitSelectionModal
          isOpen={metrics.showSelectionModal}
          onClose={() => metrics.setShowSelectionModal(false)}
          onHabitCreated={metrics.handleHabitCreated}
        />
      )}

      {metrics.showImportModal && (
        <DataImportModal
          isOpen={metrics.showImportModal}
          onClose={() => metrics.setShowImportModal(false)}
          onImportComplete={() => {
            metrics.fetchHabits();
            metrics.fetchHabitLogs();
          }}
        />
      )}

      {metrics.habitToDelete && (
        <OverviewDeleteModal
          habitToDelete={metrics.habitToDelete}
          deletingHabit={metrics.deletingHabit}
          onCancel={metrics.cancelDelete}
          onConfirm={metrics.handleDeleteHabit}
        />
      )}
    </div>
  );
}

export type { OverviewViewProps } from './types';
