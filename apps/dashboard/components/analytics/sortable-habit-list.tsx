'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { X, LayoutDashboard } from 'lucide-react';
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

const DynamicIcon = dynamic(() => import('@/components/ui/dynamic-icon'), {
  ssr: false,
  loading: () => <LayoutDashboard className="w-4 h-4 text-black" />,
});

function HabitIcon({ iconName }: { iconName: string }) {
  return <DynamicIcon name={iconName} className="w-4 h-4 text-black" />;
}

const HABIT_ICON_MAP: Record<string, string> = {
  'deep work': '🧠',
  'lightning deep work': '⚡',
  'meditation': '🧘',
  'exercise': '💪',
  'reading': '📚',
  'journaling': '📝',
  'sleep': '😴',
  'water': '💧',
  'learning': '🎓',
  'coding': '💻',
  'writing': '✍️',
  'music': '🎵',
  'research': '🔍',
  'skill practice': '🎯',
  'cold showers': '🚿',
  'standup check-in': '📞',
};

function getHabitIcon(name: string) {
  const key = name.toLowerCase().replace(/\s+/g, ' ');
  return HABIT_ICON_MAP[key] || '📈';
}

interface SortableHabitItemProps {
  habit: Habit;
  getHabitMetricDisplay: (habit: Habit, hoveredValue?: number) => string;
  getHabitMetricClassName: (habit: Habit) => string;
  /** Pre-computed hovered value for THIS specific habit (undefined if not hovered) */
  hoveredValue: number | undefined;
  isTooltipOpen: boolean;
  setActiveTooltip: React.Dispatch<React.SetStateAction<string | null>>;
  getHabitMetricStats: (habit: Habit) => {
    sumFormatted: string;
    avgFormatted: string;
    minFormatted: string;
    maxFormatted: string;
    stdDevFormatted: string;
  };
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group w-full max-w-2xl flex justify-between items-center gap-12 h-[29px] px-1 bg-white hover:bg-[#F7F7F7] cursor-grab active:cursor-grabbing ${
        isDragging ? 'shadow-lg bg-[#F3F3F3] opacity-90' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex items-center justify-center w-5 h-5 flex-shrink-0 self-center -translate-y-px">
          {habit.icon ? (
            /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(habit.icon) ? (
              <span className="text-base leading-none inline-flex items-center">{habit.icon}</span>
            ) : (
              <HabitIcon iconName={habit.icon} />
            )
          ) : (
            <span className="text-base leading-none inline-flex items-center">{getHabitIcon(displayName)}</span>
          )}
        </span>
        <span className="text-[17.5px] font-normal text-gray-900 truncate leading-none">{displayName}</span>
      </div>
      <div
        ref={metricTriggerRef}
        className="flex items-center space-x-2 cursor-default relative tooltip-container flex-shrink-0"
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
    sumFormatted: string;
    avgFormatted: string;
    minFormatted: string;
    maxFormatted: string;
    stdDevFormatted: string;
  };
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
