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
  type AnomaliesData,
} from './habit-canvas.shared';
import { AlertTriangle } from 'lucide-react';

export const AnomaliesSection = memo(function AnomaliesSection({ anomalies }: { anomalies: AnomaliesData }) {
  return (
    <div className="space-y-6">
      {/* Anomalies Table - Midday style with borders */}
      {anomalies.anomalies.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-normal text-[#1a1a1a]">
              Unusual days
            </h4>
            <span className="text-[12px] text-[#707070]">
              {anomalies.summary.spikes} spikes, {anomalies.summary.drops} drops
            </span>
          </div>

          <div className="border border-[#ebebeb]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Date</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Value</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Type</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.anomalies.map((anomaly, index) => (
                  <tr
                    key={index}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== anomalies.anomalies.length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-3 py-2 text-[12px] text-black border-r border-[#e6e6e6] whitespace-nowrap">{formatDate(anomaly.date)}</td>
                    <td className="px-3 py-2 text-right text-[12px] text-black tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {anomaly.value.toFixed(1)}{formatUnit(anomalies.habit.unit)}
                    </td>
                    <td className="px-3 py-2 text-right border-r border-[#e6e6e6] whitespace-nowrap">
                      <span className={cn(
                        "text-[10px] uppercase",
                        anomaly.type === 'spike' ? 'text-[#dc2626]' : 'text-[#2563eb]'
                      )}>
                        {anomaly.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] text-[#707070] tabular-nums whitespace-nowrap">
                      {anomaly.z_score > 0 ? '+' : ''}{anomaly.z_score.toFixed(1)}σ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-[12px] text-[#707070]">
          <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
          No anomalies detected in this period
        </div>
      )}

      {/* Summary Cards - Midday style */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#ebebeb] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Baseline average
          </div>
          <div className="text-sm font-normal text-[#1a1a1a] mb-1">
            {anomalies.baseline_avg.toFixed(1)}{formatUnit(anomalies.habit.unit)}
          </div>
          <div className="text-[10px] text-[#707070]">
            Across {anomalies.days_analyzed} days analyzed
          </div>
        </div>

        <div className="border border-[#ebebeb] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Standard deviation
          </div>
          <div className="text-sm font-normal text-[#1a1a1a] mb-1">
            ±{anomalies.baseline_std_dev.toFixed(2)}
          </div>
          <div className="text-[10px] text-[#707070]">
            Normal variation range
          </div>
        </div>
      </div>
    </div>
  );
});

