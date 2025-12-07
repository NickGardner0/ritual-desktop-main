'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { format, formatISO } from 'date-fns';
import { Search, Filter, X, Calendar as CalendarIcon, Tag, Folder, Activity, Wifi } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { FilterState } from '@/app/(dashboard)/activity/activity-client';

// Placeholder suggestions for the search input
const PLACEHOLDERS = [
  'Search habits or notes...',
  'Completed workouts last week',
  'Skipped habits this month',
  'Sleep logs from Whoop',
  'Morning routines',
];

// Status filter options
const STATUS_OPTIONS = [
  { id: 'completed', label: 'Completed' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'missed', label: 'Missed' },
];

interface Props {
  filters: FilterState;
  onFilterChange: (filters: Partial<FilterState>) => void;
  habits: Array<{ id: string; name: string; category: string }>;
  categories: string[];
  sources: string[];
}

// Filter menu item component
function FilterMenuItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="cursor-pointer">
          <Icon className="mr-2 w-4 h-4" />
          <span>{label}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent
            sideOffset={14}
            alignOffset={-4}
            className="p-0 rounded-none"
          >
            {children}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}

// Active filter badge
function FilterBadge({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <Badge
      variant="secondary"
      className="rounded-none bg-gray-100 text-gray-700 font-normal gap-1 px-2 py-1"
    >
      {label}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="ml-0.5 hover:bg-gray-200 rounded-sm p-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </Badge>
  );
}

export function HabitLogsSearchFilter({
  filters,
  onFilterChange,
  habits,
  categories,
  sources,
}: Props) {
  const [placeholder, setPlaceholder] = useState(PLACEHOLDERS[0]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.q || '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Rotate placeholder text
  useEffect(() => {
    const randomPlaceholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
    setPlaceholder(randomPlaceholder || PLACEHOLDERS[0]);
  }, []);

  // Handle search input change
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
  }, []);

  // Handle search submit
  const handleSearchSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    onFilterChange({ q: searchInput || null });
  }, [searchInput, onFilterChange]);

  // Toggle array filter value
  const toggleArrayFilter = useCallback((
    key: 'categories' | 'habits' | 'statuses' | 'sources',
    value: string
  ) => {
    const current = filters[key] || [];
    const newValues = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    onFilterChange({ [key]: newValues.length > 0 ? newValues : null });
  }, [filters, onFilterChange]);

  // Check if any filters are active (excluding search)
  const hasActiveFilters = 
    filters.start || 
    filters.end || 
    (filters.categories?.length ?? 0) > 0 ||
    (filters.habits?.length ?? 0) > 0 ||
    (filters.statuses?.length ?? 0) > 0 ||
    (filters.sources?.length ?? 0) > 0;

  // Build active filter badges
  const activeFilterBadges: Array<{ label: string; onRemove: () => void }> = [];

  if (filters.start && filters.end) {
    activeFilterBadges.push({
      label: `${format(new Date(filters.start), 'MMM d')} - ${format(new Date(filters.end), 'MMM d')}`,
      onRemove: () => onFilterChange({ start: null, end: null }),
    });
  } else if (filters.start) {
    activeFilterBadges.push({
      label: `From ${format(new Date(filters.start), 'MMM d')}`,
      onRemove: () => onFilterChange({ start: null }),
    });
  } else if (filters.end) {
    activeFilterBadges.push({
      label: `Until ${format(new Date(filters.end), 'MMM d')}`,
      onRemove: () => onFilterChange({ end: null }),
    });
  }

  filters.categories?.forEach(cat => {
    activeFilterBadges.push({
      label: cat,
      onRemove: () => toggleArrayFilter('categories', cat),
    });
  });

  filters.habits?.forEach(habitId => {
    const habit = habits.find(h => h.id === habitId);
    if (habit) {
      activeFilterBadges.push({
        label: habit.name,
        onRemove: () => toggleArrayFilter('habits', habitId),
      });
    }
  });

  filters.statuses?.forEach(status => {
    const option = STATUS_OPTIONS.find(o => o.id === status);
    if (option) {
      activeFilterBadges.push({
        label: option.label,
        onRemove: () => toggleArrayFilter('statuses', status),
      });
    }
  });

  filters.sources?.forEach(source => {
    activeFilterBadges.push({
      label: source,
      onRemove: () => toggleArrayFilter('sources', source),
    });
  });

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1">
        {/* Search Input */}
        <form
          className="relative flex-1 max-w-[350px]"
          onSubmit={handleSearchSubmit}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <Input
            ref={inputRef}
            placeholder={placeholder}
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
          
          {/* Filter Toggle Button */}
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={() => setIsOpen(prev => !prev)}
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity',
                hasActiveFilters && 'opacity-100',
                isOpen && 'opacity-100'
              )}
            >
              <Filter className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
        </form>

        {/* Active Filter Badges */}
        {activeFilterBadges.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeFilterBadges.map((badge, i) => (
              <FilterBadge key={i} label={badge.label} onRemove={badge.onRemove} />
            ))}
            {activeFilterBadges.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-gray-500 hover:text-gray-700"
                onClick={() => onFilterChange({
                  start: null,
                  end: null,
                  categories: null,
                  habits: null,
                  statuses: null,
                  sources: null,
                })}
              >
                Clear all
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Filter Dropdown Content */}
      <DropdownMenuContent
        className="w-[350px] rounded-none"
        align="start"
        sideOffset={8}
        alignOffset={0}
      >
        {/* Date Range Filter */}
        <FilterMenuItem icon={CalendarIcon} label="Date Range">
          <div className="p-2">
            <Calendar
              mode="range"
              selected={{
                from: filters.start ? new Date(filters.start) : undefined,
                to: filters.end ? new Date(filters.end) : undefined,
              }}
              onSelect={(range) => {
                onFilterChange({
                  start: range?.from ? formatISO(range.from, { representation: 'date' }) : null,
                  end: range?.to ? formatISO(range.to, { representation: 'date' }) : null,
                });
              }}
              initialFocus
              className="rounded-none"
            />
          </div>
        </FilterMenuItem>

        {/* Category Filter */}
        <FilterMenuItem icon={Folder} label="Category">
          <div className="max-h-[300px] overflow-y-auto">
            {categories.length > 0 ? (
              categories.map((category) => (
                <DropdownMenuCheckboxItem
                  key={category}
                  checked={filters.categories?.includes(category)}
                  onCheckedChange={() => toggleArrayFilter('categories', category)}
                  className="capitalize cursor-pointer"
                >
                  {category}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">No categories found</div>
            )}
          </div>
        </FilterMenuItem>

        {/* Habit Filter */}
        <FilterMenuItem icon={Tag} label="Habit">
          <div className="max-h-[300px] overflow-y-auto">
            {habits.length > 0 ? (
              habits.map((habit) => (
                <DropdownMenuCheckboxItem
                  key={habit.id}
                  checked={filters.habits?.includes(habit.id)}
                  onCheckedChange={() => toggleArrayFilter('habits', habit.id)}
                  className="cursor-pointer"
                >
                  {habit.name}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">No habits found</div>
            )}
          </div>
        </FilterMenuItem>

        {/* Status Filter */}
        <FilterMenuItem icon={Activity} label="Status">
          {STATUS_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={filters.statuses?.includes(option.id)}
              onCheckedChange={() => toggleArrayFilter('statuses', option.id)}
              className="cursor-pointer"
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </FilterMenuItem>

        {/* Source Filter */}
        <FilterMenuItem icon={Wifi} label="Source">
          <div className="max-h-[200px] overflow-y-auto">
            {sources.length > 0 ? (
              sources.map((source) => (
                <DropdownMenuCheckboxItem
                  key={source}
                  checked={filters.sources?.includes(source)}
                  onCheckedChange={() => toggleArrayFilter('sources', source)}
                  className="capitalize cursor-pointer"
                >
                  {source}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">No sources found</div>
            )}
          </div>
        </FilterMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

