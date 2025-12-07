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
import { ArrowUp, ArrowDown, ArrowUpDown, Info } from 'lucide-react';
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
  { id: 'habit', label: 'Habit', width: 'w-[200px] min-w-[200px]', sortable: true, sticky: true },
  { id: 'value', label: 'Value', width: 'w-[120px]', sortable: true, sticky: false },
  { id: 'category', label: 'Category', width: 'w-[140px]', sortable: true, sticky: false },
  { id: 'status', label: 'Status', width: 'w-[120px]', sortable: true, sticky: false },
  { id: 'source', label: 'Source', width: 'w-[100px]', sortable: true, sticky: false },
  { id: 'notes', label: 'Notes', width: 'w-[180px]', sortable: false, sticky: false },
  { id: 'actions', label: '', width: 'w-[60px]', sortable: false, sticky: true, stickyRight: true },
];

function SortButton({ 
  column, 
  sortColumn, 
  sortDirection, 
  onSort, 
  children 
}: {
  column: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
  children: React.ReactNode;
}) {
  const isActive = sortColumn === column;
  
  return (
    <Button
      variant="ghost"
      className="p-0 h-auto hover:bg-transparent font-medium text-gray-600 gap-1"
      onClick={() => onSort(column)}
    >
      {children}
      {isActive && sortDirection === 'asc' && <ArrowUp className="w-3.5 h-3.5" />}
      {isActive && sortDirection === 'desc' && <ArrowDown className="w-3.5 h-3.5" />}
      {!isActive && <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
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
        {/* Table Container */}
        <div 
          ref={containerRef}
          className="overflow-auto h-[calc(100%-60px)] border-l border-r border-gray-300 scrollbar-thin scrollbar-thumb-gray-300"
        >
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-white">
              <TableRow className="h-[45px] hover:bg-transparent border-b border-gray-300">
                {visibleColumns.map((col) => (
                  <TableHead
                    key={col.id}
                    className={cn(
                      'px-3 py-2 bg-white border-r border-gray-300 last:border-r-0',
                      col.width,
                      col.sticky && 'bg-white',
                    )}
                    style={getStickyStyle(col.id)}
                  >
                    {col.id === 'select' ? (
                      <Checkbox
                        checked={allSelected || (someSelected && 'indeterminate')}
                        onCheckedChange={toggleAllRows}
                        className="rounded-none border-gray-400 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                      />
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
                      <span className="text-sm font-medium text-gray-600">{col.label}</span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {logs.map((log, index) => {
                const isSelected = rowSelection[log.id] || false;
                
                return (
                  <TableRow
                    key={log.id}
                    className={cn(
                      'group h-[45px] cursor-pointer select-text border-b border-gray-200',
                      'hover:bg-[#F2F1EF]',
                      isSelected && 'bg-gray-50'
                    )}
                  >
                    {columnVisibility.select !== false && (
                      <TableCell
                        className="px-3 py-2 border-r border-gray-200 bg-background group-hover:bg-[#F2F1EF]"
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
                        className="px-3 py-2 border-r border-gray-200 bg-background group-hover:bg-[#F2F1EF]"
                        style={getStickyStyle('date')}
                      >
                        <DateCell date={log.date} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.time !== false && (
                      <TableCell className="px-3 py-2 border-r border-gray-200">
                        <TimeCell completedAt={log.completed_at} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.habit !== false && (
                      <TableCell
                        className="px-3 py-2 border-r border-gray-200 bg-background group-hover:bg-[#F2F1EF]"
                        style={getStickyStyle('habit')}
                      >
                        <HabitCell habitName={log.habit_name} icon={log.icon} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.value !== false && (
                      <TableCell className="px-3 py-2 border-r border-gray-200">
                        <ValueCell
                          duration={log.duration}
                          amount={log.amount}
                          unitType={log.unit_type}
                        />
                      </TableCell>
                    )}
                    
                    {columnVisibility.category !== false && (
                      <TableCell className="px-3 py-2 border-r border-gray-200">
                        <CategoryCell category={log.category} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.status !== false && (
                      <TableCell className="px-3 py-2 border-r border-gray-200">
                        <StatusCell status={log.status} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.source !== false && (
                      <TableCell className="px-3 py-2 border-r border-gray-200">
                        <SourceCell source={log.integration_source} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.notes !== false && (
                      <TableCell className="px-3 py-2 border-r border-gray-200">
                        <NotesCell notes={log.notes} />
                      </TableCell>
                    )}
                    
                    {columnVisibility.actions !== false && (
                      <TableCell
                        className="px-3 py-2 bg-background group-hover:bg-[#F2F1EF]"
                        style={getStickyStyle('actions')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ActionsCell
                          log={log}
                          onView={(id) => console.log('View', id)}
                          onEdit={(id) => console.log('Edit', id)}
                          onDelete={(id) => console.log('Delete', id)}
                          onCopyId={(id) => {
                            navigator.clipboard.writeText(id);
                          }}
                        />
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

        {/* Export Bar - Shows when rows selected */}
        <AnimatePresence>
          {selectedCount > 0 && (
            <motion.div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              <div className="backdrop-blur-lg bg-white/80 border border-gray-300 h-12 flex items-center justify-between px-4 gap-6 shadow-lg min-w-[350px]">
                <span className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">{selectedCount}</span> selected
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRowSelectionChange({})}
                    className="text-sm"
                  >
                    Deselect all
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-none bg-gray-900 hover:bg-gray-800"
                    onClick={() => {
                      // TODO: Implement export
                      console.log('Export', Object.keys(rowSelection));
                    }}
                  >
                    Export
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}

