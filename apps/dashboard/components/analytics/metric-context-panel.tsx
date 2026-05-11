'use client';

import React from 'react';
import { Activity, MessageCircle, PanelRightClose } from 'lucide-react';
import type { MetricContextInsight, MetricContextModel, MetricContextRelatedSignal } from './metric-context-builder';

interface MetricContextPanelProps {
  model: MetricContextModel | null;
  isLoading?: boolean;
  onClose: () => void;
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[#ededed] py-2 first:border-t-0">
      <span className="text-[12px] leading-none text-neutral-500">{label}</span>
      <span className="text-[12px] leading-none text-neutral-950 tabular-nums">{value}</span>
    </div>
  );
}

function SignalList({
  items,
  emptyLabel,
}: {
  items: MetricContextRelatedSignal[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-[12px] leading-5 text-neutral-500">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-hidden border border-[#e9e9e9]">
      {items.map((item) => (
        <div
          key={`${item.label}-${item.detail}`}
          className="grid grid-cols-[minmax(0,1fr)_max-content] gap-3 border-t border-[#ededed] px-2.5 py-2 first:border-t-0"
        >
          <div className="min-w-0">
            <div className="truncate text-[12px] leading-none text-neutral-950">{item.label}</div>
            <div className="mt-1 truncate text-[11px] leading-none text-neutral-500">{item.detail}</div>
          </div>
          <div className="self-center text-right text-[12px] leading-none text-neutral-700 tabular-nums">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function getInsightToneClass(tone: MetricContextInsight['tone']): string {
  if (tone === 'up') return 'text-emerald-700';
  if (tone === 'down') return 'text-amber-700';
  return 'text-neutral-950';
}

function InsightGrid({ items }: { items: MetricContextInsight[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden border border-[#e9e9e9] bg-[#e9e9e9]">
      {items.map((item) => (
        <div key={item.label} className="bg-[#fefefe] p-2.5">
          <div className="text-[11px] leading-none text-neutral-500">{item.label}</div>
          <div className={`mt-2 truncate text-[17px] leading-none tabular-nums ${getInsightToneClass(item.tone)}`}>
            {item.value}
          </div>
          <div className="mt-2 text-[11px] leading-4 text-neutral-500">{item.detail}</div>
        </div>
      ))}
    </div>
  );
}

function TrendBars({ model }: { model: MetricContextModel }) {
  const values = model.trend.series.map((row) => row.value);
  const maxValue = Math.max(...values, 0);

  return (
    <div className="flex h-16 items-end gap-1 border border-[#e9e9e9] px-2 py-2">
      {model.trend.series.map((row) => {
        const height = maxValue > 0 ? Math.max(4, Math.round((row.value / maxValue) * 48)) : 4;
        return (
          <div key={row.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full max-w-[16px] bg-neutral-900"
              style={{ height }}
              title={`${row.label}: ${row.displayValue}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function RecentRowsTable({ model }: { model: MetricContextModel }) {
  if (model.recentRows.length === 0) {
    return <p className="text-[12px] leading-5 text-neutral-500">{model.emptyState || 'No recent rows for this period.'}</p>;
  }

  return (
    <div className="overflow-hidden border border-[#e9e9e9]">
      {model.recentRows.map((row) => (
        <div
          key={row.date}
          className="grid grid-cols-[1fr_max-content] gap-3 border-t border-[#ededed] px-2.5 py-2 first:border-t-0"
        >
          <span className="text-[12px] leading-none text-neutral-600">{row.label}</span>
          <span className="text-right text-[12px] leading-none text-neutral-950 tabular-nums">
            {row.displayValue}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MetricContextPanel({ model, isLoading = false, onClose }: MetricContextPanelProps) {
  React.useEffect(() => {
    if (!model) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [model, onClose]);

  if (!model) return null;

  const hasComputerUsage = model.topApps.length > 0 || model.topDomains.length > 0;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-[#fefefe] sm:relative sm:inset-auto sm:h-full sm:min-w-[430px] sm:max-w-[680px] sm:basis-[44%] sm:shrink-0 sm:bg-transparent">
      <aside
        aria-label={`${model.title} Context`}
        onClick={(event) => event.stopPropagation()}
        className="relative z-[70] flex h-full w-full flex-col border-l border-[#dedede] bg-[#fbfbfa]"
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#e5e5e3] bg-[#f7f7f6] px-3">
          <div className="flex items-center gap-1.5 text-neutral-500">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e9e9e7] text-neutral-700">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <span className="text-[13px] font-medium leading-none text-neutral-700">Context</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-[#ededeb] hover:text-neutral-950"
            aria-label="Close Context"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>

        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#e5e5e3] bg-[#fbfbfa] px-3">
          <span className="rounded-md bg-[#e9e9e7] px-2 py-1 text-[12px] leading-none text-neutral-700">
            {model.periodLabel}
          </span>
          <span className="truncate text-[12px] leading-none text-neutral-500">
            {model.analysisPeriodLabel}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="pb-5">
            <h2 className="text-[22px] font-normal leading-tight tracking-normal text-neutral-950">
              {model.title}
            </h2>
            <div className="mt-1.5 text-[13px] leading-none text-neutral-500">{model.valueLabel}</div>
          </div>

          <section className="border-t border-[#e5e5e3] py-4">
            <div className="mb-2 text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
              Signals
            </div>
            <InsightGrid items={model.insightCards} />
          </section>

          <section className="border-t border-[#e5e5e3] py-4">
            <div className="mb-2 text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
              Snapshot
            </div>
            <div className="border border-[#e9e9e9] px-2.5">
              <SnapshotRow label="Total" value={model.snapshot.totalLabel} />
              <SnapshotRow label="Average" value={model.snapshot.averageLabel} />
              <SnapshotRow label="Min" value={model.snapshot.minLabel} />
              <SnapshotRow label="Max" value={model.snapshot.maxLabel} />
              <SnapshotRow label="Tracked days" value={model.snapshot.trackedDaysLabel} />
            </div>
          </section>

          <section className="border-t border-[#e5e5e3] py-4">
            <div className="mb-2 text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
              What Changed
            </div>
            <p className="text-[13px] leading-5 text-neutral-800">
              {isLoading ? 'Loading context...' : model.trend.sentence}
            </p>
          </section>

          <section className="border-t border-[#e5e5e3] py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
                Trend
              </div>
              <div className="text-[11px] leading-none text-neutral-500">{model.analysisPeriodLabel}</div>
            </div>
            <TrendBars model={model} />
          </section>

          <section className="border-t border-[#e5e5e3] py-4">
            <div className="mb-2 text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
              Recent Days
            </div>
            <RecentRowsTable model={model} />
          </section>

          <section className="border-t border-[#e5e5e3] py-4">
            <div className="mb-2 text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
              Nearby Signals
            </div>
            <SignalList
              items={model.relatedSignals}
              emptyLabel="No nearby signals for this period."
            />
          </section>

          <section className="border-t border-[#e5e5e3] py-4">
            <div className="mb-2 text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
              Source
            </div>
            <SignalList
              items={model.sourceSignals}
              emptyLabel="No source metadata for this metric."
            />
          </section>

          {hasComputerUsage && (
            <section className="border-t border-[#e5e5e3] py-4">
              <div className="mb-2 text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
                Computer Activity
              </div>
              <div className="space-y-3">
                <SignalList items={model.topApps} emptyLabel="No app rows for this period." />
                <SignalList items={model.topDomains} emptyLabel="No website rows for this period." />
              </div>
            </section>
          )}
        </div>

        <div className="shrink-0 border-t border-[#e5e5e3] bg-[#fbfbfa] p-3">
          <a
            href={model.askHref}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[#d9d9d7] bg-[#fefefe] px-3 text-[13px] font-medium text-neutral-800 hover:bg-[#f3f3f1]"
          >
            <MessageCircle className="h-4 w-4" />
            Ask Ritual about this
          </a>
        </div>
      </aside>
    </div>
  );
}

export default MetricContextPanel;
