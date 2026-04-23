'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { StatsTooltip } from '@/components/stats-tooltip';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { PerplexityMiniSparkChart } from '@/components/charts/PerplexityMiniSparkChart';
import { getHabitDisplayName } from '@/lib/computer-time-habit';
import { useUIPreferences } from '@/hooks/use-ui-preferences';
import type { Habit } from '@/contexts/HabitsContext';
import { HabitEditDialog } from '@/components/analytics/habit-edit-dialog';

export interface HabitDailyPoint {
  date: string;
  value: number;
}

export interface OverviewMetricCardProps {
  habit: Habit;
  getHabitMetricDisplay: (habit: Habit, hoveredValue?: number) => string;
  getHabitMetricClassName: (habit: Habit) => string;
  hoveredValue: number | undefined;
  isTooltipOpen: boolean;
  setActiveTooltip: React.Dispatch<React.SetStateAction<string | null>>;
  getHabitMetricStats: (habit: Habit) => {
    unitLabel: string;
    sumFormatted: string;
    avgFormatted: string;
    minFormatted: string;
    maxFormatted: string;
    stdDevFormatted: string;
    trackedDays: number;
  };
  getHabitDailySeries: (habit: Habit) => HabitDailyPoint[];
  onUpdateHabitDetails: (
    habitId: string | undefined,
    updates: { name?: string; unit_type?: string },
  ) => Promise<void>;
  isUpdatingHabit: boolean;
  confirmDelete: (habitId: string | undefined) => void;
  isDeleting: boolean;
}

export const OverviewMetricCard = React.memo(function OverviewMetricCard({
  habit,
  getHabitMetricDisplay,
  getHabitMetricClassName,
  hoveredValue,
  isTooltipOpen,
  setActiveTooltip,
  getHabitMetricStats,
  getHabitDailySeries,
  onUpdateHabitDetails,
  isUpdatingHabit,
  confirmDelete,
  isDeleting,
}: OverviewMetricCardProps) {
  const displayName = getHabitDisplayName(habit.name);
  const { habitTextColor } = useUIPreferences();
  const metricTriggerRef = React.useRef<HTMLDivElement>(null);
  const metricClickTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: habit.id || '',
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const habitId = habit.id || '';
  const [isEditingDetails, setIsEditingDetails] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(habit.name || '');
  const [unitDraft, setUnitDraft] = React.useState(habit.unit_type || '');

  React.useEffect(() => {
    if (!isEditingDetails) {
      setNameDraft(habit.name || '');
      setUnitDraft(habit.unit_type || '');
    }
  }, [habit.name, habit.unit_type, isEditingDetails]);

  React.useEffect(() => {
    return () => {
      if (metricClickTimeoutRef.current) {
        clearTimeout(metricClickTimeoutRef.current);
      }
    };
  }, []);

  const handleSaveDetails = async () => {
    const trimmedName = nameDraft.trim();
    const trimmed = unitDraft.trim();
    const nextUpdates: { name?: string; unit_type?: string } = {};

    if (trimmedName && trimmedName !== (habit.name || '').trim()) {
      nextUpdates.name = trimmedName;
    }
    if (trimmed && trimmed !== (habit.unit_type || '').trim()) {
      nextUpdates.unit_type = trimmed;
    }

    if (Object.keys(nextUpdates).length === 0) {
      setIsEditingDetails(false);
      return;
    }

    try {
      await onUpdateHabitDetails(habit.id, nextUpdates);
      setIsEditingDetails(false);
    } catch (error) {
      console.error('Failed to update habit details:', error);
    }
  };

  const handleMetricClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (metricClickTimeoutRef.current) {
      clearTimeout(metricClickTimeoutRef.current);
    }
    metricClickTimeoutRef.current = setTimeout(() => {
      setActiveTooltip((prev) => (prev === habitId ? null : habitId));
      metricClickTimeoutRef.current = null;
    }, 180);
  };

  const handleMetricDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (metricClickTimeoutRef.current) {
      clearTimeout(metricClickTimeoutRef.current);
      metricClickTimeoutRef.current = null;
    }
    setActiveTooltip(null);
    setIsEditingDetails(true);
  };

  const display = getHabitMetricDisplay(habit, hoveredValue);
  const splitAt = display.lastIndexOf(' ');
  const value = splitAt === -1 ? display : display.slice(0, splitAt);
  const unit = splitAt === -1 ? '' : display.slice(splitAt + 1);

  const dailySeries = getHabitDailySeries(habit);
  const sparkValues = dailySeries.map((point) => point.value).filter((v) => Number.isFinite(v));
  const hasSparkline = sparkValues.length >= 2;
  const cardStats = getHabitMetricStats(habit);

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={`group relative flex min-w-0 flex-col rounded-sm border border-[rgba(39,37,30,0.08)] bg-white px-4 pt-3 pb-2.5 min-h-[108px] cursor-grab active:cursor-grabbing transition-colors duration-200 hover:border-[rgba(39,37,30,0.16)] hover:bg-[rgba(39,37,30,0.015)] ${
          isDragging ? 'shadow-lg bg-[#f5f5f5] opacity-90' : ''
        }`}
        {...attributes}
        {...listeners}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            confirmDelete(habit.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={isDeleting}
          className={`absolute right-2 top-2 z-20 p-1 text-gray-400 hover:text-gray-600 transition-opacity disabled:opacity-50 ${
            isTooltipOpen || isDeleting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          title="Delete habit"
          aria-label="Delete habit"
        >
          {isDeleting ? (
            <BrailleSpinner className="text-xs text-gray-500" />
          ) : (
            <X className="w-3 h-3" />
          )}
        </button>

        <div className="min-w-0">
          <span className="block truncate text-[12.5px] font-normal tracking-[-0.08px] text-[rgba(39,37,30,0.58)]">
            {displayName}
          </span>
        </div>

        <div
          ref={metricTriggerRef}
          className="relative mt-0.5 flex cursor-default items-baseline gap-1.5 tooltip-container"
          onClick={handleMetricClick}
          onDoubleClick={handleMetricDoubleClick}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span
            className={`text-[22px] font-normal leading-[1.15] tabular-nums truncate ${getHabitMetricClassName(habit)}`}
            style={{ color: habitTextColor }}
          >
            {value}
          </span>
          {unit ? (
            <span className="text-[12.5px] font-normal text-[rgba(39,37,30,0.58)] truncate">
              {unit}
            </span>
          ) : null}

          <StatsTooltip open={isTooltipOpen} triggerRef={metricTriggerRef}>
            {isTooltipOpen ? (() => {
              const s = getHabitMetricStats(habit);
              return (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Sum</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.sumFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Average</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.avgFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Min</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.minFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Max</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.maxFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Days</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">
                      {s.trackedDays.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })() : null}
          </StatsTooltip>
        </div>

        <div className="mt-auto pt-2">
          {hasSparkline ? (
            <PerplexityMiniSparkChart values={sparkValues} trend="neutral" height={30} />
          ) : cardStats.trackedDays > 0 ? (
            <div className="flex items-baseline gap-1 text-[11px] font-normal text-[rgba(39,37,30,0.45)] tabular-nums truncate">
              <span>Avg {cardStats.avgFormatted}</span>
              <span aria-hidden="true">·</span>
              <span>{cardStats.trackedDays.toLocaleString()} {cardStats.trackedDays === 1 ? 'day' : 'days'}</span>
            </div>
          ) : (
            <div className="h-[14px]" aria-hidden="true" />
          )}
        </div>
      </div>

      <HabitEditDialog
        open={isEditingDetails}
        habit={habit}
        nameDraft={nameDraft}
        unitDraft={unitDraft}
        onNameChange={setNameDraft}
        onUnitChange={setUnitDraft}
        onClose={() => {
          setIsEditingDetails(false);
          setNameDraft(habit.name || '');
          setUnitDraft(habit.unit_type || '');
        }}
        onSave={() => {
          void handleSaveDetails();
        }}
        isSaving={isUpdatingHabit}
      />
    </>
  );
});

export default OverviewMetricCard;
