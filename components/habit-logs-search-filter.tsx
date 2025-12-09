'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Input } from '@/components/ui/input';
import type { FilterState } from '@/app/(dashboard)/activity/activity-client';

interface Props {
  filters: FilterState;
  onFilterChange: (filters: Partial<FilterState>) => void;
  habits: Array<{ id: string; name: string; category: string }>;
  categories: string[];
  sources: string[];
}

export function HabitLogsSearchFilter({
  filters,
  onFilterChange,
}: Props) {
  const [searchInput, setSearchInput] = useState(filters.q || '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the search input (400ms delay for smoother experience)
  const debouncedSearch = useDebounce(searchInput, 400);

  // Trigger search when debounced value changes (silent instant search)
  useEffect(() => {
    const newQuery = debouncedSearch || null;
    const currentQuery = filters.q || null;
    
    // Only trigger if the value actually changed
    if (newQuery !== currentQuery) {
      onFilterChange({ q: newQuery });
    }
  }, [debouncedSearch, filters.q, onFilterChange]);

  // Handle search input change
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  }, []);

  // Handle search submit (still support Enter key for immediate search)
  const handleSearchSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    // Immediately trigger search on Enter, bypassing debounce
    onFilterChange({ q: searchInput || null });
  }, [searchInput, onFilterChange]);

  return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1">
        {/* Search Input */}
        <form
          className="relative flex-1 max-w-[350px]"
          onSubmit={handleSearchSubmit}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <Input
            ref={inputRef}
          placeholder="Search logs..."
            className="pl-9 pr-9 rounded-none border-gray-300 focus:ring-0 focus:border-gray-400 h-10"
            value={searchInput}
            onChange={handleSearchChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearchSubmit();
              if (e.key === 'Escape') {
                setSearchInput('');
                onFilterChange({ q: null });
              }
            }}
          />
          
        {/* Clear button when there's input */}
        {searchInput && (
            <button
              type="button"
            onClick={() => {
              setSearchInput('');
              onFilterChange({ q: null });
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
            >
            <X className="w-4 h-4" />
            </button>
        )}
      </form>
          </div>
  );
}
