'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Plus, TrendingUp, CalendarCheck, Upload, Watch, List, LayoutGrid } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import type { DateRange } from 'react-day-picker';
import { parseISO } from 'date-fns';
import { HistoryScrubber } from '@/components/history-scrubber';
import { OverviewWelcomeHeader } from '@/components/analytics/overview-welcome-header';
import { OverviewFetchBlock } from '@/components/analytics/overview-fetch-block';
import { SortableHabitList, type SortableHabitListProps } from '@/components/analytics/sortable-habit-list';
import type { Habit } from '@/contexts/HabitsContext';
import { useUIPreferences } from '@/hooks/use-ui-preferences';

const DateRangePicker = dynamic(
  () => import('@/components/date-range-picker').then((m) => ({ default: m.DateRangePicker })),
  { ssr: false },
);

const QUICK_ACTIONS: { label: string; icon?: typeof TrendingUp; imageSrc?: string; path: string }[] = [
  { label: 'Ritual Chat', imageSrc: '/images/eclipse.svg', path: '/chat' },
  { label: 'View Trends', icon: TrendingUp, path: '/dashboard?view=metrics' },
  { label: 'Weekly Recap', icon: CalendarCheck, path: '/chat?q=weekly+recap' },
  { label: 'Import Data', icon: Upload, path: '/dashboard?view=overview&openImport=1' },
  { label: 'Connect Wearable', icon: Watch, path: '/integrations' },
];

export function QuickActionChips() {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center gap-1.5 pt-2 pb-4 flex-wrap">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => router.push(action.path)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-white px-2.5 py-1 text-[12px] font-medium text-neutral-700 transition-colors hover:bg-[#f7f7f6] hover:text-neutral-900"
        >
          {action.imageSrc ? (
            <img src={action.imageSrc} alt="" className="h-3 w-3 opacity-70" />
          ) : action.icon ? (
            <action.icon className="h-3 w-3" />
          ) : null}
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function OverviewViewMenuItems({
  isFetchView,
  onSelectList,
  onSelectFetch,
}: {
  isFetchView: boolean;
  onSelectList: () => void;
  onSelectFetch: () => void;
}) {
  return (
    <>
      <DropdownMenuLabel className="text-[11px] font-normal uppercase tracking-wide text-gray-500">
        View
      </DropdownMenuLabel>
      <DropdownMenuItem onSelect={onSelectList}>
        <List className="mr-2 h-3.5 w-3.5" />
        <span>List</span>
        {!isFetchView && <span className="ml-auto text-[11px] text-gray-500">✓</span>}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onSelectFetch}>
        <LayoutGrid className="mr-2 h-3.5 w-3.5" />
        <span>Fetch</span>
        {isFetchView && <span className="ml-auto text-[11px] text-gray-500">✓</span>}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

interface OverviewInitialSectionProps extends SortableHabitListProps {
  hideControls: boolean;
  isDesktopShell: boolean;
  orderedHabits: Habit[];
  dateRange?: DateRange;
  onDateRangeChange: (range: DateRange | undefined) => void;
  displayLogs: any[];
  scrubberSelectedDate: string | null;
  onScrubberHover: (date: string | null, values: Record<string, number> | null) => void;
  onScrubberSelect: (date: string | null) => void;
  onShowSelectionModal: () => void;
  onShowImportModal: () => void;
}

function OverviewInitialSectionInner({
  hideControls,
  isDesktopShell,
  habits,
  orderedHabits,
  displayLogs,
  dateRange,
  onDateRangeChange,
  scrubberSelectedDate,
  onScrubberHover,
  onScrubberSelect,
  scrubberHoveredDate,
  scrubberHoveredValues,
  activeTooltip,
  setActiveTooltip,
  getHabitMetricDisplay,
  getHabitMetricClassName,
  getHabitMetricStats,
  onUpdateHabitDetails,
  updatingHabitId,
  confirmDelete,
  deletingHabit,
  selectedContextHabitId,
  onOpenContext,
  onReorder,
  onShowSelectionModal,
  onShowImportModal,
}: OverviewInitialSectionProps) {
  const { overviewViewMode, setOverviewViewMode } = useUIPreferences();
  const isFetchView = overviewViewMode === 'summary';

  const handleScrubberSelect = React.useCallback((date: string | null) => {
    onScrubberSelect(date);
    if (date) {
      const selectedDateObj = parseISO(date);
      onDateRangeChange({ from: selectedDateObj, to: selectedDateObj });
    } else {
      onDateRangeChange(undefined);
    }
  }, [onDateRangeChange, onScrubberSelect]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!hideControls && (
        <div className="relative flex h-14 shrink-0 items-center justify-end">
          {habits.length > 0 && !isDesktopShell ? (
            <div className="absolute left-1/2 -translate-x-1/2 w-[500px]">
              <HistoryScrubber
                habitLogs={displayLogs}
                habits={orderedHabits}
                daysToShow={90}
                onHoverDate={onScrubberHover}
                onSelectDate={handleScrubberSelect}
                selectedDate={scrubberSelectedDate}
              />
            </div>
          ) : null}

          <div className="relative z-10 flex items-center space-x-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Overview menu"
                  className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-sm flex items-center justify-center"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <OverviewViewMenuItems
                  isFetchView={isFetchView}
                  onSelectList={() => { void setOverviewViewMode('list'); }}
                  onSelectFetch={() => { void setOverviewViewMode('summary'); }}
                />
                <DropdownMenuItem onSelect={onShowSelectionModal}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  <span>Add habit</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onShowImportModal}>
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  <span>Import data</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DateRangePicker
              className="w-auto"
              onDateRangeChange={onDateRangeChange}
              initialDateRange={dateRange}
            />
          </div>
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto ${isFetchView ? 'pt-2 pb-24' : 'pt-6 pb-24'}`}>
        {isFetchView ? (
          <div className="mx-auto w-full max-w-[408px]">
            <OverviewWelcomeHeader />
            <OverviewFetchBlock />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[408px]">
            <SortableHabitList
              habits={orderedHabits}
              onReorder={onReorder}
              getHabitMetricDisplay={getHabitMetricDisplay}
              getHabitMetricClassName={getHabitMetricClassName}
              scrubberHoveredDate={scrubberHoveredDate}
              scrubberHoveredValues={scrubberHoveredValues}
              activeTooltip={activeTooltip}
              setActiveTooltip={setActiveTooltip}
              getHabitMetricStats={getHabitMetricStats}
              onUpdateHabitDetails={onUpdateHabitDetails}
              updatingHabitId={updatingHabitId}
              confirmDelete={confirmDelete}
              deletingHabit={deletingHabit}
              selectedContextHabitId={selectedContextHabitId}
              onOpenContext={onOpenContext}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export const OverviewInitialSection = React.memo(OverviewInitialSectionInner);

export default OverviewInitialSection;
