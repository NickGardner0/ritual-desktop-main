'use client';

import React, { useEffect, useMemo } from 'react';
import { categoryRowClass, connectRowActionClass, sectionLabelClass } from './constants';

export type HabitListProps = {
  displayedHabits: any[];
  searchQuery: string;
  isCreating: boolean;
  handleHabitClick: (habit: { value: string; label: string }) => void;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  onItemsChange?: (count: number) => void;
  onRegisterSelectHandlers?: (handlers: Array<() => void>) => void;
};

export function HabitList({
  displayedHabits,
  searchQuery,
  isCreating,
  handleHabitClick,
  activeIndex = 0,
  onActiveIndexChange,
  onItemsChange,
  onRegisterSelectHandlers,
}: HabitListProps) {
  const selectable = useMemo(
    () => displayedHabits.filter((habit: any) => !habit.section),
    [displayedHabits],
  );

  useEffect(() => {
    onItemsChange?.(selectable.length);
  }, [selectable.length, onItemsChange]);

  useEffect(() => {
    onRegisterSelectHandlers?.(
      selectable.map((habit: any) => () => handleHabitClick(habit)),
    );
  }, [selectable, handleHabitClick, onRegisterSelectHandlers]);

  useEffect(() => {
    if (!onActiveIndexChange) return;
    if (selectable.length === 0) return;
    if (activeIndex >= selectable.length) onActiveIndexChange(selectable.length - 1);
  }, [activeIndex, selectable.length, onActiveIndexChange]);

  if (displayedHabits.length === 0 && searchQuery.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <p className="text-[13.5px] font-medium text-[#27251E]">No habits found</p>
        <p className="mt-1 text-[12.5px] text-[rgba(39,37,30,0.45)]">Try a different search term</p>
      </div>
    );
  }

  let selectableIndex = -1;

  return (
    <div className="flex flex-col gap-0.5">
      {displayedHabits.map((habit: any, index: number) => {
        if (habit.section) {
          return (
            <div
              key={habit.value}
              className={`${sectionLabelClass} ${index === 0 ? 'pt-1' : ''}`}
            >
              {habit.label}
            </div>
          );
        }

        selectableIndex += 1;
        const rowIndex = selectableIndex;
        const active = rowIndex === activeIndex;

        return (
          <button
            key={habit.value}
            type="button"
            data-active={active ? 'true' : undefined}
            disabled={isCreating}
            onMouseEnter={() => onActiveIndexChange?.(rowIndex)}
            onClick={() => handleHabitClick(habit)}
            className={categoryRowClass}
          >
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-normal tracking-[-0.01em] text-[#27251E]">
              {habit.label}
            </span>
            <span className={connectRowActionClass}>
              {isCreating ? 'Creating…' : active ? '↵' : 'Track'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
