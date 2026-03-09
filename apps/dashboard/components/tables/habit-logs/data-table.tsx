'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  StatusCell,
  SourceCell,
  NotesCell,
  ActionsCell,
} from './columns';
import type { HabitLog, TableDensity } from '@/app/(dashboard)/activity/activity-client';

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
}

type ColumnAlign = 'left' | 'center' | 'right';

type ColumnConfig = {
  id: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth?: number;
  sortable: boolean;
  sticky: boolean;
  stickyRight?: boolean;
  align: ColumnAlign;
  resizable: boolean;
};

const COLUMN_RESIZE_STORAGE_KEY = 'ritual:logs:column-widths:v4';

const COLUMNS: ColumnConfig[] = [
  {
    id: 'select',
    label: '',
    defaultWidth: 50,
    minWidth: 50,
    maxWidth: 50,
    sortable: false,
    sticky: false,
    align: 'center',
    resizable: false,
  },
  {
    id: 'date',
    label: 'Date',
    defaultWidth: 110,
    minWidth: 96,
    maxWidth: 260,
    sortable: true,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'time',
    label: 'Time',
    defaultWidth: 128,
    minWidth: 104,
    maxWidth: 240,
    sortable: true,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'habit',
    label: 'Name',
    defaultWidth: 250,
    minWidth: 180,
    maxWidth: 620,
    sortable: true,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'value',
    label: 'Value',
    defaultWidth: 130,
    minWidth: 100,
    maxWidth: 320,
    sortable: true,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'category',
    label: 'Category',
    defaultWidth: 180,
    minWidth: 140,
    maxWidth: 420,
    sortable: true,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'source',
    label: 'Source',
    defaultWidth: 180,
    minWidth: 140,
    maxWidth: 500,
    sortable: true,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'status',
    label: 'Status',
    defaultWidth: 140,
    minWidth: 115,
    maxWidth: 320,
    sortable: true,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'notes',
    label: 'Notes',
    defaultWidth: 220,
    minWidth: 150,
    maxWidth: 500,
    sortable: false,
    sticky: false,
    align: 'left',
    resizable: true,
  },
  {
    id: 'actions',
    label: 'Actions',
    defaultWidth: 92,
    minWidth: 92,
    maxWidth: 92,
    sortable: false,
    sticky: false,
    align: 'center',
    resizable: false,
  },
];

const STATUS_OPTIONS: HabitLog['status'][] = ['completed', 'skipped', 'missed'];
const LEFT_STICKY_COLUMNS: string[] = [];

function readStoredColumnWidths(): Record<string, number> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(COLUMN_RESIZE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, number>;
    const columnById = Object.fromEntries(COLUMNS.map((column) => [column.id, column])) as Record<
      string,
      ColumnConfig
    >;
    const next: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const column = columnById[key];
      if (!column || !Number.isFinite(value)) continue;
      const clamped = Math.max(column.minWidth, Math.min(column.maxWidth ?? value, value));
      if (clamped !== column.defaultWidth) {
        next[key] = clamped;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function SortButton({
  column,
  sortColumn,
  sortDirection,
  align,
  onSort,
  children,
}: {
  column: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  align: ColumnAlign;
  onSort: (column: string) => void;
  children: React.ReactNode;
}) {
  const isActive = sortColumn === column;

  return (
    <Button
      variant="ghost"
      className={cn(
        'p-0 h-auto hover:bg-transparent text-[15px] font-normal text-gray-500 hover:text-gray-900 flex items-center gap-1 w-full',
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start',
      )}
      onClick={() => onSort(column)}
    >
      <span className="truncate">{children}</span>
      {isActive ? (
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
        className="rounded-none border-gray-200 bg-white p-2 w-[210px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-2">
          <input
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
            className="h-8 w-full border border-gray-300 bg-white px-2 text-sm outline-none"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-7 px-2 border border-gray-300 text-xs text-gray-700 hover:bg-[#F5F5F5]"
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
              className="h-7 px-2 border border-gray-900 bg-gray-900 text-xs text-white hover:bg-black disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function InlineStatusEditor({
  status,
  density,
  isUpdating,
  onSelect,
}: {
  status: HabitLog['status'];
  density: TableDensity;
  isUpdating: boolean;
  onSelect: (nextStatus: HabitLog['status']) => void;
}) {
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
            <StatusCell status={status} />
          </span>
          {isUpdating ? (
            <BrailleSpinner className="text-sm text-gray-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-70" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="rounded-none border-gray-200 bg-white w-[170px]">
        {STATUS_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option}
            className="rounded-none"
            onClick={() => {
              if (option !== status) {
                onSelect(option);
              }
            }}
          >
            <span className="flex-1">
              <StatusCell status={option} />
            </span>
            {status === option && <Check className="w-3.5 h-3.5 text-gray-700" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InlineSourceEditor({
  source,
  sourceOptions,
  density,
  isUpdating,
  onSelect,
}: {
  source?: string;
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
            <SourceCell source={currentSource} />
          </span>
          {isUpdating ? (
            <BrailleSpinner className="text-sm text-gray-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-70" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="rounded-none border-gray-200 bg-white w-[180px]">
        {sourceOptions.map((option) => (
          <DropdownMenuItem
            key={option}
            className="rounded-none"
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
}: DataTableProps) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(readStoredColumnWidths);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const columnById = useMemo(() => {
    return Object.fromEntries(COLUMNS.map((column) => [column.id, column])) as Record<string, ColumnConfig>;
  }, []);

  const visibleColumns = useMemo(
    () => COLUMNS.filter((column) => columnVisibility[column.id] !== false),
    [columnVisibility],
  );
  const visibleColumnIdsKey = useMemo(
    () => visibleColumns.map((column) => column.id).join('|'),
    [visibleColumns],
  );

  const getColumnWidth = useCallback((columnId: string) => {
    const column = columnById[columnId];
    if (!column) return 120;
    return columnWidths[columnId] ?? column.defaultWidth;
  }, [columnById, columnWidths]);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_RESIZE_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // Ignore storage errors.
    }
  }, [columnWidths]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
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

  const getAlignmentClass = useCallback((align: ColumnAlign) => {
    if (align === 'right') return 'text-right';
    if (align === 'center') return 'text-center';
    return 'text-left';
  }, []);

  const getColumnStyle = useCallback((columnId: string): React.CSSProperties => {
    const width = getColumnWidth(columnId);
    return {
      width,
      minWidth: width,
      maxWidth: width,
    };
  }, [getColumnWidth]);

  const getStickyStyle = useCallback((columnId: string): React.CSSProperties => {
    const baseStyle = getColumnStyle(columnId);
    const column = columnById[columnId];
    if (!column) return baseStyle;

    if (column.stickyRight) {
      return {
        ...baseStyle,
        position: 'sticky',
        right: 0,
        zIndex: 18,
      };
    }

    if (!column.sticky) {
      return baseStyle;
    }

    const stickyIndex = LEFT_STICKY_COLUMNS.indexOf(columnId);
    if (stickyIndex === -1) return baseStyle;

    let left = 0;
    for (let i = 0; i < stickyIndex; i++) {
      const priorId = LEFT_STICKY_COLUMNS[i];
      if (columnVisibility[priorId] !== false) {
        left += getColumnWidth(priorId);
      }
    }

    return {
      ...baseStyle,
      position: 'sticky',
      left,
      zIndex: 17,
    };
  }, [columnById, columnVisibility, getColumnStyle, getColumnWidth]);

  const startColumnResize = useCallback((event: React.MouseEvent<HTMLButtonElement>, columnId: string) => {
    const column = columnById[columnId];
    if (!column || !column.resizable) return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const initialWidth = getColumnWidth(columnId);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(
        column.minWidth,
        Math.min(column.maxWidth ?? 999, initialWidth + delta),
      );

      setColumnWidths((prev) => {
        if (prev[columnId] === nextWidth) return prev;
        return {
          ...prev,
          [columnId]: nextWidth,
        };
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
  }, [columnById, getColumnWidth]);

  const tableHeaderHeight = density === 'compact' ? 'h-[44px]' : 'h-[50px]';
  const tableRowHeight = density === 'compact' ? 'h-[44px]' : 'h-[52px]';
  const headerCellPadding = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2';
  const bodyCellPadding = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2';

  const isTextInputTarget = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null;
    if (!element) return false;

    const tagName = element.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return true;
    }

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
    activeRowIndex,
    handleShiftClickRange,
    lastClickedIndex,
    logs,
    onRowSelectionChange,
    rowSelection,
    toggleAllRows,
    toggleRow,
  ]);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = 0;
  }, [visibleColumnIdsKey]);

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

  return (
    <TooltipProvider delayDuration={20}>
      <div
        className="relative h-full outline-none"
        tabIndex={0}
        onKeyDown={handleKeyboardSelection}
        onMouseDown={() => containerRef.current?.focus()}
        ref={containerRef}
      >
        <div
          ref={scrollViewportRef}
          className="overflow-x-auto overscroll-x-none h-[calc(100%-60px)] border border-gray-200 scrollbar-hide bg-white"
        >
          <table className="table-fixed w-max min-w-full caption-bottom text-sm">
            <colgroup>
              {visibleColumns.map((column) => (
                <col key={`col-${column.id}`} style={getColumnStyle(column.id)} />
              ))}
            </colgroup>

            <TableHeader className="border-0 sticky top-0 z-20 bg-white [&_tr]:border-gray-200 [&_th]:border-r [&_th]:border-r-gray-200 [&_th:last-child]:border-r-0">
              <TableRow className={cn('hover:bg-transparent border-gray-200', tableHeaderHeight)}>
                {visibleColumns.map((column) => {
                  const stickyClass = column.stickyRight
                    ? 'md:sticky md:right-0 z-[19]'
                    : column.sticky
                      ? 'md:sticky z-[18]'
                      : '';

                  return (
                    <TableHead
                      key={column.id}
                      className={cn(
                        'relative bg-white text-[15px] font-normal text-gray-500 border-gray-200',
                        'after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-gray-200 last:after:hidden',
                        headerCellPadding,
                        getAlignmentClass(column.align),
                        stickyClass,
                        column.id === 'select' && 'text-center',
                      )}
                      style={getStickyStyle(column.id)}
                    >
                      {column.id === 'select' ? (
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={allSelected || (someSelected && 'indeterminate')}
                            onCheckedChange={toggleAllRows}
                            className="rounded-none border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                          />
                        </div>
                      ) : column.sortable ? (
                        <SortButton
                          column={column.id}
                          sortColumn={sortColumn}
                          sortDirection={sortDirection}
                          align={column.align}
                          onSort={onSort}
                        >
                          {column.label}
                        </SortButton>
                      ) : (
                        <span className="truncate block">{column.label}</span>
                      )}

                      {column.resizable && (
                        <button
                          type="button"
                          onMouseDown={(event) => startColumnResize(event, column.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                          aria-label={`Resize ${column.label} column`}
                        >
                          <span className="absolute left-1/2 top-0 -translate-x-1/2 h-full w-px bg-gray-300" />
                        </button>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>

            <TableBody className="border-0">
              {logs.map((log, index) => {
                const isSelected = rowSelection[log.id] || false;
                const isActiveRow = index === activeRowIndex;
                const isRowUpdating = Boolean(updatingLogIds[log.id]);

                return (
                  <TableRow
                    key={log.id}
                    className={cn(
                      'group cursor-default select-none border-gray-200 hover:bg-[#FAFAFA]',
                      tableRowHeight,
                      isSelected && 'bg-[#F7F7F7]',
                      isActiveRow && 'bg-[#FAFAFA]',
                    )}
                    onClick={(event) => {
                      if (event.shiftKey && lastClickedIndex !== null) {
                        handleShiftClickRange(lastClickedIndex, index);
                      }
                      setActiveRowIndex(index);
                    }}
                  >
                    {visibleColumns.map((column) => {
                      const stickyClass = column.stickyRight
                        ? 'md:sticky md:right-0 z-[16]'
                        : column.sticky
                          ? 'md:sticky z-[15]'
                          : '';

                      const stickyBg = column.sticky || column.stickyRight
                        ? isSelected
                          ? 'bg-[#F7F7F7]'
                          : 'bg-white'
                        : '';

                      const cellClassName = cn(
                        bodyCellPadding,
                        'border-gray-200',
                        getAlignmentClass(column.align),
                        stickyClass,
                        stickyBg,
                        'group-hover:bg-[#FAFAFA]',
                        column.id === 'select' && 'text-center',
                      );

                      if (column.id === 'select') {
                        return (
                          <TableCell
                            key={`${log.id}-select`}
                            className={cellClassName}
                            style={getStickyStyle('select')}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <SelectCell
                              checked={isSelected}
                              onChange={(value) => {
                                toggleRow(log.id, value);
                                setLastClickedIndex(index);
                                setActiveRowIndex(index);
                              }}
                              onShiftClick={() => {
                                if (lastClickedIndex !== null) {
                                  handleShiftClickRange(lastClickedIndex, index);
                                }
                                setLastClickedIndex(index);
                                setActiveRowIndex(index);
                              }}
                            />
                          </TableCell>
                        );
                      }

                      if (column.id === 'date') {
                        return (
                          <TableCell
                            key={`${log.id}-date`}
                            className={cellClassName}
                            style={getStickyStyle('date')}
                          >
                            <InlineDateEditor
                              date={log.date}
                              density={density}
                              isUpdating={isRowUpdating}
                              onSave={(nextDate) => onQuickEdit(log, { date: nextDate })}
                            />
                          </TableCell>
                        );
                      }

                      if (column.id === 'time') {
                        return (
                          <TableCell
                            key={`${log.id}-time`}
                            className={cellClassName}
                            style={getStickyStyle('time')}
                          >
                            <TimeCell completedAt={log.completed_at} />
                          </TableCell>
                        );
                      }

                      if (column.id === 'habit') {
                        return (
                          <TableCell
                            key={`${log.id}-habit`}
                            className={cellClassName}
                            style={getStickyStyle('habit')}
                          >
                            <HabitCell habitName={log.habit_name} icon={log.icon} />
                          </TableCell>
                        );
                      }

                      if (column.id === 'value') {
                        return (
                          <TableCell
                            key={`${log.id}-value`}
                            className={cellClassName}
                            style={getStickyStyle('value')}
                          >
                            <ValueCell
                              duration={log.duration}
                              amount={log.amount}
                              unitType={log.unit_type}
                            />
                          </TableCell>
                        );
                      }

                      if (column.id === 'category') {
                        return (
                          <TableCell
                            key={`${log.id}-category`}
                            className={cellClassName}
                            style={getStickyStyle('category')}
                          >
                            <CategoryCell category={log.category} />
                          </TableCell>
                        );
                      }

                      if (column.id === 'status') {
                        return (
                          <TableCell
                            key={`${log.id}-status`}
                            className={cellClassName}
                            style={getStickyStyle('status')}
                          >
                            <InlineStatusEditor
                              status={log.status}
                              density={density}
                              isUpdating={isRowUpdating}
                              onSelect={(nextStatus) => onQuickEdit(log, { status: nextStatus })}
                            />
                          </TableCell>
                        );
                      }

                      if (column.id === 'source') {
                        return (
                          <TableCell
                            key={`${log.id}-source`}
                            className={cellClassName}
                            style={getStickyStyle('source')}
                          >
                            <InlineSourceEditor
                              source={log.integration_source}
                              sourceOptions={sourceOptions}
                              density={density}
                              isUpdating={isRowUpdating}
                              onSelect={(nextSource) => onQuickEdit(log, { integration_source: nextSource })}
                            />
                          </TableCell>
                        );
                      }

                      if (column.id === 'notes') {
                        return (
                          <TableCell
                            key={`${log.id}-notes`}
                            className={cellClassName}
                            style={getStickyStyle('notes')}
                          >
                            <NotesCell notes={log.notes} />
                          </TableCell>
                        );
                      }

                      if (column.id === 'actions') {
                        return (
                          <TableCell
                            key={`${log.id}-actions`}
                            className={cellClassName}
                            style={getStickyStyle('actions')}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="flex items-center justify-center">
                              <ActionsCell log={log} />
                            </div>
                          </TableCell>
                        );
                      }

                      return null;
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}
