'use client';

import React from 'react';
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import type { Habit } from '@/contexts/HabitsContext';
import {
  OverviewMetricCard,
  type HabitDailyPoint,
} from '@/components/analytics/overview-metric-card';

export interface SortableHabitGridProps {
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
  getHabitDailySeries: (habit: Habit) => HabitDailyPoint[];
  onUpdateHabitDetails: (
    habitId: string | undefined,
    updates: { name?: string; unit_type?: string },
  ) => Promise<void>;
  updatingHabitId: string | null | undefined;
  confirmDelete: (habitId: string | undefined) => void;
  deletingHabit: string | null;
}

function SortableHabitGridInner({
  habits,
  onReorder,
  getHabitMetricDisplay,
  getHabitMetricClassName,
  scrubberHoveredDate,
  scrubberHoveredValues,
  activeTooltip,
  setActiveTooltip,
  getHabitMetricStats,
  getHabitDailySeries,
  onUpdateHabitDetails,
  updatingHabitId,
  confirmDelete,
  deletingHabit,
}: SortableHabitGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={habits.map((h) => h.id || '')} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
          {habits.map((habit) => {
            const habitId = habit.id || '';
            return (
              <OverviewMetricCard
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
                getHabitDailySeries={getHabitDailySeries}
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

export const SortableHabitGrid = React.memo(SortableHabitGridInner);

export default SortableHabitGrid;
