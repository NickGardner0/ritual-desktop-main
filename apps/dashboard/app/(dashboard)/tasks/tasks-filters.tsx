'use client';

import {
  Columns3,
  List,
  ListFilter,
  ListTodo,
  X,
} from 'lucide-react';

import { Button } from '@ritual/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import {
  CATEGORY_FILTERS,
  LIST_LAYOUT_MODES,
  PRIORITY_FILTERS,
  TASK_DISPLAY_MODES,
  TASK_SORTS,
  TASK_VIEWS,
  type ListLayoutMode,
  type TaskDisplayMode,
  type TaskPriorityFilter,
  type TaskSortId,
  type TaskViewId,
} from '@/lib/tasks/task-constants';
import { viewPillClassName } from '@/lib/tasks/task-ui-shell';
import { cn } from '@/lib/utils';

function DisplayModeIcon({ mode }: { mode: TaskDisplayMode }) {
  const className = 'h-3.5 w-3.5';
  if (mode === 'board') return <Columns3 className={className} />;
  if (mode === 'todo') return <ListTodo className={className} />;
  return <List className={className} />;
}

export function TasksCategoryPills({
  category,
  onCategoryChange,
  displayMode,
  onDisplayModeChange,
  layoutMode,
  onLayoutModeChange,
  view,
  onViewChange,
  priorityFilter,
  onPriorityFilterChange,
  sortMode,
  onSortModeChange,
  onClearFilters,
}: {
  category: (typeof CATEGORY_FILTERS)[number];
  onCategoryChange: (category: (typeof CATEGORY_FILTERS)[number]) => void;
  displayMode: TaskDisplayMode;
  onDisplayModeChange: (mode: TaskDisplayMode) => void;
  layoutMode: ListLayoutMode;
  onLayoutModeChange: (mode: ListLayoutMode) => void;
  view: TaskViewId;
  onViewChange: (view: TaskViewId) => void;
  priorityFilter: TaskPriorityFilter;
  onPriorityFilterChange: (priority: TaskPriorityFilter) => void;
  sortMode: TaskSortId;
  onSortModeChange: (sort: TaskSortId) => void;
  onClearFilters: () => void;
}) {
  const hasFilters = view !== 'today' || category !== 'All' || priorityFilter !== 'all';

  return (
    <div className="flex w-full items-center gap-3 pb-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {CATEGORY_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              if (view === 'completed') onViewChange('today');
              onCategoryChange(option);
            }}
            className={viewPillClassName(view !== 'completed' && category === option)}
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            onCategoryChange('All');
            onViewChange('completed');
          }}
          className={viewPillClassName(view === 'completed')}
        >
          Completed
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-compact"
              className={cn(
                'h-7 w-7 text-[var(--icon-default)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]',
                hasFilters && 'bg-[var(--surface-panel)] text-[var(--text-primary)]',
              )}
              aria-label="Filter tasks"
              title="Filter tasks"
            >
              <ListFilter className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filter tasks</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>Scope</span>
                <span className="ml-auto mr-1 text-[11px] text-[var(--text-muted)]">
                  {TASK_VIEWS.find((item) => item.id === view)?.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup value={view} onValueChange={(value) => onViewChange(value as TaskViewId)}>
                  {TASK_VIEWS.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>Priority</span>
                <span className="ml-auto mr-1 text-[11px] text-[var(--text-muted)]">
                  {PRIORITY_FILTERS.find((item) => item.id === priorityFilter)?.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup
                  value={priorityFilter}
                  onValueChange={(value) => onPriorityFilterChange(value as TaskPriorityFilter)}
                >
                  {PRIORITY_FILTERS.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!hasFilters} onSelect={onClearFilters}>
              <X className="h-3.5 w-3.5" />
              Clear filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-compact"
              className="h-7 w-7 text-[var(--icon-default)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
              aria-label="Change task view"
              title="Change task view"
            >
              <DisplayModeIcon mode={displayMode} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Layout</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={displayMode}
              onValueChange={(value) => onDisplayModeChange(value as TaskDisplayMode)}
            >
              {TASK_DISPLAY_MODES.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  <DisplayModeIcon mode={option.id} />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {displayMode !== 'todo' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Grouping</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={layoutMode}
                  onValueChange={(value) => onLayoutModeChange(value as ListLayoutMode)}
                >
                  {LIST_LAYOUT_MODES.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Ordering</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortMode}
              onValueChange={(value) => onSortModeChange(value as TaskSortId)}
            >
              {TASK_SORTS.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
