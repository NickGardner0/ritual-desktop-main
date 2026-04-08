'use client';

import { formatISO, parseISO } from 'date-fns';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  CalendarRange,
  BadgeCheck,
  Layers3,
  AppWindow,
  ClipboardList,
  Bookmark,
  Check,
  X,
} from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  getCategoryFillClass,
  groupCategoriesByLabel,
  normalizeCategoryLabel,
  toggleCategoryGroup,
} from '@/lib/category-token';
import {
  groupSourcesByLabel,
  toggleSourceGroup,
} from '@/lib/source-label';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type {
  BuiltInFilterPresetId,
  FilterState,
  SavedFilterView,
} from '@/app/(dashboard)/activity/logs-client';

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

type AppliedFilterChip = {
  id: string;
  label: string;
  onRemove: () => void;
};

const STATUS_OPTIONS = [
  { id: 'completed', label: 'Completed' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'missed', label: 'Missed' },
] as const;

const DATE_PRESET_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'clear', label: 'Clear range' },
] as const;

function colorFromLabel(label: string) {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = label.charCodeAt(index) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360} 55% 48%)`;
}

function toLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatDateRangeLabel(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end && start === end) return formatDateLabel(start);
  if (start && end) return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
  if (start) return `From ${formatDateLabel(start)}`;
  return end ? `Until ${formatDateLabel(end)}` : null;
}

function updateArrayFilter(
  value: string,
  currentValues: string[] | null | undefined,
  onFilterChange: (filters: Partial<FilterState>) => void,
  key: ArrayFilterKey,
) {
  const normalizedValues = currentValues ?? null;
  const nextValues = normalizedValues?.includes(value)
    ? normalizedValues.filter((item) => item !== value).length > 0
      ? normalizedValues.filter((item) => item !== value)
      : null
    : [...(normalizedValues ?? []), value];

  onFilterChange({ [key]: nextValues } as Partial<FilterState>);
}

function SearchableList({
  items,
  placeholder,
  selectedValues,
  onToggle,
}: {
  items: Array<{
    id: string;
    label: string;
    color?: string;
    fillClass?: string;
    rawValues?: string[];
  }>;
  placeholder: string;
  selectedValues: string[] | null | undefined;
  onToggle: (item: {
    id: string;
    label: string;
    color?: string;
    fillClass?: string;
    rawValues?: string[];
  }) => void;
}) {
  const [query, setQuery] = useState('');

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const normalizedQuery = query.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(normalizedQuery));
  }, [items, query]);

  return (
    <div className="w-[260px]">
      <div className="border-b border-black/10 p-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="h-8 rounded-none border-black/10 px-3 text-xs focus-visible:border-neutral-300 focus-visible:ring-0"
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto p-1">
        {filteredItems.length > 0 ? (
          filteredItems.map((item) => {
            const checked = item.rawValues
              ? item.rawValues.some((value) => selectedValues?.includes(value))
              : selectedValues?.includes(item.id) || false;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-neutral-900 transition-colors hover:bg-[#F5F5F5]',
                  checked && 'bg-[#F5F5F5]',
                )}
              >
                <span
                  className={cn('h-2.5 w-2.5 shrink-0 rounded-none', item.fillClass)}
                  style={item.color ? { backgroundColor: item.color } : undefined}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {checked ? <Check className="h-3.5 w-3.5 text-neutral-900" /> : null}
              </button>
            );
          })
        ) : (
          <div className="px-3 py-2 text-[13px] text-neutral-500">No results found.</div>
        )}
      </div>
    </div>
  );
}

function FilterMenuItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="px-2 py-1.5 text-sm text-neutral-950 focus:bg-[#F5F5F5] data-[state=open]:bg-[#F5F5F5]">
          <Icon className="mr-2 h-4 w-4 stroke-[1.75] text-neutral-950" />
          <span>{label}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent
            sideOffset={14}
            alignOffset={-4}
            className="rounded-none border border-black/10 bg-white p-0 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
          >
            {children}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}

function FilterCheckboxItem({
  checked,
  label,
  onCheckedChange,
  className,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: () => void;
  className?: string;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
      className={cn(
        'rounded-none py-2 pl-4 pr-10 text-[13px] text-neutral-900 focus:bg-[#F5F5F5]',
        className,
      )}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
}

function InlineDateRangeFilter({
  start,
  end,
  onSelect,
}: {
  start: string | null | undefined;
  end: string | null | undefined;
  onSelect: (range: { start: string | null; end: string | null }) => void;
}) {
  return (
    <div className="flex w-fit max-w-[calc(100vw-120px)] flex-col bg-white">
      <div className="border-b border-black/10 p-3">
        <Select
          onValueChange={(value) => {
            const now = new Date();

            if (value === 'clear') {
              onSelect({ start: null, end: null });
              return;
            }

            if (value === 'today') {
              const today = formatISO(now, { representation: 'date' });
              onSelect({ start: today, end: today });
              return;
            }

            if (value === 'yesterday') {
              const yesterday = new Date(now);
              yesterday.setDate(yesterday.getDate() - 1);
              const day = formatISO(yesterday, { representation: 'date' });
              onSelect({ start: day, end: day });
              return;
            }

            const daysBack = value === '7d' ? 7 : value === '30d' ? 30 : 90;
            const from = new Date(now);
            from.setDate(from.getDate() - daysBack);

            onSelect({
              start: formatISO(from, { representation: 'date' }),
              end: formatISO(now, { representation: 'date' }),
            });
          }}
        >
          <SelectTrigger className="h-8 w-[240px] rounded-none border-black/10 text-xs focus:ring-0 focus:ring-offset-0">
            <SelectValue placeholder="Select preset" />
          </SelectTrigger>
          <SelectContent className="rounded-none border-black/10">
            {DATE_PRESET_OPTIONS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id} className="text-[13px]">
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Calendar
        mode="range"
        initialFocus
        numberOfMonths={2}
        toDate={new Date()}
        defaultMonth={start ? parseISO(start) : new Date()}
        selected={{
          from: start ? parseISO(start) : undefined,
          to: end ? parseISO(end) : undefined,
        }}
        onSelect={(range) => {
          if (!range) return;

          onSelect({
            start: range.from ? formatISO(range.from, { representation: 'date' }) : null,
            end: range.to ? formatISO(range.to, { representation: 'date' }) : null,
          });
        }}
        className="w-fit p-3"
        classNames={{
          months: 'flex flex-col gap-4 md:flex-row md:gap-5',
          month: 'w-[264px] space-y-3',
          caption: 'relative flex h-9 items-center justify-center px-9 pt-0',
          caption_label: 'text-sm font-medium text-neutral-950',
          nav: 'absolute inset-x-0 top-0 flex h-9 items-center justify-between',
          nav_button:
            'flex h-7 w-7 items-center justify-center rounded-none border border-black/10 bg-white p-0 opacity-100 hover:bg-[#F5F5F5]',
          nav_button_previous: 'absolute left-0 top-1',
          nav_button_next: 'absolute right-0 top-1',
          head_row: 'flex',
          head_cell: 'w-8 text-[0.8rem] font-normal text-[#7C7C7C]',
          row: 'mt-2 flex w-full',
          cell:
            'h-8 w-8 p-0 text-center text-sm [&:has([aria-selected].day-range-end)]:rounded-none [&:has([aria-selected].day-outside)]:bg-[#DCDCDC]/50 [&:has([aria-selected])]:bg-[#E7E7E7] first:[&:has([aria-selected])]:rounded-none last:[&:has([aria-selected])]:rounded-none',
          day: 'h-8 w-8 rounded-none p-0 text-sm font-normal text-neutral-950 hover:bg-[#F1F1F1] aria-selected:opacity-100',
          day_selected:
            'bg-[#DCDCDC] text-neutral-950 hover:bg-[#DCDCDC] hover:text-neutral-950 focus:bg-[#DCDCDC] focus:text-neutral-950',
          day_today: 'bg-transparent text-neutral-950',
          day_outside: 'text-[#B4B4B4] aria-selected:bg-[#DCDCDC]/50',
          day_disabled: 'text-[#D0D0D0]',
          day_range_middle: 'bg-[#E7E7E7] text-neutral-950',
        }}
      />
    </div>
  );
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
    setSearchInput(filters.q || '');
  }, [filters.q]);

  const hasAnyFilters = useMemo(() => {
    if (filters.q) return true;
    if (filters.start || filters.end) return true;

    return (
      (filters.categories?.length || 0) > 0 ||
      (filters.habits?.length || 0) > 0 ||
      (filters.statuses?.length || 0) > 0 ||
      (filters.sources?.length || 0) > 0
    );
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.start || filters.end) count += 1;
    if (filters.q) count += 1;
    count += groupCategoriesByLabel(filters.categories || []).length;
    count += filters.habits?.length || 0;
    count += filters.statuses?.length || 0;
    count += groupSourcesByLabel(filters.sources || []).length;
    return count;
  }, [filters]);

  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedIndex(-1);
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
  }, [clearAllFilters, searchInput]);

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
          habitSuggestions = (data.hits || []).map((habit: any) => ({
            type: 'habit' as const,
            text: habit.name,
            id: habit.id,
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
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(event.target.value);
    setShowSuggestions(true);
    setSelectedIndex(-1);
  }, []);

  const handleSearchSubmit = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      setShowSuggestions(false);
      onFilterChange({ q: searchInput || null });
    },
    [onFilterChange, searchInput],
  );

  const handleSaveView = useCallback(() => {
    const trimmed = viewNameInput.trim();
    if (!trimmed) return;
    onSaveCurrentView(trimmed);
    setViewNameInput('');
  }, [onSaveCurrentView, viewNameInput]);

  const handleSelectSuggestion = useCallback(
    (suggestion: Suggestion) => {
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
    },
    [onFilterChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!showSuggestions || suggestions.length === 0) {
        if (event.key === 'Enter') handleSearchSubmit();
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, -1));
          break;
        case 'Enter':
          event.preventDefault();
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
            event.preventDefault();
            handleSelectSuggestion(suggestions[selectedIndex]);
          }
          break;
        default:
          break;
      }
    },
    [handleSearchSubmit, handleSelectSuggestion, selectedIndex, showSuggestions, suggestions],
  );

  const habitNameById = useMemo(() => new Map(habits.map((habit) => [habit.id, habit.name])), [habits]);
  const categoryItems = useMemo(
    () =>
      groupCategoriesByLabel(categories).map((group) => ({
        id: group.id,
        label: group.label,
        rawValues: group.rawValues,
        fillClass: getCategoryFillClass(group.rawValues[0]),
      })),
    [categories],
  );
  const sourceItems = useMemo(
    () =>
      groupSourcesByLabel(sources).map((group) => ({
        id: group.id,
        label: group.label,
        rawValues: group.rawValues,
        color: colorFromLabel(group.label),
      })),
    [sources],
  );
  const habitItems = useMemo(
    () =>
      habits.map((habit) => ({
        id: habit.id,
        label: habit.name,
        color: colorFromLabel(habit.category || habit.name),
      })),
    [habits],
  );

  const appliedFilterChips = useMemo<AppliedFilterChip[]>(() => {
    const chips: AppliedFilterChip[] = [];

    if (filters.q) {
      chips.push({
        id: 'q',
        label: `Search: ${filters.q}`,
        onRemove: () => {
          setSearchInput('');
          onFilterChange({ q: null });
        },
      });
    }

    const dateRangeLabel = formatDateRangeLabel(filters.start, filters.end);
    if (dateRangeLabel) {
      chips.push({
        id: 'date-range',
        label: dateRangeLabel,
        onRemove: () => onFilterChange({ start: null, end: null }),
      });
    }

    (filters.statuses || []).forEach((status) => {
      chips.push({
        id: `status-${status}`,
        label: STATUS_OPTIONS.find((option) => option.id === status)?.label || normalizeCategoryLabel(status),
        onRemove: () => updateArrayFilter(status, filters.statuses, onFilterChange, 'statuses'),
      });
    });

    groupCategoriesByLabel(filters.categories || []).forEach((group) => {
      chips.push({
        id: `category-${group.id}`,
        label: group.label,
        onRemove: () => {
          const nextValues = (filters.categories || []).filter((value) => !group.rawValues.includes(value));
          onFilterChange({ categories: nextValues.length > 0 ? nextValues : null });
        },
      });
    });

    groupSourcesByLabel(filters.sources || []).forEach((group) => {
      chips.push({
        id: `source-${group.id}`,
        label: group.label,
        onRemove: () => {
          const nextValues = (filters.sources || []).filter((value) => !group.rawValues.includes(value));
          onFilterChange({ sources: nextValues.length > 0 ? nextValues : null });
        },
      });
    });

    (filters.habits || []).forEach((habitId) => {
      chips.push({
        id: `habit-${habitId}`,
        label: habitNameById.get(habitId) || 'Habit',
        onRemove: () => updateArrayFilter(habitId, filters.habits, onFilterChange, 'habits'),
      });
    });

    return chips;
  }, [filters, habitNameById, onFilterChange]);

  return (
    <div ref={containerRef} className="relative w-full max-w-[350px]">
      <DropdownMenu open={isFilterOpen} onOpenChange={setIsFilterOpen}>
        <form onSubmit={handleSearchSubmit} className="relative">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-4 top-[10px] h-4 w-4 fill-current text-neutral-700"
          >
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <Input
            ref={inputRef}
            placeholder="Search habits, logs, notes..."
            className="h-9 w-full rounded-sm border-black/10 pl-10 pr-9 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:border-neutral-300 focus-visible:ring-0"
            value={searchInput}
            onChange={handleSearchChange}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />

          {isLoading ? (
            <BrailleSpinner className="absolute right-10 top-[9px] text-sm text-neutral-400" />
          ) : null}

          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'absolute right-3 top-[9px] z-10 text-neutral-900 opacity-60 transition-opacity duration-200 hover:opacity-100',
                hasAnyFilters && 'opacity-100',
                isFilterOpen && 'opacity-100',
              )}
              aria-label="Filters"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-current"
              >
                <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
              </svg>
            </button>
          </DropdownMenuTrigger>
        </form>

        <DropdownMenuContent
          className="w-[350px] rounded-none border-black/10 p-1 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
          align="end"
          sideOffset={14}
          alignOffset={-11}
        >
          <FilterMenuItem icon={Bookmark} label="Views">
            <div className="w-[320px] space-y-3 p-4">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                  Built-in
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {builtInPresets.map((preset) => {
                    const isActive = activeViewId === `preset:${preset.id}`;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onApplyPreset(preset.id)}
                        className={cn(
                          'rounded-none border px-3 py-1.5 text-left text-[12px] transition-colors',
                          isActive
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-black/10 text-neutral-800 hover:bg-[#F5F5F5]',
                        )}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                  Saved
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {savedViews.length > 0 ? (
                    savedViews.map((view) => {
                      const isActive = activeViewId === view.id;
                      return (
                        <div
                          key={view.id}
                          className={cn(
                            'flex items-center gap-2 border px-2 py-1.5',
                            isActive ? 'border-neutral-300 bg-[#F7F7F7]' : 'border-black/10',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onApplySavedView(view.id)}
                          className="min-w-0 flex-1 truncate text-left text-[12px] text-neutral-800"
                        >
                          {view.name}
                        </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSavedView(view.id)}
                            className="inline-flex h-6 w-6 items-center justify-center text-neutral-500 transition-colors hover:bg-[#F5F5F5] hover:text-neutral-900"
                            aria-label={`Delete ${view.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-[13px] text-neutral-500">No saved views yet.</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={viewNameInput}
                  onChange={(event) => setViewNameInput(event.target.value)}
                  placeholder="Save current view"
                  className="h-8 rounded-none border-black/10 text-[12px] focus-visible:border-neutral-300 focus-visible:ring-0"
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
                  className="inline-flex h-8 items-center gap-1.5 border border-black/10 px-3 text-[12px] text-neutral-800 transition-colors hover:bg-[#F5F5F5]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Save
                </button>
              </div>
            </div>
          </FilterMenuItem>

          <FilterMenuItem icon={CalendarRange} label="Date">
            <InlineDateRangeFilter
              start={filters.start}
              end={filters.end}
              onSelect={(range) => onFilterChange(range)}
            />
          </FilterMenuItem>

          <FilterMenuItem icon={BadgeCheck} label="Status">
            <div className="max-h-[320px] overflow-y-auto p-1">
              {STATUS_OPTIONS.map((status) => (
                <FilterCheckboxItem
                  key={status.id}
                  checked={filters.statuses?.includes(status.id) || false}
                  label={status.label}
                  onCheckedChange={() =>
                    updateArrayFilter(status.id, filters.statuses, onFilterChange, 'statuses')
                  }
                />
              ))}
            </div>
          </FilterMenuItem>

          <FilterMenuItem icon={Layers3} label="Categories">
            <SearchableList
              items={categoryItems}
              placeholder="Search category"
              selectedValues={filters.categories}
              onToggle={(item) =>
                onFilterChange({
                  categories: toggleCategoryGroup(item.rawValues ?? [item.id], filters.categories),
                })
              }
            />
          </FilterMenuItem>

          <FilterMenuItem icon={AppWindow} label="Sources">
            <SearchableList
              items={sourceItems}
              placeholder="Search source"
              selectedValues={filters.sources}
              onToggle={(item) =>
                onFilterChange({
                  sources: toggleSourceGroup(item.rawValues ?? [item.id], filters.sources),
                })
              }
            />
          </FilterMenuItem>

          <FilterMenuItem icon={ClipboardList} label="Habits">
            <SearchableList
              items={habitItems}
              placeholder="Search habit"
              selectedValues={filters.habits}
              onToggle={(item) => updateArrayFilter(item.id, filters.habits, onFilterChange, 'habits')}
            />
          </FilterMenuItem>

          <DropdownMenuSeparator className="mx-0 my-0 bg-black/10" />

          <button
            type="button"
            onClick={clearAllFilters}
            className="flex w-full items-center justify-between px-4 py-2.5 text-[13px] text-neutral-800 transition-colors hover:bg-[#F5F5F5]"
          >
            <span>Clear all filters</span>
            {hasAnyFilters ? <span className="text-[12px] text-neutral-400">{activeFilterCount} active</span> : null}
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      {appliedFilterChips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {appliedFilterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1.5 border border-black/10 bg-white px-2.5 py-1 text-[12px] text-neutral-600 transition-colors hover:bg-[#F5F5F5] hover:text-neutral-900"
            >
              <span className="max-w-[180px] truncate">{chip.label}</span>
              <X className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      ) : null}

      {showSuggestions && suggestions.length > 0 ? (
        <div className="absolute z-50 mt-2 w-full border border-black/10 bg-white p-1 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.type}-${suggestion.text}-${index}`}
              type="button"
              onClick={() => handleSelectSuggestion(suggestion)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-[14px] transition-colors',
                selectedIndex === index
                  ? 'bg-[#F5F5F5] text-neutral-900'
                  : 'text-neutral-700 hover:bg-[#F5F5F5] hover:text-neutral-900',
              )}
            >
              {suggestion.type === 'habit' ? (
                <ClipboardList className="mr-2 h-4 w-4 stroke-[1.75] text-neutral-700" />
              ) : (
                <CalendarRange className="mr-2 h-4 w-4 stroke-[1.75] text-neutral-700" />
              )}
              <span>{suggestion.text}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
