'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, SlidersHorizontal, Plus, Trash2 } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type {
  BuiltInFilterPresetId,
  FilterState,
  SavedFilterView,
} from '@/app/(dashboard)/activity/activity-client';

interface Suggestion {
  type: 'habit' | 'date';
  text: string;
  id?: string;
}

interface Props {
  filters: FilterState;
  onFilterChange: (filters: Partial<FilterState>) => void;
  habits: Array<{ id: string; name: string; category: string }>;
  categories: string[];
  sources: string[];
  builtInPresets: Array<{ id: BuiltInFilterPresetId; label: string }>;
  savedViews: SavedFilterView[];
  activeViewId: string | null;
  onApplyPreset: (presetId: BuiltInFilterPresetId) => void;
  onApplySavedView: (viewId: string) => void;
  onSaveCurrentView: (name: string) => void;
  onDeleteSavedView: (viewId: string) => void;
}

type ArrayFilterKey = 'categories' | 'habits' | 'statuses' | 'sources';

const STATUS_OPTIONS = [
  { id: 'completed', label: 'Completed' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'missed', label: 'Missed' },
] as const;

function toLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function isToggleKey(event: React.KeyboardEvent) {
  return event.key === 'Enter' || event.key === ' ';
}

export function HabitLogsSearchFilter({
  filters,
  onFilterChange,
  habits,
  categories,
  sources,
  builtInPresets,
  savedViews,
  activeViewId,
  onApplyPreset,
  onApplySavedView,
  onSaveCurrentView,
  onDeleteSavedView,
}: Props) {
  const [searchInput, setSearchInput] = useState(filters.q || '');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [viewNameInput, setViewNameInput] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedSearch = useDebounce(searchInput, 150);

  useEffect(() => {
    if ((filters.q || '') !== searchInput) {
      setSearchInput(filters.q || '');
    }
  }, [filters.q]);

  const hasAnyFilters = useMemo(() => {
    if (filters.q) return true;
    if (filters.start || filters.end) return true;
    return (filters.categories?.length || 0) > 0 ||
      (filters.habits?.length || 0) > 0 ||
      (filters.statuses?.length || 0) > 0 ||
      (filters.sources?.length || 0) > 0;
  }, [filters]);

  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    setSuggestions([]);
    setShowSuggestions(false);
    onFilterChange({
      q: null,
      start: null,
      end: null,
      categories: null,
      habits: null,
      statuses: null,
      sources: null,
    });
  }, [onFilterChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        inputRef.current?.focus();
      }

      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        if (!searchInput) {
          clearAllFilters();
        } else {
          setShowSuggestions(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchInput, clearAllFilters]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!debouncedSearch || debouncedSearch.length < 2) {
        setSuggestions([]);
        return;
      }

      setIsLoading(true);

      try {
        const habitResponse = await fetch(
          `/api/search/habits?q=${encodeURIComponent(debouncedSearch)}&limit=4`,
        );

        let habitSuggestions: Suggestion[] = [];
        if (habitResponse.ok) {
          const data = await habitResponse.json();
          habitSuggestions = (data.hits || []).map((h: any) => ({
            type: 'habit' as const,
            text: h.name,
            id: h.id,
          }));
        }

        const dateSuggestions: Suggestion[] = [];
        const searchLower = debouncedSearch.toLowerCase();

        if ('today'.includes(searchLower) || searchLower.includes('today')) {
          dateSuggestions.push({ type: 'date', text: 'Today' });
        }
        if ('yesterday'.includes(searchLower) || searchLower.includes('yesterday')) {
          dateSuggestions.push({ type: 'date', text: 'Yesterday' });
        }
        if ('last week'.includes(searchLower) || searchLower.includes('week')) {
          dateSuggestions.push({ type: 'date', text: 'Last 7 days' });
        }
        if ('last month'.includes(searchLower) || searchLower.includes('month')) {
          dateSuggestions.push({ type: 'date', text: 'Last 30 days' });
        }

        setSuggestions([...habitSuggestions, ...dateSuggestions].slice(0, 6));
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuggestions();
  }, [debouncedSearch]);

  useEffect(() => {
    const newQuery = debouncedSearch || null;
    const currentQuery = filters.q || null;

    if (newQuery !== currentQuery) {
      onFilterChange({ q: newQuery });
    }
  }, [debouncedSearch, filters.q, onFilterChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleArrayFilter = useCallback(
    (key: ArrayFilterKey, value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];

      onFilterChange({
        [key]: next.length > 0 ? next : null,
      } as Partial<FilterState>);
    },
    [filters, onFilterChange],
  );

  const applyDatePreset = useCallback(
    (preset: 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'clear') => {
      const now = new Date();

      if (preset === 'clear') {
        onFilterChange({ start: null, end: null });
        return;
      }

      if (preset === 'today') {
        const today = toLocalDateString(now);
        onFilterChange({ start: today, end: today });
        return;
      }

      if (preset === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const day = toLocalDateString(yesterday);
        onFilterChange({ start: day, end: day });
        return;
      }

      const daysBack = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
      const from = new Date(now);
      from.setDate(from.getDate() - daysBack);
      onFilterChange({
        start: toLocalDateString(from),
        end: toLocalDateString(now),
      });
    },
    [onFilterChange],
  );

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
    setShowSuggestions(true);
    setSelectedIndex(-1);
  }, []);

  const handleSearchSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    setShowSuggestions(false);
    onFilterChange({ q: searchInput || null });
  }, [searchInput, onFilterChange]);

  const handleSaveView = useCallback(() => {
    const trimmed = viewNameInput.trim();
    if (!trimmed) return;
    onSaveCurrentView(trimmed);
    setViewNameInput('');
  }, [onSaveCurrentView, viewNameInput]);

  const handleSelectSuggestion = useCallback((suggestion: Suggestion) => {
    setShowSuggestions(false);

    if (suggestion.type === 'habit') {
      setSearchInput(suggestion.text);
      onFilterChange({
        q: suggestion.text,
        habits: suggestion.id ? [suggestion.id] : null,
      });
      return;
    }

    const now = new Date();
    let start: string | null = null;
    let end: string | null = null;

    if (suggestion.text === 'Today') {
      start = end = toLocalDateString(now);
    } else if (suggestion.text === 'Yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      start = end = toLocalDateString(yesterday);
    } else if (suggestion.text === 'Last 7 days') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      start = toLocalDateString(weekAgo);
      end = toLocalDateString(now);
    } else if (suggestion.text === 'Last 30 days') {
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      start = toLocalDateString(monthAgo);
      end = toLocalDateString(now);
    }

    setSearchInput('');
    onFilterChange({ q: null, start, end });
  }, [onFilterChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') handleSearchSubmit();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelectSuggestion(suggestions[selectedIndex]);
        } else {
          handleSearchSubmit();
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
      case 'Tab':
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          e.preventDefault();
          handleSelectSuggestion(suggestions[selectedIndex]);
        }
        break;
    }
  }, [showSuggestions, suggestions, selectedIndex, handleSearchSubmit, handleSelectSuggestion]);

  return (
    <div ref={containerRef} className="relative w-full md:w-[350px]">
      <form onSubmit={handleSearchSubmit}>
        <Search className="absolute pointer-events-none left-3 top-[11px] w-4 h-4 text-gray-500 z-10" />
        <Input
          ref={inputRef}
          placeholder="Search logs, habits, notes..."
          className="pl-9 pr-8 rounded-none border-gray-200 focus:ring-0 focus:border-gray-300 h-9 w-full text-sm"
          value={searchInput}
          onChange={handleSearchChange}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        {isLoading && (
          <BrailleSpinner className="absolute right-8 top-[10px] text-sm text-gray-400" />
        )}

        <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'absolute z-10 right-3 top-[10px] opacity-50 transition-opacity duration-300 hover:opacity-100',
                hasAnyFilters && 'opacity-100 text-gray-900',
                isFilterOpen && 'opacity-100 text-gray-900',
              )}
              aria-label="Filters"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={10}
            className="w-[350px] rounded-none border-gray-200 p-0 bg-white"
          >
              <div className="max-h-[440px] overflow-y-auto">
                <div className="p-3 border-b border-gray-200">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Views</div>
                  <div className="grid grid-cols-2 gap-1.5 mb-2">
                    {builtInPresets.map((preset) => {
                      const isActive = activeViewId === `preset:${preset.id}`;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => onApplyPreset(preset.id)}
                          className={cn(
                            'h-7 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8] text-left px-2',
                            isActive && 'bg-[#F2F2F2] text-gray-900',
                          )}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1 max-h-24 overflow-y-auto mb-2">
                    {savedViews.map((view) => {
                      const isActive = activeViewId === view.id;
                      return (
                        <div
                          key={view.id}
                          className={cn(
                            'flex items-center border border-transparent',
                            isActive && 'border-gray-200 bg-[#F7F7F7]',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onApplySavedView(view.id)}
                            className="flex-1 px-2 py-1 text-left text-xs text-gray-700 hover:bg-[#F8F8F8]"
                          >
                            {view.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSavedView(view.id)}
                            className="h-6 w-6 text-gray-400 hover:text-gray-700 inline-flex items-center justify-center"
                            aria-label={`Delete ${view.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {savedViews.length === 0 && (
                      <div className="px-1 text-xs text-gray-500">No saved views</div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Input
                      value={viewNameInput}
                      onChange={(event) => setViewNameInput(event.target.value)}
                      placeholder="Save current view"
                      className="h-8 rounded-none border-gray-200 text-xs"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleSaveView();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSaveView}
                      className="h-8 px-2 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8] inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Save
                    </button>
                  </div>
                </div>

                <div className="p-3 border-b border-gray-200">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Quick Date</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button type="button" onClick={() => applyDatePreset('today')} className="h-7 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8]">Today</button>
                    <button type="button" onClick={() => applyDatePreset('yesterday')} className="h-7 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8]">Yesterday</button>
                    <button type="button" onClick={() => applyDatePreset('7d')} className="h-7 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8]">Last 7d</button>
                    <button type="button" onClick={() => applyDatePreset('30d')} className="h-7 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8]">Last 30d</button>
                    <button type="button" onClick={() => applyDatePreset('90d')} className="h-7 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8]">Last 90d</button>
                    <button type="button" onClick={() => applyDatePreset('clear')} className="h-7 border border-gray-200 text-xs text-gray-700 hover:bg-[#F8F8F8]">Clear</button>
                  </div>
                </div>

                <div className="p-3 border-b border-gray-200">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Status</div>
                  <div className="space-y-1">
                    {STATUS_OPTIONS.map((status) => {
                      const checked = filters.statuses?.includes(status.id) || false;
                      return (
                        <div
                          key={status.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleArrayFilter('statuses', status.id)}
                          onKeyDown={(event) => {
                            if (!isToggleKey(event)) return;
                            event.preventDefault();
                            toggleArrayFilter('statuses', status.id);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#F8F8F8]"
                        >
                          <Checkbox checked={checked} className="pointer-events-none rounded-none border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900" />
                          <span className="text-sm text-gray-900">{status.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-3 border-b border-gray-200">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Categories</div>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {categories.map((category) => {
                      const checked = filters.categories?.includes(category) || false;
                      return (
                        <div
                          key={category}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleArrayFilter('categories', category)}
                          onKeyDown={(event) => {
                            if (!isToggleKey(event)) return;
                            event.preventDefault();
                            toggleArrayFilter('categories', category);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#F8F8F8]"
                        >
                          <Checkbox checked={checked} className="pointer-events-none rounded-none border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900" />
                          <span className="text-sm text-gray-900">{category}</span>
                        </div>
                      );
                    })}
                    {categories.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-gray-500">No categories available</div>
                    )}
                  </div>
                </div>

                <div className="p-3 border-b border-gray-200">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Sources</div>
                  <div className="max-h-24 overflow-y-auto space-y-1">
                    {sources.map((source) => {
                      const checked = filters.sources?.includes(source) || false;
                      return (
                        <div
                          key={source}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleArrayFilter('sources', source)}
                          onKeyDown={(event) => {
                            if (!isToggleKey(event)) return;
                            event.preventDefault();
                            toggleArrayFilter('sources', source);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#F8F8F8]"
                        >
                          <Checkbox checked={checked} className="pointer-events-none rounded-none border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900" />
                          <span className="text-sm text-gray-900 capitalize">{source}</span>
                        </div>
                      );
                    })}
                    {sources.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-gray-500">No sources available</div>
                    )}
                  </div>
                </div>

                <div className="p-3">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Habits</div>
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {habits.map((habit) => {
                      const checked = filters.habits?.includes(habit.id) || false;
                      return (
                        <div
                          key={habit.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleArrayFilter('habits', habit.id)}
                          onKeyDown={(event) => {
                            if (!isToggleKey(event)) return;
                            event.preventDefault();
                            toggleArrayFilter('habits', habit.id);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#F8F8F8]"
                        >
                          <Checkbox checked={checked} className="pointer-events-none rounded-none border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900" />
                          <span className="text-sm text-gray-900 truncate">{habit.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs text-gray-500 hover:text-gray-900"
                >
                  Clear all filters
                </button>
                {hasAnyFilters && (
                  <span className="text-xs text-gray-500">Filters active</span>
                )}
              </div>
          </PopoverContent>
        </Popover>
      </form>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 shadow-sm max-h-64 overflow-y-auto">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.type}-${suggestion.text}-${index}`}
              type="button"
              onClick={() => handleSelectSuggestion(suggestion)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'w-full px-3 py-1.5 text-left text-sm transition-colors',
                selectedIndex === index ? 'text-gray-900 bg-[#F7F7F7]' : 'text-gray-500 hover:text-gray-900',
              )}
            >
              {suggestion.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
