'use client';

import { memo } from 'react';
import {
  CANVAS_BODY_CELL,
  CANVAS_HEADER_CELL,
  CANVAS_HEADER_ROW,
  CANVAS_TABLE,
  CANVAS_TABLE_BORDER,
  CANVAS_TABLE_WRAPPER,
  TableCols,
  cn,
  formatDate,
  formatValueWithUnit,
  type HabitDailyTableRow,
} from './habit-canvas.shared';

export const HabitDailyTable = memo(function HabitDailyTable({
  rows,
  emptyText,
  isSleepHabit,
}: {
  rows: HabitDailyTableRow[];
  emptyText: string;
  isSleepHabit: boolean;
}) {
  const columnCount = isSleepHabit ? 5 : 4;
  const bodyCellBase = `${CANVAS_BODY_CELL} whitespace-nowrap overflow-hidden text-ellipsis`;

  return (
    <div className={cn(CANVAS_TABLE_WRAPPER, 'max-h-[260px] overflow-y-auto')}>
      <table className={CANVAS_TABLE}>
        <TableCols
          widths={
            isSleepHabit
              ? ['20%', '20%', '20%', '20%', '20%']
              : ['25%', '25%', '25%', '25%']
          }
        />
        <thead className="sticky top-0 bg-white">
          <tr className={cn(CANVAS_HEADER_ROW, 'sticky top-0')}>
            <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Date</th>
            <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Value</th>
            {isSleepHabit ? (
              <>
                <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Sleep Time</th>
                <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Wake Time</th>
                <th className={`${CANVAS_HEADER_CELL} text-left`}>Entries</th>
              </>
            ) : (
              <>
                <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Time</th>
                <th className={`${CANVAS_HEADER_CELL} text-left`}>Entries</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-5 text-center text-xs text-[#666]">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={`${row.date}-${idx}`} className="transition-colors hover:bg-neutral-50/80">
                <td className={cn(`${bodyCellBase} text-[#1a1a1a] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                  {row.date}
                </td>
                <td className={cn(`${bodyCellBase} text-[#1a1a1a] text-left tabular-nums border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                  {row.value}
                </td>
                {isSleepHabit ? (
                  <>
                    <td className={cn(`${bodyCellBase} text-[#666] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.sleepTime || '—'}
                    </td>
                    <td className={cn(`${bodyCellBase} text-[#666] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.wakeTime || '—'}
                    </td>
                    <td className={cn(`${bodyCellBase} text-[#666] text-left tabular-nums`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.entries}
                    </td>
                  </>
                ) : (
                  <>
                    <td className={cn(`${bodyCellBase} text-[#666] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.time || '—'}
                    </td>
                    <td className={cn(`${bodyCellBase} text-[#666] text-left tabular-nums`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.entries}
                    </td>
                  </>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
});

// ====================
// MIDDAY-STYLE TRENDS SECTION
// ====================
