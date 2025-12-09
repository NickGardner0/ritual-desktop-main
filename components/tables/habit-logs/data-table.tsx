'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
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
import type { HabitLog } from '@/app/(dashboard)/activity/activity-client';

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
}

// Column configuration
const COLUMNS = [
  { id: 'select', label: '', width: 'w-[50px]', sortable: false, sticky: true },
  { id: 'date', label: 'Date', width: 'w-[100px]', sortable: true, sticky: true },
  { id: 'time', label: 'Time', width: 'w-[90px]', sortable: true, sticky: false },
  { id: 'habit', label: 'Name', width: 'w-[180px] min-w-[180px]', sortable: true, sticky: true },
  { id: 'value', label: 'Value', width: 'w-[160px]', sortable: true, sticky: false },
  { id: 'category', label: 'Category', width: 'w-[170px]', sortable: true, sticky: false },
  { id: 'status', label: 'Status', width: 'w-[120px]', sortable: true, sticky: false },
  { id: 'source', label: 'Source', width: 'w-[100px]', sortable: true, sticky: false },
  { id: 'notes', label: 'Notes', width: 'w-[180px]', sortable: false, sticky: false },
  { id: 'actions', label: '', width: 'w-[60px]', sortable: false, sticky: true, stickyRight: true },
];

function SortButton({ 
  column, 
  onSort, 
  children 
}: {
  column: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      className="p-0 h-auto hover:bg-transparent font-normal text-gray-900"
      onClick={() => onSort(column)}
    >
      <span>{children}</span>
    </Button>
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
}: DataTableProps) {
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if all/some rows are selected
  const allSelected = logs.length > 0 && logs.every(log => rowSelection[log.id]);
  const someSelected = logs.some(log => rowSelection[log.id]) && !allSelected;

  // Toggle all rows
  const toggleAllRows = useCallback((value: boolean) => {
    if (value) {
      const newSelection: Record<string, boolean> = {};
      logs.forEach(log => { newSelection[log.id] = true; });
      onRowSelectionChange(newSelection);
    } else {
      onRowSelectionChange({});
    }
  }, [logs, onRowSelectionChange]);

  // Toggle single row
  const toggleRow = useCallback((id: string, value: boolean) => {
    onRowSelectionChange({
      ...rowSelection,
      [id]: value,
    });
  }, [rowSelection, onRowSelectionChange]);

  // Handle shift-click range selection
  const handleShiftClickRange = useCallback((startIndex: number, endIndex: number) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    
    // Check if all items in range are selected
    let allInRangeSelected = true;
    for (let i = start; i <= end; i++) {
      if (!rowSelection[logs[i]?.id]) {
        allInRangeSelected = false;
        break;
      }
    }
    
    // Toggle the range
    const newSelection = { ...rowSelection };
    for (let i = start; i <= end; i++) {
      const log = logs[i];
      if (log) {
        if (allInRangeSelected) {
          delete newSelection[log.id];
        } else {
          newSelection[log.id] = true;
        }
      }
    }
    onRowSelectionChange(newSelection);
  }, [logs, rowSelection, onRowSelectionChange]);

  // Get visible columns
  const visibleColumns = COLUMNS.filter(col => columnVisibility[col.id] !== false);

  // Get sticky column styles
  const getStickyStyle = useCallback((columnId: string): React.CSSProperties => {
    if (columnId === 'actions') {
      return { position: 'sticky', right: 0, zIndex: 10 };
    }
    
    const stickyColumns = ['select', 'date', 'habit'];
    const index = stickyColumns.indexOf(columnId);
    if (index === -1) return {};
    
    // Calculate left position based on previous sticky columns
    const widths = [50, 100, 200]; // Approximate widths
    let left = 0;
    for (let i = 0; i < index; i++) {
      if (columnVisibility[stickyColumns[i]] !== false) {
        left += widths[i];
      }
    }
    
    return { position: 'sticky', left, zIndex: 10 };
  }, [columnVisibility]);

  // Render empty states
  if (logs.length === 0 && !isLoading) {
    if (hasFilters) {
      return (
        <div className="flex flex-col items-center justify-center h-[400px] text-center px-4">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Info className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No results found</h3>
          <p className="text-sm text-gray-500 max-w-sm">
            Try adjusting your search or filters to find what you're looking for.
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

  const selectedCount = Object.keys(rowSelection).length;

  return (
    <TooltipProvider delayDuration={20}>
      <div className="relative h-full">
        {/* Table Container - Midday style */}
        <div 
          ref={containerRef}
          className="overflow-x-auto overscroll-x-none h-[calc(100%-60px)] border-l border-r border-t border-gray-300 scrollbar-hide"
        >
          <Table>
            <TableHeader className="border-0">
              <TableRow className="h-[45px] hover:bg-transparent">
                {visibleColumns.map((col) => (
                  <TableHead
                    key={col.id}
                    className={cn(
                      'px-3 md:px-4 py-2 bg-background',
                      col.width,
                      col.sticky && 'md:sticky md:left-[var(--stick-left)] z-10',
                      col.id === 'select' && 'text-center',
                    )}
                    style={getStickyStyle(col.id)}
                  >
                    {col.id === 'select' ? (
                      <div className="flex items-center justify-center">
                      <Checkbox
                        checked={allSelected || (someSelected && 'indeterminate')}
                        onCheckedChange={toggleAllRows}
                          className="rounded-none border-gray-400 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                      />
                      </div>
                    ) : col.sortable ? (
                      <SortButton
                        column={col.id}
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={onSort}
                      >
                        {col.label}
                      </SortButton>
                    ) : (
                      <span>{col.label}</span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody className="border-0">
              {logs.map((log, index) => {
                const isSelected = rowSelection[log.id] || false;
                
                return (
                  <TableRow
                    key={log.id}
                    className={cn(
                      'group h-[40px] md:h-[45px] cursor-pointer select-text hover:bg-[#F5F5F5] hover:dark:bg-[#0f0f0f]',
                      isSelected && 'bg-[#F5F5F5] dark:bg-[#0f0f0f]'
                    )}
                  >
                    {columnVisibility.select !== false && (
                      <TableCell
                        className={cn(
                          "md:sticky z-10 text-center",
                          isSelected ? "bg-[#F5F5F5] dark:bg-[#0f0f0f]" : "bg-background",
                          "group-hover:bg-[#F5F5F5] group-hover:dark:bg-[#0f0f0f]"
                        )}
                        style={getStickyStyle('select')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <SelectCell
                          checked={isSelected}
                          onChange={(value) => {
                            toggleRow(log.id, value);
                            setLastClickedIndex(index);
                          }}
                          onShiftClick={() => {
                            if (lastClickedIndex !== null) {
                              handleShiftClickRange(lastClickedIndex, index);
                            }
                            setLastClickedIndex(index);
                          }}
                        />
                      </TableCell>
                    )}
                    
                    {columnVisibility.date !== false && (
                      <TableCell
                        className={cn(
                          "md:sticky z-10",
                          isSelected ? "bg-[#F5F5F5] dark:bg-[#0f0f0f]" : "bg-background",
                          "group-hover:bg-[#F5F5F5] group-hover:dark:bg-[#0f0f0f]"
                        )}
                        style={getStickyStyle('date')}
                      >
                        <DateCell date={log.date} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.time !== false && (
                      <TableCell>
                        <TimeCell completedAt={log.completed_at} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.habit !== false && (
                      <TableCell
                        className={cn(
                          "md:sticky z-10",
                          isSelected ? "bg-[#F5F5F5] dark:bg-[#0f0f0f]" : "bg-background",
                          "group-hover:bg-[#F5F5F5] group-hover:dark:bg-[#0f0f0f]"
                        )}
                        style={getStickyStyle('habit')}
                      >
                        <HabitCell habitName={log.habit_name} icon={log.icon} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.value !== false && (
                      <TableCell>
                        <ValueCell
                          duration={log.duration}
                          amount={log.amount}
                          unitType={log.unit_type}
                        />
                      </TableCell>
                    )}
                    
                    {columnVisibility.category !== false && (
                      <TableCell>
                        <CategoryCell category={log.category} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.status !== false && (
                      <TableCell>
                        <StatusCell status={log.status} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.source !== false && (
                      <TableCell>
                        <SourceCell source={log.integration_source} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.notes !== false && (
                      <TableCell>
                        <NotesCell notes={log.notes} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.actions !== false && (
                      <TableCell
                        className={cn(
                          "md:sticky md:right-0 z-10",
                          isSelected ? "bg-[#F5F5F5] dark:bg-[#0f0f0f]" : "bg-background",
                          "group-hover:bg-[#F5F5F5] group-hover:dark:bg-[#0f0f0f]"
                        )}
                        style={getStickyStyle('actions')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ActionsCell log={log} />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Bottom Bar - Shows totals when filtered */}
        <AnimatePresence>
          {hasFilters && totals && selectedCount === 0 && (
            <motion.div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              <div className="backdrop-blur-lg bg-white/80 border border-gray-300 h-12 flex items-center px-4 gap-4 shadow-lg">
                <div className="flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-900">
                    {totals.count} logs
                  </span>
                </div>
                <div className="h-4 w-px bg-gray-300" />
                <span className="text-sm text-gray-600">
                  {totals.completionRate.toFixed(0)}% completed
                </span>
                {totals.totalDuration > 0 && (
                  <>
                    <div className="h-4 w-px bg-gray-300" />
                    <span className="text-sm text-gray-600">
                      {(totals.totalDuration / 3600).toFixed(1)} hrs total
                    </span>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </TooltipProvider>
  );
}

