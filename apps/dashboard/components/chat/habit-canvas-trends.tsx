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
  formatUnit,
  formatValueWithUnit,
  type TrendsData,
} from './habit-canvas.shared';

export const TrendsSection = memo(function TrendsSection({ trends }: { trends: TrendsData }) {
  const improvers = trends.trends.filter(t => t.direction === 'up');
  const decliners = trends.trends.filter(t => t.direction === 'down');
  const stable = trends.trends.filter(t => t.direction === 'flat');
  
  const sortedImprovers = [...improvers].sort((a, b) => b.percent_change - a.percent_change);
  const sortedDecliners = [...decliners].sort((a, b) => a.percent_change - b.percent_change);
  
  const topImprover = sortedImprovers[0];
  
  return (
    <div className="space-y-8">
      {/* Improvers Table - Midday style with borders */}
      {sortedImprovers.length > 0 && (
        <div>
          <h4 className="text-sm font-normal text-[#1a1a1a] mb-4">
            Top improvements
          </h4>

          <div className="border border-[#ebebeb] overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[36%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-2 py-2 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Habit</th>
                  <th className="px-2 py-2 text-center text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Conf.</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Average</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {sortedImprovers.slice(0, 5).map((trend, index) => (
                  <tr
                    key={trend.habit_id}
                    className={cn(
                      "ritual-snappy-row",
                      index !== sortedImprovers.slice(0, 5).length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-2 py-2 text-[11px] text-black border-r border-[#e6e6e6] truncate" title={trend.habit_name}>{trend.habit_name}</td>
                    <td className="px-2 py-2 text-center text-[10px] uppercase text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.confidence}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#707070] tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#16a34a] tabular-nums whitespace-nowrap">
                      +{trend.percent_change.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Decliners Table - Midday style with borders */}
      {sortedDecliners.length > 0 && (
        <div>
          <h4 className="text-sm font-normal text-[#1a1a1a] mb-4">
            Top decliners
          </h4>

          <div className="border border-[#ebebeb] overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[36%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-2 py-2 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Habit</th>
                  <th className="px-2 py-2 text-center text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Conf.</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Average</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {sortedDecliners.slice(0, 5).map((trend, index) => (
                  <tr
                    key={trend.habit_id}
                    className={cn(
                      "ritual-snappy-row",
                      index !== sortedDecliners.slice(0, 5).length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-2 py-2 text-[11px] text-black border-r border-[#e6e6e6] truncate" title={trend.habit_name}>{trend.habit_name}</td>
                    <td className="px-2 py-2 text-center text-[10px] uppercase text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.confidence}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#707070] tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#dc2626] tabular-nums whitespace-nowrap">
                      {trend.percent_change.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Cards - Exact Midday style */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#ebebeb] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Habits tracked
          </div>
          <div className="text-sm font-normal text-[#1a1a1a] mb-1">
            {trends.summary.total_habits}
          </div>
          <div className="text-[10px] text-[#707070]">
            {trends.summary.improving} improving, {trends.summary.declining} declining
          </div>
        </div>

        {topImprover && (
          <div className="border border-[#ebebeb] p-3 bg-white">
            <div className="text-[12px] text-[#707070] mb-1">
              Biggest improvement
            </div>
            <div className="text-sm font-normal text-[#1a1a1a] mb-1">
              {topImprover.habit_name}
            </div>
            <div className="text-[10px] text-[#16a34a]">
              +{topImprover.percent_change.toFixed(0)}% increase
            </div>
          </div>
        )}
      </div>

      {/* Stable habits */}
      {stable.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[12px] leading-normal mb-2 text-[#707070]">
            Stable habits ({stable.length})
          </h4>
          <div className="text-[12px] leading-[17px] text-black">
            {stable.map(t => t.habit_name).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
});

// ====================
// MIDDAY-STYLE ANOMALIES SECTION
// ====================
