import type { HabitLog, TableDensity } from '@/components/habit-logs/types';

// ── Types ──────────────────────────────────────────────────

export interface DataTableProps {
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

export type ColumnAlign = 'left' | 'center' | 'right';

interface ColumnLayoutMeta {
  sticky?: boolean;
  stickyRight?: boolean;
  align: ColumnAlign;
  resizable: boolean;
  sortable: boolean;
  hideIndicator?: boolean;
}

export interface HabitLogTableMeta {
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

export const COLUMN_RESIZE_STORAGE_KEY = 'ritual:logs:column-widths:v5';
export const COLUMN_ORDER_STORAGE_KEY = 'ritual:logs:column-order:v1';

export const DEFAULT_COLUMN_ORDER = ['select', 'date', 'time', 'habit', 'value', 'category', 'source', 'notes', 'actions'];
export const LEFT_STICKY_COLUMNS = ['select', 'date'];
export const PINNED_COLUMNS = new Set(['select', 'actions']);

export const COLUMN_LAYOUT: Record<string, ColumnLayoutMeta> = {
  select: { sticky: true, align: 'center', resizable: false, sortable: false },
  date: { sticky: true, align: 'left', resizable: true, sortable: true, hideIndicator: true },
  time: { align: 'left', resizable: true, sortable: true, hideIndicator: true },
  habit: { align: 'left', resizable: true, sortable: true },
  value: { align: 'left', resizable: true, sortable: true },
  category: { align: 'left', resizable: true, sortable: true },
  source: { align: 'left', resizable: true, sortable: true },
  notes: { align: 'left', resizable: false, sortable: false },
  actions: { stickyRight: true, align: 'center', resizable: false, sortable: false },
};

export const COLUMN_SIZES: Record<string, { size: number; minSize: number; maxSize: number }> = {
  select: { size: 40, minSize: 40, maxSize: 40 },
  date: { size: 110, minSize: 90, maxSize: 200 },
  time: { size: 110, minSize: 80, maxSize: 200 },
  habit: { size: 240, minSize: 140, maxSize: 500 },
  value: { size: 160, minSize: 100, maxSize: 280 },
  category: { size: 155, minSize: 100, maxSize: 300 },
  source: { size: 140, minSize: 90, maxSize: 300 },
  notes: { size: 195, minSize: 120, maxSize: 400 },
  actions: { size: 72, minSize: 72, maxSize: 72 },
};
