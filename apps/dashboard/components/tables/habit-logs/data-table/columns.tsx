'use client';

import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  SelectCell, DateCell, TimeCell, HabitCell, ValueCell,
  CategoryCell, SourceCell, NotesCell, ActionsCell,
} from '../columns';
import type { HabitLog } from '@/components/habit-logs/types';
import {
  COLUMN_SIZES, type HabitLogTableMeta,
} from './constants';
import { SortButton, InlineDateEditor, InlineSourceEditor } from './header-cells';

export const tableColumns: ColumnDef<HabitLog>[] = [
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
      const isEditable = log.editable !== false && Boolean(log.habit_id);
      return (
        isEditable ? (
          <InlineDateEditor
            date={log.date}
            completedAt={log.completed_at}
            integrationSource={log.integration_source}
            metricType={log.metric_type}
            timePrecision={log.time_precision}
            density={meta.density}
            isUpdating={Boolean(meta.updatingLogIds[log.id])}
            onSave={(nextDate) => meta.onQuickEdit(log, { date: nextDate })}
          />
        ) : (
          <DateCell
            date={log.date}
            completed_at={log.completed_at}
            integration_source={log.integration_source}
            metric_type={log.metric_type}
            time_precision={log.time_precision}
          />
        )
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
    cell: ({ row }) => (
      <TimeCell
        date={row.original.date}
        completed_at={row.original.completed_at}
        integration_source={row.original.integration_source}
        metric_type={row.original.metric_type}
        time_precision={row.original.time_precision}
      />
    ),
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
      const isEditable = log.editable !== false && Boolean(log.habit_id);
      return (
        isEditable ? (
          <InlineSourceEditor
            source={log.integration_source}
            habitName={log.habit_name}
            sourceOptions={meta.sourceOptions}
            density={meta.density}
            isUpdating={Boolean(meta.updatingLogIds[log.id])}
            onSelect={(nextSource) => meta.onQuickEdit(log, { integration_source: nextSource })}
          />
        ) : (
          <SourceCell source={log.integration_source} habitName={log.habit_name} />
        )
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
  {
    id: 'actions',
    ...COLUMN_SIZES.actions,
    enableResizing: false,
    header: () => (
      <span className="block truncate text-[14px] font-normal tracking-normal text-neutral-700">
        Actions
      </span>
    ),
    cell: ({ row }) => <ActionsCell log={row.original} />,
  },
];
