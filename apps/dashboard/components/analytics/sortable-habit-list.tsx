'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { StatsTooltip } from '@/components/stats-tooltip';
import type { Habit } from '@/contexts/HabitsContext';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { getHabitDisplayName } from '@/lib/computer-time-habit';
import { useUIPreferences } from '@/hooks/use-ui-preferences';
import { HabitEditDialog } from '@/components/analytics/habit-edit-dialog';

interface SortableHabitItemProps {
  habit: Habit;
  getHabitMetricDisplay: (habit: Habit, hoveredValue?: number) => string;
  getHabitMetricClassName: (habit: Habit) => string;
  /** Pre-computed hovered value for THIS specific habit (undefined if not hovered) */
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
  onUpdateHabitDetails: (
    habitId: string | undefined,
    updates: { name?: string; unit_type?: string },
  ) => Promise<void>;
  isUpdatingHabit: boolean;
  confirmDelete: (habitId: string | undefined) => void;
  isDeleting: boolean;
  isContextSelected?: boolean;
  onOpenContext?: (habitId: string) => void;
}

const SortableHabitItem = React.memo(function SortableHabitItem({
  habit,
  getHabitMetricDisplay,
  getHabitMetricClassName,
  hoveredValue,
  isTooltipOpen,
  setActiveTooltip,
  getHabitMetricStats,
  onUpdateHabitDetails,
  isUpdatingHabit,
  confirmDelete,
  isDeleting,
  isContextSelected = false,
  onOpenContext,
}: SortableHabitItemProps) {
  const displayName = getHabitDisplayName(habit.name);
  const { habitTextColor } = useUIPreferences();
  const metricTriggerRef = React.useRef<HTMLDivElement>(null);
  const metricClickTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: habit.id || '' });

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

  const handleOpenContext = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (habitId && onOpenContext) {
      onOpenContext(habitId);
    }
  };

  const handleOpenContextKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (habitId && onOpenContext) {
      onOpenContext(habitId);
    }
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={`group relative grid w-full grid-cols-[minmax(0,1fr)_max-content] items-center gap-x-4 min-h-[27px] px-1.5 py-0 bg-[var(--content-bg)] cursor-grab active:cursor-grabbing ${
          isDragging ? 'opacity-90' : ''
        }`}
        {...attributes}
        {...listeners}
      >
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-1/2 h-[var(--sidebar-row-height)] -translate-y-1/2 rounded-[12px] transition-none ${
            isDragging
              ? 'bg-[#f5f5f5] shadow-lg'
              : isContextSelected
                ? 'bg-[var(--row-active)]'
                : 'bg-transparent group-hover:bg-[var(--row-hover)]'
          }`}
        />
        <div
          className="relative z-[1] min-w-0 flex items-center rounded-[4px] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-neutral-300"
          role="button"
          tabIndex={0}
          aria-label={`Open chat for ${displayName}`}
          onClick={handleOpenContext}
          onKeyDown={handleOpenContextKeyDown}
        >
          <span className="text-[17.5px] font-normal truncate leading-[1.04] text-gray-900">
            {displayName}
          </span>
        </div>
        <div
          ref={metricTriggerRef}
          className="relative z-[1] flex items-center justify-self-end gap-1 cursor-default flex-shrink-0 tooltip-container"
          onClick={handleMetricClick}
          onDoubleClick={handleMetricDoubleClick}
        >
          {(() => {
            const display = getHabitMetricDisplay(habit, hoveredValue);
            const splitAt = display.lastIndexOf(' ');
            const value = splitAt === -1 ? display : display.slice(0, splitAt);
            const unit = splitAt === -1 ? '' : display.slice(splitAt + 1);
            return (
              <span className="text-[17.5px] font-normal select-none leading-[1.04]">
                <span
                  className={`${getHabitMetricClassName(habit)} tabular-nums`}
                  style={{ color: habitTextColor }}
                >
                  {value}
                </span>
                {unit && <span className="ml-1 text-gray-900">{unit}</span>}
              </span>
            );
          })()}
          <button
            onClick={(e) => {
              e.stopPropagation();
              confirmDelete(habit.id);
            }}
            disabled={isDeleting}
            className={`p-1 text-gray-400 hover:text-gray-600 transition-opacity disabled:opacity-50 ${
              isTooltipOpen || isDeleting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title="Delete habit"
          >
            {isDeleting ? (
              <BrailleSpinner className="text-xs text-gray-500" />
            ) : (
              <X className="w-3 h-3" />
            )}
          </button>
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

export interface SortableHabitListProps {
  habits: Habit[];
  onReorder: (habits: Habit[]) => void;
  getHabitMetricDisplay: (habit: Habit, hoveredValue?: number) => string;
  getHabitMetricClassName: (habit: Habit) => string;
  scrubberHoveredDate: string | null;
  scrubberHoveredValues: Record<string, number> | null;
  activeTooltip: string | null;
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
  onUpdateHabitDetails: (
    habitId: string | undefined,
    updates: { name?: string; unit_type?: string },
  ) => Promise<void>;
  updatingHabitId: string | null | undefined;
  confirmDelete: (habitId: string | undefined) => void;
  deletingHabit: string | null;
  selectedContextHabitId?: string | null;
  onOpenContext?: (habitId: string) => void;
}

const HABIT_ROW_ESTIMATE_PX = 36;

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return current;
    }
    current = current.parentElement;
  }
  return node;
}

function SortableHabitListInner({
  habits,
  onReorder,
  getHabitMetricDisplay,
  getHabitMetricClassName,
  scrubberHoveredDate,
  scrubberHoveredValues,
  activeTooltip,
  setActiveTooltip,
  getHabitMetricStats,
  onUpdateHabitDetails,
  updatingHabitId,
  confirmDelete,
  deletingHabit,
  selectedContextHabitId,
  onOpenContext,
}: SortableHabitListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = habits.findIndex((h) => h.id === active.id);
      const newIndex = habits.findIndex((h) => h.id === over.id);
      onReorder(arrayMove(habits, oldIndex, newIndex));
    }
  };

  const listRef = React.useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    setScrollElement(findScrollParent(listRef.current));
  }, [habits.length]);

  const virtualizer = useVirtualizer({
    count: habits.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => HABIT_ROW_ESTIMATE_PX,
    overscan: 10,
    getItemKey: (index) => habits[index]?.id || String(index),
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={habits.map(h => h.id || '')}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={listRef}
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const habit = habits[virtualRow.index];
            if (!habit) return null;
            const habitId = habit.id || '';
            return (
              <div
                key={habitId}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <SortableHabitItem
                  habit={habit}
                  getHabitMetricDisplay={getHabitMetricDisplay}
                  getHabitMetricClassName={getHabitMetricClassName}
                  hoveredValue={
                    scrubberHoveredDate && scrubberHoveredValues
                      ? scrubberHoveredValues[habitId]
                      : undefined
                  }
                  isTooltipOpen={activeTooltip === habitId}
                  setActiveTooltip={setActiveTooltip}
                  getHabitMetricStats={getHabitMetricStats}
                  onUpdateHabitDetails={onUpdateHabitDetails}
                  isUpdatingHabit={updatingHabitId === habitId}
                  confirmDelete={confirmDelete}
                  isDeleting={deletingHabit === habitId}
                  isContextSelected={selectedContextHabitId === habitId}
                  onOpenContext={onOpenContext}
                />
              </div>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export const SortableHabitList = React.memo(SortableHabitListInner);

export default SortableHabitList;
