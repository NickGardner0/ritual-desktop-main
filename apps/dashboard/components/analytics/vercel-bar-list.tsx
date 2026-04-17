'use client';

import React, { useState } from 'react';

// ── Types ──

export interface BarListItem {
  name: string;
  value: string;           // formatted display value (e.g. "7.3 Hours")
  change?: number;         // percent change (e.g. +2.3 or -1.8)
  changeLabel?: string;
  barPercent: number;      // 0-100, width of the bar relative to the max
  higherIsBetter?: boolean;
  icon?: string;
}

export type BarListRange = '12H' | '1D' | '1W' | '1M' | '3M' | '6M' | '1Y';

const RANGE_OPTIONS: { value: BarListRange; label: string }[] = [
  { value: '12H', label: '12H' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
];

interface VercelBarListCardProps {
  tabs: { id: string; label: string }[];
  defaultTab?: string;
  data: Record<string, BarListItem[]>;
  activeRange?: BarListRange;
  onRangeChange?: (range: BarListRange) => void;
  showRangeSelector?: boolean;
  visibleRows?: number;
  /** Optional label clarifying the % comparison baseline (e.g. "vs prior 1M"). */
  comparisonLabel?: string;
  emptyStateLabels?: Record<string, string>;
}

// ── Change Badge ──

function ChangeBadge({
  change,
  label,
  higherIsBetter,
}: {
  change?: number;
  label?: string;
  higherIsBetter?: boolean;
}) {
  if (label) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[rgba(39,37,30,0.06)] text-[rgba(39,37,30,0.58)] tabular-nums">
        {label}
      </span>
    );
  }

  if (change === undefined || !Number.isFinite(change)) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[rgba(39,37,30,0.06)] text-[rgba(39,37,30,0.45)] tabular-nums">
        —
      </span>
    );
  }

  const abs = Math.abs(change);
  const display = abs >= 100 ? Math.round(abs) : abs >= 10 ? Math.round(abs) : abs.toFixed(1);

  if (abs < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[rgba(39,37,30,0.06)] text-[rgba(39,37,30,0.45)] tabular-nums">
        — 0.0%
      </span>
    );
  }

  // Arrow always reflects numeric direction (up = value increased), color
  // reflects valence relative to higherIsBetter. This avoids the confusing
  // "↘ 999%" for a habit whose value actually went UP (and is bad).
  const isUp = change > 0;
  const isImprovement = higherIsBetter == null ? isUp : (higherIsBetter ? isUp : !isUp);
  const arrow = isUp ? '↗' : '↘';

  if (isImprovement) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[rgba(19,106,34,0.08)] text-[#136A22] tabular-nums">
        {arrow} {display}%
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[rgba(162,53,68,0.08)] text-[#A23544] tabular-nums">
      {arrow} {display}%
    </span>
  );
}

// ── Component ──

export function VercelBarListCard({
  tabs,
  defaultTab,
  data,
  activeRange,
  onRangeChange,
  showRangeSelector = false,
  visibleRows = 8,
  comparisonLabel,
  emptyStateLabels,
}: VercelBarListCardProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '');

  const items = data[activeTab] || [];
  const listMaxHeight = visibleRows > 0 ? `${visibleRows * 32}px` : undefined;

  return (
    <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-sm overflow-hidden flex flex-col h-full shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      {/* Header */}
      <div className="px-4 pt-3 pb-1.5">
        <div className="flex items-center justify-between">
          {/* Tabs */}
          <div className="flex items-center gap-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`text-[13px] first:pl-0 pr-3 py-1 transition-colors ${
                  activeTab === tab.id
                    ? 'font-medium text-[#27251E]'
                    : 'font-normal text-[rgba(39,37,30,0.40)] hover:text-[rgba(39,37,30,0.65)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Comparison baseline label (e.g. "vs prior 1M") */}
          {comparisonLabel && (
            <span className="text-[10.5px] font-normal text-[rgba(39,37,30,0.45)] tabular-nums px-1.5">
              {comparisonLabel}
            </span>
          )}

          {/* Date range selector */}
          {showRangeSelector && onRangeChange && (
            <div className="flex items-center gap-0">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onRangeChange(opt.value)}
                  className={`text-[11px] px-1.5 py-0.5 transition-colors ${
                    activeRange === opt.value
                      ? 'font-medium text-[#27251E]'
                      : 'font-normal text-[rgba(39,37,30,0.35)] hover:text-[rgba(39,37,30,0.55)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rows */}
      <div
        className="flex flex-col overflow-y-auto overflow-x-hidden"
        style={items.length > 0 ? { maxHeight: listMaxHeight } : undefined}
      >
        {items.map((item, i) => (
          <div key={i} className="flex items-center px-4 py-[4.5px] hover:bg-[rgba(39,37,30,0.04)] transition-colors">
            <span className="text-[12.5px] font-normal text-[#27251E] flex-1 min-w-0 truncate">
              {item.icon && <span className="mr-1.5">{item.icon}</span>}
              {item.name}
            </span>
            <span className="text-[12.5px] font-normal text-[#27251E] tabular-nums text-right min-w-[90px] shrink-0">
              {item.value}
            </span>
            {/* Always render the slot so rows stay aligned; ChangeBadge
                renders a neutral "—" when there's no comparable change. */}
            <span className="ml-1.5 shrink-0 min-w-[56px] text-right">
              <ChangeBadge
                change={item.change}
                label={item.changeLabel}
                higherIsBetter={item.higherIsBetter}
              />
            </span>
          </div>
        ))}

        {items.length === 0 && (
          <div className="flex items-center justify-center h-24 text-[12px] text-[rgba(39,37,30,0.35)]">
            {emptyStateLabels?.[activeTab] || 'No data available'}
          </div>
        )}
      </div>
    </div>
  );
}
