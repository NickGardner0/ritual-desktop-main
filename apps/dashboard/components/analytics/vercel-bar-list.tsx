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

export type BarListRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

const RANGE_OPTIONS: { value: BarListRange; label: string }[] = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All' },
];

interface VercelBarListCardProps {
  tabs: { id: string; label: string }[];
  defaultTab?: string;
  data: Record<string, BarListItem[]>;
  activeRange?: BarListRange;
  onRangeChange?: (range: BarListRange) => void;
  showRangeSelector?: boolean;
}

// ── Change Badge ──

function ChangeBadge({ change, label }: { change?: number; label?: string }) {
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

  const isUp = change > 0;

  if (isUp) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[rgba(19,106,34,0.08)] text-[#136A22] tabular-nums">
        ↗ {display}%
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-[rgba(162,53,68,0.08)] text-[#A23544] tabular-nums">
      ↘ {display}%
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
}: VercelBarListCardProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '');

  const items = data[activeTab] || [];

  return (
    <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-4 pb-2">
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

          {/* Date range selector */}
          {showRangeSelector && onRangeChange && (
            <div className="flex items-center gap-0.5">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onRangeChange(opt.value)}
                  className={`text-[11px] px-2 py-0.5 transition-colors ${
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
      <div className="flex flex-col">
        {items.map((item, i) => (
          <div key={i} className="flex items-center px-5 py-[5px] hover:bg-[rgba(39,37,30,0.04)] transition-colors">
            <span className="text-[13px] font-normal text-[#27251E] flex-1 min-w-0 truncate">
              {item.icon && <span className="mr-1.5">{item.icon}</span>}
              {item.name}
            </span>
            <span className="text-[13px] font-normal text-[#27251E] tabular-nums text-right min-w-[120px] shrink-0">
              {item.value}
            </span>
            {(item.change !== undefined || item.changeLabel !== undefined) && (
              <span className="ml-2 shrink-0 min-w-[62px] text-right">
                <ChangeBadge change={item.change} label={item.changeLabel} />
              </span>
            )}
          </div>
        ))}

        {items.length === 0 && (
          <div className="flex items-center justify-center h-24 text-[12px] text-[rgba(39,37,30,0.35)]">
            No data available
          </div>
        )}
      </div>
    </div>
  );
}
