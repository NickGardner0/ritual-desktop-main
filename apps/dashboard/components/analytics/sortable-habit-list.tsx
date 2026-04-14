'use client';

import React from 'react';
import { Check, Pencil, X } from 'lucide-react';
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
  };
  onUpdateHabitUnit: (habitId: string | undefined, nextUnit: string) => Promise<void>;
  isUpdatingUnit: boolean;
  confirmDelete: (habitId: string | undefined) => void;
  isDeleting: boolean;
}

const SortableHabitItem = React.memo(function SortableHabitItem({
  habit,
  getHabitMetricDisplay,
  getHabitMetricClassName,
  hoveredValue,
  isTooltipOpen,
  setActiveTooltip,
  getHabitMetricStats,
  onUpdateHabitUnit,
  isUpdatingUnit,
  confirmDelete,
  isDeleting,
}: SortableHabitItemProps) {
  const displayName = getHabitDisplayName(habit.name);
  const metricTriggerRef = React.useRef<HTMLDivElement>(null);
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
  const [isEditingUnit, setIsEditingUnit] = React.useState(false);
  const [unitDraft, setUnitDraft] = React.useState(habit.unit_type || '');

  React.useEffect(() => {
    if (!isEditingUnit) {
      setUnitDraft(habit.unit_type || '');
    }
  }, [habit.unit_type, isEditingUnit]);

  const handleSaveUnit = async () => {
    const trimmed = unitDraft.trim();
    if (!trimmed || trimmed === (habit.unit_type || '').trim()) {
      setIsEditingUnit(false);
      return;
    }

    try {
      await onUpdateHabitUnit(habit.id, trimmed);
      setIsEditingUnit(false);
    } catch (error) {
      console.error('Failed to update habit unit:', error);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group w-full max-w-2xl flex justify-between items-center gap-8 h-[29px] px-1 bg-[var(--content-bg)] hover:bg-[#fafafa] cursor-grab active:cursor-grabbing ${
        isDragging ? 'shadow-lg bg-[#f5f5f5] opacity-90' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      <div className="flex min-w-0 items-center">
        <span className="text-[17.5px] font-normal text-gray-900 truncate leading-none">{displayName}</span>
      </div>
      <div
        ref={metricTriggerRef}
        className="flex items-center space-x-1.5 cursor-default relative tooltip-container flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          setActiveTooltip(prev => prev === habitId ? null : habitId);
        }}
      >
        <span className="text-[17.5px] font-normal text-gray-900 select-none tabular-nums">
          <span className={getHabitMetricClassName(habit)}>
            {getHabitMetricDisplay(habit, hoveredValue)}
          </span>
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); confirmDelete(habit.id); }}
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
                  <span className="text-gray-900">Std Dev</span>
                  <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.stdDevFormatted}</span>
                </div>
                <div className="my-2 border-t border-gray-200" />
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-900">Unit</span>
                    {isEditingUnit ? null : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsEditingUnit(true);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-900"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    )}
                  </div>
                  {isEditingUnit ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={unitDraft}
                        onChange={(event) => setUnitDraft(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleSaveUnit();
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setIsEditingUnit(false);
                            setUnitDraft(habit.unit_type || '');
                          }
                        }}
                        placeholder="Percent or %"
                        className="w-full rounded-sm border border-gray-300 px-2 py-1.5 text-sm text-gray-900 outline-none transition-colors focus:border-gray-500"
                        maxLength={24}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setIsEditingUnit(false);
                            setUnitDraft(habit.unit_type || '');
                          }}
                          className="text-xs text-gray-500 transition-colors hover:text-gray-900"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleSaveUnit();
                          }}
                          disabled={isUpdatingUnit}
                          className="inline-flex items-center gap-1 rounded-sm bg-black px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          {isUpdatingUnit ? (
                            <BrailleSpinner className="text-[10px] text-white" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-right tabular-nums text-gray-600">
                      {s.unitLabel || 'sessions'}
                    </div>
                  )}
                </div>
              </div>
            );
          })() : null}
        </StatsTooltip>
      </div>
    </div>
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
  };
  onUpdateHabitUnit: (habitId: string | undefined, nextUnit: string) => Promise<void>;
  updatingHabitUnitId: string | null | undefined;
  confirmDelete: (habitId: string | undefined) => void;
  deletingHabit: string | null;
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
  onUpdateHabitUnit,
  updatingHabitUnitId,
  confirmDelete,
  deletingHabit,
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
        <div>
          {habits.map((habit) => {
            const habitId = habit.id || '';
            return (
              <SortableHabitItem
                key={habitId}
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
                onUpdateHabitUnit={onUpdateHabitUnit}
                isUpdatingUnit={updatingHabitUnitId === habitId}
                confirmDelete={confirmDelete}
                isDeleting={deletingHabit === habitId}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export const SortableHabitList = React.memo(SortableHabitListInner);

export default SortableHabitList;
