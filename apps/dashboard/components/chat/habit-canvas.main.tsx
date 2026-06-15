'use client';

import { memo } from 'react';
import { X } from 'lucide-react';
import { AnomaliesSection } from './habit-canvas-anomalies';
import { HabitDailyTable } from './habit-canvas-daily-table';
import { TrendsSection } from './habit-canvas-trends';
import { WeeklyOverviewSection } from './habit-canvas-weekly';
import { cn, formatDate, formatDateRange, formatTimeList, formatValueWithUnit, isSleepDurationHabit, type HabitCanvasData } from './habit-canvas.shared';

interface HabitCanvasProps {
  data: HabitCanvasData;
  onClose?: () => void;
}

const HabitCanvas = memo(function HabitCanvas({ data, onClose }: HabitCanvasProps) {
  if (!data) return null;

  const hasTrends = data.trends && data.trends.success;
  const hasAnomalies = data.anomalies && data.anomalies.success;
  const hasWeeklyOverview = data.weeklyOverview && data.weeklyOverview.success;
  const hasStats = data.stats;
  const hasDailyData = data.dailyData && data.dailyData.length > 0;

  const isHoursBased = data.stats?.totalHours !== undefined && data.stats.totalHours > 0;
  const unit = data.stats?.unit;
  const totalValue = isHoursBased ? data.stats?.totalHours : data.stats?.totalAmount;
  
  return (
    <div className="w-full h-full bg-white flex flex-col overflow-hidden">
      {/* Header — single title with date range and close */}
      <div className="flex items-start justify-between border-b border-[#e6e6e6] px-6 py-4 shrink-0">
        <div>
          <h2 className="text-lg font-normal text-[#1a1a1a] leading-tight">
            {data.title}
          </h2>
          {data.dateRange && (
            <p className="text-xs text-[#666] mt-1">
              {formatDateRange(data.dateRange.start, data.dateRange.end)}
            </p>
          )}
          {hasTrends && data.trends && (
            <p className="text-xs text-[#666] mt-1">
              Last {data.trends.window_days} days vs prior {data.trends.window_days} days
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-[#999] hover:text-black transition-colors mt-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main content - scrollable, Midday padding */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Trends Section */}
        {hasTrends && data.trends && (
          <TrendsSection trends={data.trends} />
        )}

        {/* Anomalies Section */}
        {hasAnomalies && data.anomalies && (
          <AnomaliesSection anomalies={data.anomalies} />
        )}

        {/* Weekly Overview Section */}
        {hasWeeklyOverview && data.weeklyOverview && (
          <WeeklyOverviewSection weeklyOverview={data.weeklyOverview} />
        )}

        {/* Stats Summary - Midday style */}
        {hasStats && !hasTrends && !hasAnomalies && !hasWeeklyOverview && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {totalValue !== undefined && (
              <div className="border border-[#ebebeb] p-3 bg-white">
                <div className="text-[12px] text-[#707070] mb-1">Total</div>
                <div className="text-sm font-normal text-[#1a1a1a]">
                  {formatValueWithUnit(totalValue, unit, isHoursBased)}
                </div>
              </div>
            )}
            {data.stats && data.stats.avgPerDay !== undefined && (
              <div className="border border-[#ebebeb] p-3 bg-white">
                <div className="text-[12px] text-[#707070] mb-1">Average per day</div>
                <div className="text-sm font-normal text-[#1a1a1a]">
                  {formatValueWithUnit(data.stats.avgPerDay, unit, isHoursBased)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Daily Data Table - Midday style with borders */}
        {hasDailyData && data.dailyData && !hasWeeklyOverview && (() => {
          const isSleepData = isSleepDurationHabit(data.habitName);
          
          return (
            <div className="mb-6">
              <h4 className="text-sm font-normal text-[#1a1a1a] mb-4">
                Daily breakdown
              </h4>

              <HabitDailyTable
                rows={data.dailyData.map((day) => {
                  const displayValue = day.hours !== undefined
                    ? formatValueWithUnit(day.hours, unit, true)
                    : day.amount !== undefined
                      ? formatValueWithUnit(day.amount, unit, false)
                      : day.value !== undefined
                        ? formatValueWithUnit(day.value, unit, isHoursBased)
                        : '—';

                  return {
                    date: formatDate(day.date),
                    value: displayValue,
                    entries: `${day.entries?.length || 0}`,
                    time: formatTimeList((day.entries || []).map((entry) => entry.time)),
                    sleepTime: formatTimeList((day.entries || []).map((entry) => entry.sleep_start)),
                    wakeTime: formatTimeList((day.entries || []).map((entry) => entry.sleep_end)),
                  };
                })}
                isSleepHabit={isSleepData}
                emptyText="No habit rows available for this range."
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
});

export default HabitCanvas;
export { HabitCanvas };
