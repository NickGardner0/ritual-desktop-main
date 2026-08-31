/**
 * OverviewView - Dashboard/Index content extracted for unified Analytics page
 */

'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { OverviewInitialSection } from '@/components/analytics/overview-initial-section';
import { OverviewBackendUnavailable } from './OverviewBackendUnavailable';
import { OverviewDeleteModal } from './OverviewDeleteModal';
import { OverviewEmptyState } from './OverviewEmptyState';
import { useOverviewMetrics } from './useOverviewMetrics';
import { useAI } from '@/contexts/AIContext';
import type { OverviewViewProps } from './types';

const HabitSelectionModal = dynamic(
  () => import('@/components/habit-selection-modal').then((m) => ({ default: m.HabitSelectionModal })),
  { ssr: false },
);

const DataImportModal = dynamic(
  () => import('@/components/data-import-modal').then((m) => ({ default: m.DataImportModal })),
  { ssr: false },
);

const IndexChatPanel = dynamic(
  () => import('@/components/chat/index-chat-panel').then((m) => ({ default: m.IndexChatPanel })),
  { ssr: false },
);

export function OverviewView(props: OverviewViewProps) {
  const metrics = useOverviewMetrics(props);
  const { indexChatOpen, openIndexChat, closeIndexChat } = useAI();

  if (metrics.shouldShowLoadingSpinner) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <BrailleSpinner className="w-8 h-8" />
      </div>
    );
  }

  const shouldShowEmptyState =
    !metrics.isBackendUnavailable && metrics.habits.length === 0 && !metrics.isLoading;

  const selectedChatHabit =
    metrics.orderedHabits.find((habit) => habit.id === metrics.selectedContextHabitId)
    || metrics.habits.find((habit) => habit.id === metrics.selectedContextHabitId);

  const handleOpenChat = (habitId: string) => {
    metrics.handleOpenContext(habitId);
    openIndexChat({ focus: true });
  };

  const handleCloseChat = () => {
    metrics.handleCloseContext();
    closeIndexChat();
  };

  return (
    <div
      className="relative h-[calc(100vh-160px)] overflow-hidden"
      onClick={(event) => {
        if (!indexChatOpen) return;
        if ((event.target as HTMLElement | null)?.closest('#ritual-right-dock')) return;
        handleCloseChat();
      }}
    >
      <div className="h-full min-w-0 overflow-hidden">
        {!shouldShowEmptyState && (
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
            onOpenContext={handleOpenChat}
          />
        )}

        {metrics.isBackendUnavailable && (
          <OverviewBackendUnavailable
            onRetry={() => {
              metrics.fetchHabits();
              metrics.fetchHabitLogs();
            }}
          />
        )}

        {shouldShowEmptyState && (
          <OverviewEmptyState
            onOpenSelectionModal={metrics.handleOpenSelectionModal}
            onOpenImportModal={metrics.handleOpenImportModal}
            onOpenIntegrations={() => metrics.router.push('/integrations')}
            onOpenSettings={() => metrics.router.push('/dashboard?openSettings=general')}
            onOpenCommandPalette={metrics.handleOpenCommandPalette}
          />
        )}
      </div>

      {indexChatOpen ? (
        <IndexChatPanel
          open
          title={selectedChatHabit?.name || 'Chat'}
          habitId={metrics.selectedContextHabitId}
          onClose={handleCloseChat}
        />
      ) : null}

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
