'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Plus, Download, TrendingUp, CalendarCheck, Upload, Watch } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { parseISO } from 'date-fns';
import { HistoryScrubber } from '@/components/history-scrubber';
import type { Habit } from '@/contexts/HabitsContext';
import type { SortableHabitListProps } from '@/components/analytics/sortable-habit-list';

const DateRangePicker = dynamic(
  () => import('@/components/date-range-picker').then((m) => ({ default: m.DateRangePicker })),
  { ssr: false },
);

const SortableHabitList = dynamic(
  () => import('@/components/analytics/sortable-habit-list').then((m) => ({ default: m.SortableHabitList })),
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
  onReorder,
  onShowSelectionModal,
  onShowImportModal,
}: OverviewInitialSectionProps) {
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
    <>
      {!hideControls && (
        <div className="relative flex items-center justify-end h-14">
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

          <div className="flex items-center space-x-1 relative z-10">
            <div className="relative group">
              <button
                onClick={onShowSelectionModal}
                className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-sm flex items-center justify-center"
                aria-label="Add Habit"
              >
                <Plus className="w-4 h-4" />
              </button>
              <div className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Add
              </div>
            </div>

            <div className="relative group">
              <button
                onClick={onShowImportModal}
                className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-sm flex items-center justify-center"
                aria-label="Import Data"
              >
                <Download className="w-4 h-4" />
              </button>
              <div className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Import
              </div>
            </div>

            <DateRangePicker
              className="w-auto"
              onDateRangeChange={onDateRangeChange}
              initialDateRange={dateRange}
            />
          </div>
        </div>
      )}

      <div className="pt-6 flex-1 overflow-auto pb-4">
        <div className="max-w-[500px] mx-auto w-full">
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
          />
        </div>
      </div>
    </>
  );
}

export const OverviewInitialSection = React.memo(OverviewInitialSectionInner);

export default OverviewInitialSection;
