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
            <div>
                {displayedHabits.length > 0 ? (
                  displayedHabits.map((habit: any, index: number) => (
                    habit.section ? (
                      <div key={habit.value} className={`px-3 pt-4 pb-1 ${index === 0 ? 'pt-1' : ''}`}>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{habit.label}</p>
                      </div>
                    ) : (
                      <div key={habit.value} className={`${categoryRowClass} min-h-12`}>
                        <p className="text-sm font-normal text-gray-900">{habit.label}</p>
                        <button
                          onClick={() => handleHabitClick(habit)}
                          disabled={isCreating}
                          className="px-3 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-sm transition-none hover:bg-[#F3F3F3] disabled:opacity-50"
                        >
                          {isCreating ? 'Creating...' : 'Track'}
                        </button>
                      </div>
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
                    <p className="text-sm font-normal text-gray-900 mb-1">No habits found</p>
                    <p className="text-xs text-gray-500">Try a different search term</p>
                  </div>
                ) : null}
            </div>
  );
}
