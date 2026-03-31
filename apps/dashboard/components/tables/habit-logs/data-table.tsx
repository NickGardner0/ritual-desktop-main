'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Check,
  Info,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import {
  SelectCell,
  DateCell,
  TimeCell,
  HabitCell,
  ValueCell,
  CategoryCell,
  SourceCell,
  NotesCell,
} from './columns';
import type { HabitLog, TableDensity } from '@/app/(dashboard)/activity/logs-client';

// ── Types ──────────────────────────────────────────────────

interface DataTableProps {
  logs: HabitLog[];
  rowSelection: Record<string, boolean>;
  onRowSelectionChange: (selection: Record<string, boolean>) => void;
  columnVisibility: Record<string, boolean>;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
  hasFilters: boolean;
  totals: {
    count: number;
    totalDuration: number;
    totalAmount: number;
    completedCount: number;
    completionRate: number;
  } | null;
  isLoading: boolean;
  availableSources: string[];
  onQuickEdit: (
    log: HabitLog,
    updates: Partial<Pick<HabitLog, 'status' | 'date' | 'integration_source' | 'completed_at'>>,
  ) => void;
  updatingLogIds: Record<string, boolean>;
  density: TableDensity;
  onRowClick?: (log: HabitLog) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isFetchingMore?: boolean;
}

type ColumnAlign = 'left' | 'center' | 'right';

interface ColumnLayoutMeta {
  sticky?: boolean;
  stickyRight?: boolean;
  align: ColumnAlign;
  resizable: boolean;
  sortable: boolean;
  hideIndicator?: boolean;
}

interface HabitLogTableMeta {
  density: TableDensity;
  sourceOptions: string[];
  onQuickEdit: DataTableProps['onQuickEdit'];
  updatingLogIds: Record<string, boolean>;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
  allSelected: boolean;
  someSelected: boolean;
  toggleAllRows: (value: boolean) => void;
  toggleRow: (id: string, value: boolean) => void;
  handleShiftClickRange: (start: number, end: number) => void;
  lastClickedIndex: number | null;
  setLastClickedIndex: (index: number) => void;
  setActiveRowIndex: (index: number) => void;
  rowSelection: Record<string, boolean>;
}

// ── Constants ──────────────────────────────────────────────

const COLUMN_RESIZE_STORAGE_KEY = 'ritual:logs:column-widths:v5';
const COLUMN_ORDER_STORAGE_KEY = 'ritual:logs:column-order:v1';

const DEFAULT_COLUMN_ORDER = ['select', 'date', 'time', 'habit', 'value', 'category', 'source', 'notes'];
const LEFT_STICKY_COLUMNS = ['select', 'date'];
const PINNED_COLUMNS = new Set(['select']);

const COLUMN_LAYOUT: Record<string, ColumnLayoutMeta> = {
  select: { sticky: true, align: 'center', resizable: false, sortable: false },
  date: { sticky: true, align: 'left', resizable: true, sortable: true, hideIndicator: true },
  time: { align: 'left', resizable: true, sortable: true, hideIndicator: true },
  habit: { align: 'left', resizable: true, sortable: true },
  value: { align: 'left', resizable: true, sortable: true },
  category: { align: 'left', resizable: true, sortable: true },
  source: { align: 'left', resizable: true, sortable: true },
  notes: { align: 'left', resizable: false, sortable: false },
};

const COLUMN_SIZES: Record<string, { size: number; minSize: number; maxSize: number }> = {
  select: { size: 40, minSize: 40, maxSize: 40 },
  date: { size: 110, minSize: 90, maxSize: 200 },
  time: { size: 110, minSize: 80, maxSize: 200 },
  habit: { size: 240, minSize: 140, maxSize: 500 },
  value: { size: 160, minSize: 100, maxSize: 280 },
  category: { size: 155, minSize: 100, maxSize: 300 },
  source: { size: 140, minSize: 90, maxSize: 300 },
  notes: { size: 195, minSize: 120, maxSize: 400 },
};

// ── TanStack Column Definitions ────────────────────────────

const tableColumns: ColumnDef<HabitLog>[] = [
  {
    id: 'select',
    ...COLUMN_SIZES.select,
    enableResizing: false,
    header: ({ table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      return (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={meta.allSelected || (meta.someSelected && 'indeterminate')}
            onCheckedChange={meta.toggleAllRows}
            className="rounded-none border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
          />
        </div>
      );
    },
    cell: ({ row, table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      const log = row.original;
      const isSelected = meta.rowSelection[log.id] || false;
      return (
        <SelectCell
          checked={isSelected}
          onChange={(value) => {
            meta.toggleRow(log.id, value);
            meta.setLastClickedIndex(row.index);
            meta.setActiveRowIndex(row.index);
          }}
          onShiftClick={() => {
            if (meta.lastClickedIndex !== null) {
              meta.handleShiftClickRange(meta.lastClickedIndex, row.index);
            }
            meta.setLastClickedIndex(row.index);
            meta.setActiveRowIndex(row.index);
          }}
        />
      );
    },
  },
  {
    id: 'date',
    accessorKey: 'date',
    ...COLUMN_SIZES.date,
    header: ({ table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      return (
        <SortButton
          column="date"
          sortColumn={meta.sortColumn}
          sortDirection={meta.sortDirection}
          align="left"
          onSort={meta.onSort}
          hideIndicator
        >
          Date
        </SortButton>
      );
    },
    cell: ({ row, table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      const log = row.original;
      return (
        <InlineDateEditor
          date={log.date}
          density={meta.density}
          isUpdating={Boolean(meta.updatingLogIds[log.id])}
          onSave={(nextDate) => meta.onQuickEdit(log, { date: nextDate })}
        />
      );
    },
  },
  {
    id: 'time',
    accessorKey: 'completed_at',
    ...COLUMN_SIZES.time,
    header: ({ table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      return (
        <SortButton
          column="time"
          sortColumn={meta.sortColumn}
          sortDirection={meta.sortDirection}
          align="left"
          onSort={meta.onSort}
          hideIndicator
        >
          Time
        </SortButton>
      );
    },
    cell: ({ row }) => <TimeCell completedAt={row.original.completed_at} />,
  },
  {
    id: 'habit',
    accessorKey: 'habit_name',
    ...COLUMN_SIZES.habit,
    header: ({ table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      return (
        <SortButton
          column="habit"
          sortColumn={meta.sortColumn}
          sortDirection={meta.sortDirection}
          align="left"
          onSort={meta.onSort}
        >
          Name
        </SortButton>
      );
    },
    cell: ({ row }) => <HabitCell habitName={row.original.habit_name} icon={row.original.icon} />,
  },
  {
    id: 'value',
    ...COLUMN_SIZES.value,
    header: ({ table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      return (
        <SortButton
          column="value"
          sortColumn={meta.sortColumn}
          sortDirection={meta.sortDirection}
          align="left"
          onSort={meta.onSort}
        >
          Value
        </SortButton>
      );
    },
    cell: ({ row }) => (
      <ValueCell
        duration={row.original.duration}
        amount={row.original.amount}
        unitType={row.original.unit_type}
      />
    ),
  },
  {
    id: 'category',
    accessorKey: 'category',
    ...COLUMN_SIZES.category,
    header: ({ table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      return (
        <SortButton
          column="category"
          sortColumn={meta.sortColumn}
          sortDirection={meta.sortDirection}
          align="left"
          onSort={meta.onSort}
        >
          Category
        </SortButton>
      );
    },
    cell: ({ row }) => <CategoryCell category={row.original.category} />,
  },
  {
    id: 'source',
    accessorKey: 'integration_source',
    ...COLUMN_SIZES.source,
    header: ({ table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      return (
        <SortButton
          column="source"
          sortColumn={meta.sortColumn}
          sortDirection={meta.sortDirection}
          align="left"
          onSort={meta.onSort}
        >
          Source
        </SortButton>
      );
    },
    cell: ({ row, table }) => {
      const meta = table.options.meta as HabitLogTableMeta;
      const log = row.original;
      return (
        <InlineSourceEditor
          source={log.integration_source}
          habitName={log.habit_name}
          sourceOptions={meta.sourceOptions}
          density={meta.density}
          isUpdating={Boolean(meta.updatingLogIds[log.id])}
          onSelect={(nextSource) => meta.onQuickEdit(log, { integration_source: nextSource })}
        />
      );
    },
  },
  {
    id: 'notes',
    accessorKey: 'notes',
    ...COLUMN_SIZES.notes,
    header: () => (
      <span className="block truncate text-[14px] font-normal tracking-normal text-neutral-700">
        Notes
      </span>
    ),
    cell: ({ row }) => <NotesCell notes={row.original.notes} />,
  },
];

// ── localStorage Helpers ───────────────────────────────────

function readStoredColumnWidths(): Record<string, number> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(COLUMN_RESIZE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, number>;
    const next: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const sizes = COLUMN_SIZES[key];
      if (!sizes || !Number.isFinite(value)) continue;
      const clamped = Math.max(sizes.minSize, Math.min(sizes.maxSize, value));
      if (clamped !== sizes.size) {
        next[key] = clamped;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function readStoredColumnOrder(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(COLUMN_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Ensure all columns are included (safety net for new columns)
    const inOrder = new Set(parsed);
    const result = [...parsed];
    for (const id of DEFAULT_COLUMN_ORDER) {
      if (!inOrder.has(id)) result.push(id);
    }
    return result;
  } catch {
    return null;
  }
}

// ── Helper Components ──────────────────────────────────────

function SortableHeaderCell({
  columnId,
  children,
  className,
  style,
}: {
  columnId: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isPinned = PINNED_COLUMNS.has(columnId);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnId,
    disabled: isPinned,
  });

  const dragStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 40 : (style?.zIndex as number | undefined),
    cursor: isPinned ? 'default' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      role="columnheader"
      className={className}
      style={dragStyle}
      {...(isPinned ? {} : { ...attributes, ...listeners })}
    >
      {children}
    </div>
  );
}

function SortButton({
  column,
  sortColumn,
  sortDirection,
  align,
  onSort,
  hideIndicator = false,
  children,
}: {
  column: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  align: ColumnAlign;
  onSort: (column: string) => void;
  hideIndicator?: boolean;
  children: React.ReactNode;
}) {
  const isActive = sortColumn === column;

  return (
    <Button
      variant="ghost"
      className={cn(
        'flex h-auto w-full items-center gap-1 p-0 text-[14px] font-normal tracking-normal text-neutral-700 hover:bg-transparent hover:text-neutral-900',
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start',
      )}
      onClick={() => onSort(column)}
    >
      <span className="truncate">{children}</span>
      {isActive && !hideIndicator ? (
        sortDirection === 'asc' ? (
          <ArrowUp className="w-3 h-3 text-gray-500" />
        ) : (
          <ArrowDown className="w-3 h-3 text-gray-500" />
        )
      ) : null}
    </Button>
  );
}

function InlineDateEditor({
  date,
  density,
  isUpdating,
  onSave,
}: {
  date: string;
  density: TableDensity;
  isUpdating: boolean;
  onSave: (nextDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(date);
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setDraftDate(date);
    }
  }, [date]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'group inline-flex w-full min-w-0 items-center justify-between gap-2 text-left text-sm text-gray-700 hover:text-gray-900',
            density === 'compact' ? 'h-6' : 'h-7',
          )}
          disabled={isUpdating}
        >
          <span className="min-w-0 truncate block">
            <DateCell date={date} />
          </span>
          {isUpdating ? (
            <BrailleSpinner className="text-sm text-gray-500" />
          ) : (
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 shrink-0 text-gray-400 transition-opacity',
                open ? 'opacity-70' : 'opacity-0 group-hover:opacity-70',
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[220px] rounded-sm border border-black/10 bg-white p-2 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-2">
          <input
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
            className="h-8 w-full rounded-sm border border-black/10 bg-white px-3 text-sm outline-none"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 rounded-sm border border-black/10 px-3 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!draftDate || draftDate === date) {
                  setOpen(false);
                  return;
                }
                onSave(draftDate);
                setOpen(false);
              }}
              disabled={isUpdating || !draftDate}
              className="h-7 rounded-sm border border-neutral-900 bg-neutral-900 px-3 text-xs text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function InlineSourceEditor({
  source,
  habitName,
  sourceOptions,
  density,
  isUpdating,
  onSelect,
}: {
  source?: string;
  habitName?: string;
  sourceOptions: string[];
  density: TableDensity;
  isUpdating: boolean;
  onSelect: (nextSource: string) => void;
}) {
  const currentSource = source || 'manual';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'group inline-flex w-full min-w-0 items-center justify-between gap-2 text-left text-gray-700 hover:text-gray-900',
            density === 'compact' ? 'h-6' : 'h-7',
          )}
          disabled={isUpdating}
        >
          <span className="min-w-0">
            <SourceCell source={currentSource} habitName={habitName} />
          </span>
          {isUpdating ? (
            <BrailleSpinner className="text-sm text-gray-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-70" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[190px] rounded-sm border border-black/10 bg-white p-1 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.35)]"
      >
        {sourceOptions.map((option) => (
          <DropdownMenuItem
            key={option}
            className="rounded-sm"
            onClick={() => {
              if (option !== currentSource) {
                onSelect(option);
              }
            }}
          >
            <span className="flex-1 capitalize text-sm text-gray-900">{option}</span>
            {option === currentSource && <Check className="w-3.5 h-3.5 text-gray-700" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Main Component ─────────────────────────────────────────

export function HabitLogsDataTable({
  logs,
  rowSelection,
  onRowSelectionChange,
  columnVisibility,
  sortColumn,
  sortDirection,
  onSort,
  hasFilters,
  totals,
  isLoading,
  availableSources,
  onQuickEdit,
  updatingLogIds,
  density,
  onRowClick,
  onLoadMore,
  hasMore,
  isFetchingMore,
}: DataTableProps) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(readStoredColumnWidths);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const stored = readStoredColumnOrder();
    return stored || DEFAULT_COLUMN_ORDER;
  });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const rowHeight = density === 'compact' ? 34 : 38;

  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => rowHeight,
    overscan: 15,
  });

  // Horizontal scroll state for scroll indicators
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = viewport;
      setCanScrollLeft(scrollLeft > 2);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
    };

    updateScrollState();
    viewport.addEventListener('scroll', updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(viewport);

    return () => {
      viewport.removeEventListener('scroll', updateScrollState);
      observer.disconnect();
    };
  }, [logs.length]);

  // Infinite scroll: load more when near bottom
  useEffect(() => {
    if (!onLoadMore || !hasMore || isFetchingMore) return;
    const virtualItems = rowVirtualizer.getVirtualItems();
    const lastItem = virtualItems[virtualItems.length - 1];
    if (lastItem && lastItem.index >= logs.length - 10) {
      onLoadMore();
    }
  }, [rowVirtualizer.getVirtualItems(), logs.length, onLoadMore, hasMore, isFetchingMore]);

  const scrollHorizontal = useCallback((direction: 'left' | 'right') => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: viewport.scrollLeft + (direction === 'right' ? 250 : -250),
      behavior: 'smooth',
    });
  }, []);

  const sourceOptions = useMemo(() => {
    const unique = new Set<string>(['manual', ...availableSources.map((source) => source || 'manual')]);
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [availableSources]);

  const allSelected = logs.length > 0 && logs.every((log) => rowSelection[log.id]);
  const someSelected = logs.some((log) => rowSelection[log.id]) && !allSelected;

  const toggleAllRows = useCallback((value: boolean) => {
    if (value) {
      const nextSelection: Record<string, boolean> = {};
      logs.forEach((log) => {
        nextSelection[log.id] = true;
      });
      onRowSelectionChange(nextSelection);
      return;
    }
    onRowSelectionChange({});
  }, [logs, onRowSelectionChange]);

  const toggleRow = useCallback((id: string, value: boolean) => {
    const nextSelection = { ...rowSelection };
    if (value) {
      nextSelection[id] = true;
    } else {
      delete nextSelection[id];
    }
    onRowSelectionChange(nextSelection);
  }, [onRowSelectionChange, rowSelection]);

  const handleShiftClickRange = useCallback((startIndex: number, endIndex: number) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const nextSelection = { ...rowSelection };
    for (let index = start; index <= end; index++) {
      const log = logs[index];
      if (log) nextSelection[log.id] = true;
    }
    onRowSelectionChange(nextSelection);
  }, [logs, onRowSelectionChange, rowSelection]);

  // ── TanStack Table ─────────────────────────────────────

  const tableMeta: HabitLogTableMeta = useMemo(() => ({
    density,
    sourceOptions,
    onQuickEdit,
    updatingLogIds,
    sortColumn,
    sortDirection,
    onSort,
    allSelected,
    someSelected,
    toggleAllRows,
    toggleRow,
    handleShiftClickRange,
    lastClickedIndex,
    setLastClickedIndex,
    setActiveRowIndex,
    rowSelection,
  }), [
    density, sourceOptions, onQuickEdit, updatingLogIds, sortColumn, sortDirection,
    onSort, allSelected, someSelected, toggleAllRows, toggleRow, handleShiftClickRange,
    lastClickedIndex, rowSelection,
  ]);

  const table = useReactTable({
    data: logs,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
    state: {
      columnVisibility,
      columnOrder,
    },
    onColumnOrderChange: setColumnOrder,
    meta: tableMeta,
  });

  const headerGroup = table.getHeaderGroups()[0];
  const tableRows = table.getRowModel().rows;

  // ── Column Width & Sticky Helpers ──────────────────────

  const getColumnWidth = useCallback((columnId: string) => {
    if (columnWidths[columnId]) return columnWidths[columnId];
    return COLUMN_SIZES[columnId]?.size ?? 120;
  }, [columnWidths]);

  const getStickyStyle = useCallback((columnId: string): CSSProperties => {
    const width = getColumnWidth(columnId);
    const base: CSSProperties = { width, minWidth: width, maxWidth: width };
    const layout = COLUMN_LAYOUT[columnId];
    if (!layout) return base;

    if (layout.stickyRight) {
      return { ...base, position: 'sticky', right: 0, zIndex: 18 };
    }

    if (!layout.sticky) return base;

    const stickyIndex = LEFT_STICKY_COLUMNS.indexOf(columnId);
    if (stickyIndex === -1) return base;

    let left = 0;
    for (let i = 0; i < stickyIndex; i++) {
      const priorId = LEFT_STICKY_COLUMNS[i];
      if (columnVisibility[priorId] !== false) {
        left += getColumnWidth(priorId);
      }
    }

    const isLastSticky = stickyIndex === LEFT_STICKY_COLUMNS.length - 1;
    return {
      ...base,
      position: 'sticky',
      left,
      zIndex: 17,
      ...(isLastSticky && canScrollLeft ? { boxShadow: '4px 0 8px -4px rgba(0,0,0,0.08)' } : {}),
    };
  }, [columnVisibility, getColumnWidth, canScrollLeft]);

  const getAlignmentClass = useCallback((align?: ColumnAlign) => {
    if (align === 'right') return 'text-right';
    if (align === 'center') return 'text-center';
    return 'text-left';
  }, []);

  // Persist column widths & order to localStorage
  useEffect(() => {
    try { localStorage.setItem(COLUMN_RESIZE_STORAGE_KEY, JSON.stringify(columnWidths)); } catch { /* ignore */ }
  }, [columnWidths]);

  useEffect(() => {
    try { localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columnOrder)); } catch { /* ignore */ }
  }, [columnOrder]);

  // ── Column Resize (custom drag) ────────────────────────

  const startColumnResize = useCallback((event: React.MouseEvent<HTMLButtonElement>, columnId: string) => {
    const layout = COLUMN_LAYOUT[columnId];
    const sizes = COLUMN_SIZES[columnId];
    if (!layout?.resizable || !sizes) return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const initialWidth = getColumnWidth(columnId);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(sizes.minSize, Math.min(sizes.maxSize, initialWidth + delta));
      setColumnWidths((prev) => {
        if (prev[columnId] === nextWidth) return prev;
        return { ...prev, [columnId]: nextWidth };
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [getColumnWidth]);

  // ── Column DnD Reorder ─────────────────────────────────

  const handleColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (PINNED_COLUMNS.has(active.id as string) || PINNED_COLUMNS.has(over.id as string)) return;

    setColumnOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  // Cleanup cursor on unmount
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  // ── Keyboard Navigation ────────────────────────────────

  const tableHeaderHeight = density === 'compact' ? 'h-[34px]' : 'h-[38px]';
  const headerCellPadding = density === 'compact' ? 'px-2 py-1' : 'px-3 py-1.5';
  const bodyCellPadding = density === 'compact' ? 'px-2 py-1' : 'px-3 py-1.5';

  const isTextInputTarget = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null;
    if (!element) return false;
    const tagName = element.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
    if (element.isContentEditable) return true;
    return Boolean(
      element.closest('[role="menu"]') ||
      element.closest('[data-radix-popper-content-wrapper]'),
    );
  };

  const handleKeyboardSelection = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isTextInputTarget(event.target)) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      toggleAllRows(true);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onRowSelectionChange({});
      return;
    }

    if (logs.length === 0) return;

    const currentIndex = Math.min(Math.max(activeRowIndex, 0), logs.length - 1);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), logs.length - 1);

      if (event.shiftKey) {
        const anchor = lastClickedIndex ?? currentIndex;
        handleShiftClickRange(anchor, nextIndex);
      }

      setActiveRowIndex(nextIndex);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });
      return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const activeLog = logs[currentIndex];
      if (!activeLog) return;
      const isSelected = Boolean(rowSelection[activeLog.id]);
      toggleRow(activeLog.id, !isSelected);
      setLastClickedIndex(currentIndex);
    }
  }, [
    activeRowIndex, handleShiftClickRange, lastClickedIndex, logs,
    onRowSelectionChange, rowSelection, toggleAllRows, toggleRow, rowVirtualizer,
  ]);

  // Reset horizontal scroll when visible columns change
  const visibleColumnIdsKey = useMemo(
    () => columnOrder.filter((id) => columnVisibility[id] !== false).join('|'),
    [columnOrder, columnVisibility],
  );

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = 0;
  }, [visibleColumnIdsKey]);

  // ── Render ─────────────────────────────────────────────

  if (logs.length === 0 && !isLoading) {
    if (hasFilters) {
      return (
        <div className="flex flex-col items-center justify-center h-[400px] text-center px-4">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Info className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No results found</h3>
          <p className="text-sm text-gray-500 max-w-sm">
            Try adjusting your search or filters to find what you&apos;re looking for.
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-center px-4">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <Info className="w-6 h-6 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No habit logs yet</h3>
        <p className="text-sm text-gray-500 max-w-sm">
          Start tracking your habits from the dashboard to see your activity history here.
        </p>
      </div>
    );
  }

  const NON_CLICKABLE = new Set(['select', 'source']);

  return (
    <TooltipProvider delayDuration={20}>
      <div
        className="relative outline-none"
        tabIndex={0}
        onKeyDown={handleKeyboardSelection}
        onMouseDown={() => containerRef.current?.focus()}
        onMouseLeave={() => setHoveredRowIndex(null)}
        ref={containerRef}
      >
        {isLoading && logs.length === 0 ? (
          <div className="mb-3 flex items-center gap-2 text-sm text-neutral-500">
            <BrailleSpinner className="text-sm text-neutral-500" />
            <span>Loading logs...</span>
          </div>
        ) : null}

        {/* Horizontal scroll indicators */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollHorizontal('left')}
            className="absolute left-0 top-0 z-30 flex h-[38px] w-8 items-center justify-start bg-gradient-to-r from-white via-white/80 to-transparent pl-1"
            aria-label="Scroll left"
          >
            <ArrowUp className="h-3.5 w-3.5 -rotate-90 text-neutral-500" />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollHorizontal('right')}
            className="absolute right-0 top-0 z-30 flex h-[38px] w-8 items-center justify-end bg-gradient-to-l from-white via-white/80 to-transparent pr-1"
            aria-label="Scroll right"
          >
            <ArrowUp className="h-3.5 w-3.5 rotate-90 text-neutral-500" />
          </button>
        )}

        <div
          ref={scrollViewportRef}
          className="overflow-auto overscroll-none border border-border bg-white scrollbar-hide"
          style={{ height: 'calc(100vh - 180px)' }}
        >
          <div role="table" className="w-full min-w-full text-sm">
            {/* Header */}
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleColumnDragEnd}
            >
              <div role="rowgroup" className="sticky top-0 z-20 bg-white">
                <div role="row" className={cn('flex items-center', tableHeaderHeight)}>
                  <SortableContext
                    items={headerGroup.headers.map((h) => h.id)}
                    strategy={horizontalListSortingStrategy}
                  >
                    {headerGroup.headers.map((header) => {
                      const layout = COLUMN_LAYOUT[header.id];
                      const stickyClass = layout?.stickyRight
                        ? 'md:sticky md:right-0 z-[19]'
                        : layout?.sticky
                          ? 'md:sticky z-[18]'
                          : '';

                      return (
                        <SortableHeaderCell
                          key={header.id}
                          columnId={header.id}
                          className={cn(
                            'relative h-full flex items-center border-b border-r border-border bg-white text-neutral-500',
                            headerCellPadding,
                            getAlignmentClass(layout?.align),
                            stickyClass,
                            header.id === 'select' && 'text-center',
                          )}
                          style={getStickyStyle(header.id)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}

                          {layout?.resizable && (
                            <button
                              type="button"
                              onMouseDown={(event) => startColumnResize(event, header.id)}
                              onClick={(event) => event.stopPropagation()}
                              className="absolute right-0 top-0 h-full w-2 cursor-col-resize opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                              aria-label={`Resize ${header.id} column`}
                            >
                              <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
                            </button>
                          )}
                        </SortableHeaderCell>
                      );
                    })}
                  </SortableContext>
                  {/* Filler to extend header border to full width */}
                  <div className="flex-1 h-full border-b border-border bg-white" />
                </div>
              </div>
            </DndContext>

            {/* Body (virtualized) */}
            <div role="rowgroup" style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = tableRows[virtualRow.index];
                if (!row) return null;
                const log = row.original;
                const isSelected = rowSelection[log.id] || false;
                const isActiveRow = virtualRow.index === activeRowIndex;
                const isHoveredRow = hoveredRowIndex === virtualRow.index;

                const rowBgClass = isSelected
                  ? 'bg-neutral-50'
                  : isHoveredRow || isActiveRow
                    ? 'bg-[#f7f7f6]'
                    : 'bg-white';

                return (
                  <div
                    key={log.id}
                    role="row"
                    data-index={virtualRow.index}
                    className={cn(
                      'group cursor-default select-text',
                      'absolute left-0 w-full flex items-center',
                      rowBgClass,
                    )}
                    style={{
                      height: rowHeight,
                      top: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                      contain: 'layout style paint',
                    } as CSSProperties}
                    onClick={(event) => {
                      if (event.shiftKey && lastClickedIndex !== null) {
                        handleShiftClickRange(lastClickedIndex, virtualRow.index);
                      }
                      setActiveRowIndex(virtualRow.index);
                      const target = event.target as HTMLElement;
                      const clickedCell = target.closest('[data-column]');
                      const cellColumn = clickedCell?.getAttribute('data-column');
                      if (onRowClick && !event.shiftKey && cellColumn && !NON_CLICKABLE.has(cellColumn)) {
                        onRowClick(log);
                      }
                    }}
                    onMouseEnter={() => setHoveredRowIndex(virtualRow.index)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const columnId = cell.column.id;
                      const layout = COLUMN_LAYOUT[columnId];
                      const stickyClass = layout?.stickyRight
                        ? 'md:sticky md:right-0 z-[16]'
                        : layout?.sticky
                          ? 'md:sticky z-[15]'
                          : '';

                      // Sticky cells need explicit bg to cover content that scrolls underneath
                      const needsBg = layout?.sticky || layout?.stickyRight;
                      const cellBgClass = needsBg ? rowBgClass : '';

                      return (
                        <div
                          key={cell.id}
                          role="cell"
                          data-column={columnId}
                          className={cn(
                            bodyCellPadding,
                            'h-full flex items-center border-b border-r border-border',
                            getAlignmentClass(layout?.align),
                            stickyClass,
                            cellBgClass,
                            columnId === 'select' && 'justify-center',
                          )}
                          style={getStickyStyle(columnId)}
                          onClick={
                            columnId === 'select'
                              ? (event) => event.stopPropagation()
                              : undefined
                          }
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      );
                    })}
                    {/* Filler to extend row border to full width */}
                    <div className={cn('flex-1 h-full border-b border-border', rowBgClass)} />
                  </div>
                );
              })}
              {isFetchingMore && (
                <div
                  className="absolute left-0 w-full flex items-center justify-center px-4 py-3"
                  style={{ top: rowVirtualizer.getTotalSize() }}
                >
                  <div className="flex items-center justify-center gap-2 text-sm text-neutral-500">
                    <BrailleSpinner className="text-sm text-neutral-500" />
                    <span>Loading more...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
