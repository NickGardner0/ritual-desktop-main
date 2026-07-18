'use client';

import React from 'react';
import { categoryRowClass } from './constants';

export type HabitListProps = {
  displayedHabits: any[];
  searchQuery: string;
  isCreating: boolean;
  handleHabitClick: (habit: { value: string; label: string }) => void;
};

export function HabitList({ displayedHabits, searchQuery, isCreating, handleHabitClick }: HabitListProps) {
  return (
            <div className="space-y-0.5">
                {displayedHabits.length > 0 ? (
                  displayedHabits.map((habit: any, index: number) => (
                    habit.section ? (
                      <div key={habit.value} className={`px-3 pt-4 pb-1 ${index === 0 ? 'pt-1' : ''}`}>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{habit.label}</p>
                      </div>
                    ) : (
                      <button
                        key={habit.value}
                        type="button"
                        onClick={() => handleHabitClick(habit)}
                        disabled={isCreating}
                        className={`${categoryRowClass} w-full cursor-pointer text-left disabled:cursor-wait disabled:opacity-50`}
                      >
                        <span className="truncate text-[13px] font-medium text-[#2c2b28]">{habit.label}</span>
                        <span className="shrink-0 px-1 text-[12.5px] font-medium text-[#8b8a86] group-hover:text-[#343330]">
                          {isCreating ? 'Creating…' : 'Track'}
                        </span>
                      </button>
                    )
                  ))
                ) : searchQuery.trim() ? (
                  // No search results message
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="text-gray-400 mb-3">
                      <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[#2c2b28] mb-1">No habits found</p>
                    <p className="text-xs text-[#8b8a86]">Try a different search term</p>
                  </div>
                ) : null}
            </div>
  );
}
