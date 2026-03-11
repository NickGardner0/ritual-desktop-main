'use client';

import React from 'react';
import {
  Search,
  LayoutGrid,
  List,
  Eye,
  EyeOff,
  Filter,
  Plus,
  CheckSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type {
  DueDateFilter,
  EnergyCost,
  KanbanColumn,
  KanbanLabel,
  KanbanVisibility,
} from '@/types/kanban';

interface KanbanHeaderProps {
  boardTitle: string;
  boardSlug: string;
  totalTasks: number;
  completedTasks: number;
  visibility: KanbanVisibility;
  searchText: string;
  onSearchChange: (text: string) => void;
  viewMode: 'board' | 'list';
  onViewModeChange: (mode: 'board' | 'list') => void;
  onVisibilityChange: (value: KanbanVisibility) => void;
  onAddSection: () => void;
  labels: KanbanLabel[];
  columns: KanbanColumn[];
  selectedLabelIds: string[];
  selectedColumnIds: string[];
  selectedEnergy: EnergyCost[];
  selectedDueDateFilters: DueDateFilter[];
  recurringOnly: boolean;
  onToggleLabel: (labelId: string) => void;
  onToggleColumn: (columnId: string) => void;
  onToggleEnergy: (energy: EnergyCost) => void;
  onToggleDueDateFilter: (filter: DueDateFilter) => void;
  onToggleRecurringOnly: () => void;
  onClearFilters: () => void;
}

const energyOptions: { value: EnergyCost; label: string }[] = [
  { value: 'low', label: 'Low energy' },
  { value: 'medium', label: 'Medium energy' },
  { value: 'high', label: 'High energy' },
];

const dueDateOptions: { value: DueDateFilter; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'no-date', label: 'No due date' },
];

export function KanbanHeader({
  boardTitle,
  boardSlug,
  totalTasks,
  completedTasks,
  visibility,
  searchText,
  onSearchChange,
  viewMode,
  onViewModeChange,
  onVisibilityChange,
  onAddSection,
  labels,
  columns,
  selectedLabelIds,
  selectedColumnIds,
  selectedEnergy,
  selectedDueDateFilters,
  recurringOnly,
  onToggleLabel,
  onToggleColumn,
  onToggleEnergy,
  onToggleDueDateFilter,
  onToggleRecurringOnly,
  onClearFilters,
}: KanbanHeaderProps) {
  const activeFilterCount =
    selectedLabelIds.length +
    selectedColumnIds.length +
    selectedEnergy.length +
    selectedDueDateFilters.length +
    (recurringOnly ? 1 : 0);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-[rgba(252,252,251,0.94)] px-6 py-5 backdrop-blur-md">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-medium tracking-[-0.03em] text-[#111827]">
              {boardTitle}
            </h1>
            <div className="inline-flex h-8 items-center rounded-full border border-border bg-white px-3 text-[13px] text-[rgba(39,37,30,0.58)] shadow-sm">
              ritual / tasks / {boardSlug}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-[rgba(39,37,30,0.56)]">
            <span className="inline-flex items-center gap-1.5">
              <CheckSquare className="h-3.5 w-3.5" />
              {totalTasks} items
            </span>
            <span className="text-[rgba(39,37,30,0.24)]">/</span>
            <span>{completedTasks} done</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgba(39,37,30,0.34)]" />
            <Input
              type="text"
              placeholder="Search cards..."
              value={searchText}
              onChange={(event) => onSearchChange(event.target.value)}
              className="h-10 w-[300px] rounded-sm border-border bg-white pl-9 text-[14px] shadow-sm placeholder:text-[rgba(39,37,30,0.34)] focus-visible:ring-0"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-10 rounded-sm border-border bg-white px-3 shadow-sm hover:bg-[#F5F5F2]',
                  activeFilterCount > 0 && 'border-[#27251E] text-[#111827]'
                )}
              >
                <Filter className="h-4 w-4" />
                Filter
                {activeFilterCount > 0 ? (
                  <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[#27251E] px-1.5 text-[11px] text-white">
                    {activeFilterCount}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[260px] rounded-sm border-border">
              <DropdownMenuLabel>Labels</DropdownMenuLabel>
              {labels.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label.id}
                  checked={selectedLabelIds.includes(label.id)}
                  onCheckedChange={() => onToggleLabel(label.id)}
                >
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </DropdownMenuCheckboxItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Lists</DropdownMenuLabel>
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={selectedColumnIds.includes(column.id)}
                  onCheckedChange={() => onToggleColumn(column.id)}
                >
                  {column.title}
                </DropdownMenuCheckboxItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Energy</DropdownMenuLabel>
              {energyOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={selectedEnergy.includes(option.value)}
                  onCheckedChange={() => onToggleEnergy(option.value)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Due date</DropdownMenuLabel>
              {dueDateOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={selectedDueDateFilters.includes(option.value)}
                  onCheckedChange={() => onToggleDueDateFilter(option.value)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={recurringOnly}
                onCheckedChange={onToggleRecurringOnly}
              >
                Recurring only
              </DropdownMenuCheckboxItem>

              {activeFilterCount > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    onClick={onClearFilters}
                    className="flex w-full items-center px-2 py-1.5 text-sm text-[rgba(39,37,30,0.62)] transition-colors hover:bg-[#F7F7F4] hover:text-[#111827]"
                  >
                    Clear filters
                  </button>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-10 rounded-sm border-border bg-white px-3 shadow-sm hover:bg-[#F5F5F2]"
              >
                {visibility === 'shared' ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
                Visibility
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-sm border-border">
              <DropdownMenuRadioGroup value={visibility} onValueChange={(value) => onVisibilityChange(value as KanbanVisibility)}>
                <DropdownMenuRadioItem value="private">Private</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="shared">Shared</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="inline-flex items-center rounded-sm border border-border bg-white shadow-sm">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-10 rounded-none rounded-l-sm px-3 text-[rgba(39,37,30,0.56)] hover:bg-[#F5F5F2] hover:text-[#111827]',
                viewMode === 'list' && 'bg-[#F3F3F0] text-[#111827]'
              )}
              onClick={() => onViewModeChange('list')}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-10 rounded-none rounded-r-sm border-l border-border px-3 text-[rgba(39,37,30,0.56)] hover:bg-[#F5F5F2] hover:text-[#111827]',
                viewMode === 'board' && 'bg-[#F3F3F0] text-[#111827]'
              )}
              onClick={() => onViewModeChange('board')}
              aria-label="Board view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>

          <Button
            size="sm"
            onClick={onAddSection}
            className="h-10 rounded-sm bg-[#111827] px-4 text-white shadow-sm hover:bg-[#27251E]"
          >
            <Plus className="h-4 w-4" />
            New list
          </Button>
        </div>
      </div>
    </header>
  );
}
