'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
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
} from '@dnd-kit/sortable';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ArrowUp, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type { HabitLog } from '@/components/habit-logs/types';
import {
  COLUMN_LAYOUT,
  COLUMN_ORDER_STORAGE_KEY,
  COLUMN_RESIZE_STORAGE_KEY,
  COLUMN_SIZES,
  DEFAULT_COLUMN_ORDER,
  LEFT_STICKY_COLUMNS,
  PINNED_COLUMNS,
  type ColumnAlign,
  type DataTableProps,
  type HabitLogTableMeta,
} from './data-table/constants';
import { tableColumns } from './data-table/columns';
import { readStoredColumnOrder, readStoredColumnWidths } from './data-table/storage';
import { SortableHeaderCell } from './data-table/header-cells';

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
  const [activeRowIndex, setActiveRowIndex] = useState<number>(-1);
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

  // Auto-focus the table container so keyboard navigation works immediately.
  // Also re-focus when the document regains focus (e.g. switching back to the app)
  // or when a popover/modal closes and focus lands on <body>.
  useEffect(() => {
    const tryFocus = () => {
      if (
        containerRef.current &&
        (!document.activeElement || document.activeElement === document.body) &&
        !document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')
      ) {
        containerRef.current.focus({ preventScroll: true });
      }
    };

    // Initial focus with small delay to avoid stealing from search bar
    const timer = setTimeout(tryFocus, 100);

    // Re-focus when focus returns to body (modal/popover closed)
    const handleFocusIn = (e: FocusEvent) => {
      if (e.target === document.body) {
        setTimeout(tryFocus, 50);
      }
    };
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, []);

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
      return {
        ...base,
        position: 'sticky',
        right: 0,
        zIndex: 18,
        ...(canScrollRight ? { boxShadow: '-4px 0 8px -4px rgba(0,0,0,0.08)' } : {}),
      };
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
  }, [columnVisibility, getColumnWidth, canScrollLeft, canScrollRight]);

  const getAlignmentClass = useCallback((align?: ColumnAlign) => {
    if (align === 'right') return 'text-right';
    if (align === 'center') return 'text-center';
    return 'text-left';
  }, []);

  const tableMinWidth = useMemo(() => {
    const visibleLeafColumns = table.getVisibleLeafColumns();
    return visibleLeafColumns.reduce((sum, column) => sum + getColumnWidth(column.id), 0);
  }, [table, columnVisibility, getColumnWidth]);

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

  const NON_CLICKABLE = new Set(['select', 'source', 'actions']);

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
          style={{
            height: 'calc(100vh - 140px)',
            maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent 100%)',
          }}
        >
          <div
            role="table"
            className="min-w-full text-sm"
            style={{ minWidth: `${tableMinWidth}px` }}
          >
            {/* Header */}
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleColumnDragEnd}
            >
              <div role="rowgroup" className="sticky top-0 z-20 bg-white">
                <div
                  role="row"
                  className={cn('flex items-center min-w-full', tableHeaderHeight)}
                  style={{ minWidth: `${tableMinWidth}px` }}
                >
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
                            'relative h-full flex items-center border-b border-border bg-white text-neutral-500',
                            !layout?.stickyRight && 'border-r',
                            (header.id === 'select' || header.id === 'actions') ? 'px-0' : headerCellPadding,
                            getAlignmentClass(layout?.align),
                            stickyClass,
                            (header.id === 'select' || header.id === 'actions') && 'justify-center text-center',
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

                const rowBgClass = isSelected
                  ? 'bg-neutral-50'
                  : isActiveRow
                    ? 'bg-[#f7f7f6]'
                    : 'bg-white';

                return (
                  <div
                    key={log.id}
                    role="row"
                    data-index={virtualRow.index}
                    data-selected={isSelected ? 'true' : undefined}
                    data-active={isActiveRow ? 'true' : undefined}
                    className={cn(
                      'ritual-habit-log-row group cursor-default select-text',
                      'absolute left-0 w-full min-w-full flex items-center',
                      rowBgClass,
                    )}
                    style={{
                      height: rowHeight,
                      top: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                      minWidth: `${tableMinWidth}px`,
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
                            (columnId === 'select' || columnId === 'actions') ? 'px-0' : bodyCellPadding,
                            'h-full flex items-center border-b border-border',
                            !layout?.stickyRight && 'border-r',
                            getAlignmentClass(layout?.align),
                            stickyClass,
                            cellBgClass,
                            (columnId === 'select' || columnId === 'actions') && 'justify-center',
                          )}
                          style={getStickyStyle(columnId)}
                          onClick={
                            columnId === 'select' || columnId === 'actions'
                              ? (event) => event.stopPropagation()
                              : undefined
                          }
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      );
                    })}
                    {/* Filler to extend row border to full width */}
                    <div className={cn('ritual-habit-log-row-fill flex-1 h-full border-b border-border', rowBgClass)} />
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
