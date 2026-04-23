'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
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
}

function HabitEditDialog({
  open,
  habit,
  nameDraft,
  unitDraft,
  onNameChange,
  onUnitChange,
  onClose,
  onSave,
  isSaving,
}: {
  open: boolean;
  habit: Habit;
  nameDraft: string;
  unitDraft: string;
  onNameChange: (value: string) => void;
  onUnitChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/10" onClick={onClose} />
      <div
        className="relative w-full max-w-[540px] rounded-sm border border-gray-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.14)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-7 py-5">
          <h3 className="text-[17px] font-medium text-gray-900">Edit Habit</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Close edit habit dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-7 py-6">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-6 gap-y-4">
            <label htmlFor={`habit-name-${habit.id || 'unknown'}`} className="text-sm text-gray-500">
              Title
            </label>
            <input
              id={`habit-name-${habit.id || 'unknown'}`}
              value={nameDraft}
              onChange={(event) => onNameChange(event.target.value)}
              className="h-11 rounded-sm border border-gray-200 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-400"
              maxLength={72}
            />

            <label htmlFor={`habit-unit-${habit.id || 'unknown'}`} className="text-sm text-gray-500">
              Unit
            </label>
            <input
              id={`habit-unit-${habit.id || 'unknown'}`}
              value={unitDraft}
              onChange={(event) => onUnitChange(event.target.value)}
              className="h-11 rounded-sm border border-gray-200 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-400"
              maxLength={24}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-7 py-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-sm bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#27251E] disabled:opacity-50"
          >
            {isSaving ? (
              <BrailleSpinner className="text-[10px] text-white" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
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

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={`group grid w-full grid-cols-[minmax(0,1fr)_max-content] items-center gap-x-4 min-h-[27px] rounded-[6px] px-1 py-0 bg-[var(--content-bg)] hover:bg-[#f6f6f5] cursor-grab active:cursor-grabbing ${
          isDragging ? 'shadow-lg bg-[#f5f5f5] opacity-90' : ''
        }`}
        {...attributes}
        {...listeners}
      >
        <div className="min-w-0 flex items-center">
          <span
            className="text-[17.5px] font-normal truncate leading-[1.04]"
            style={{ color: habitTextColor }}
          >
            {displayName}
          </span>
        </div>
        <div
          ref={metricTriggerRef}
          className="flex items-center justify-self-end gap-1 cursor-default relative tooltip-container flex-shrink-0"
          onClick={handleMetricClick}
          onDoubleClick={handleMetricDoubleClick}
        >
          <span
            className="text-[17.5px] font-normal select-none tabular-nums leading-[1.04]"
            style={{ color: habitTextColor }}
          >
            <span className={getHabitMetricClassName(habit)} style={{ color: habitTextColor }}>
              {getHabitMetricDisplay(habit, hoveredValue)}
            </span>
          </span>
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
                onUpdateHabitDetails={onUpdateHabitDetails}
                isUpdatingHabit={updatingHabitId === habitId}
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
