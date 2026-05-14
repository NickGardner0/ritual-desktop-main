'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Activity, MessageCircle, PanelRightClose } from 'lucide-react';
import type { MetricContextModel, MetricContextRelatedSignal } from './metric-context-builder';

interface MetricContextPanelProps {
  model: MetricContextModel | null;
  isLoading?: boolean;
  onClose: () => void;
}

function SectionHeading({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-neutral-500">
        {children}
      </div>
      {right ? <div className="text-[11px] leading-none text-neutral-500">{right}</div> : null}
    </div>
  );
}

function DetailRows({ rows }: { rows: Array<{ label: string; value: string; detail?: string }> }) {
  return (
    <div className="border-y border-[#ececea]">
      {rows.map((row) => (
        <div
          key={`${row.label}-${row.value}`}
          className="grid grid-cols-[minmax(0,1fr)_max-content] gap-4 border-t border-[#ececea] py-2 first:border-t-0"
        >
          <div className="min-w-0">
            <div className="truncate text-[12px] leading-none text-neutral-600">{row.label}</div>
            {row.detail ? (
              <div className="mt-1 truncate text-[11px] leading-none text-neutral-500">{row.detail}</div>
            ) : null}
          </div>
          <div className="self-center text-right text-[12px] leading-none text-neutral-950 tabular-nums">
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendBars({ model }: { model: MetricContextModel }) {
  const values = model.trend.series.map((row) => row.value);
  const maxValue = Math.max(...values, 0);

  return (
    <div className="flex h-10 items-end gap-1 border-y border-[#ececea] py-2">
      {model.trend.series.map((row) => {
        const height = maxValue > 0 ? Math.max(3, Math.round((row.value / maxValue) * 28)) : 3;
        return (
          <div key={row.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full max-w-[10px] bg-neutral-900"
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
    <div className="border-y border-[#ececea]">
      {model.recentRows.map((row) => (
        <div
          key={row.date}
          className="grid grid-cols-[1fr_max-content] gap-3 border-t border-[#ececea] py-2 first:border-t-0"
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

function getUsefulRelatedSignals(items: MetricContextRelatedSignal[]): MetricContextRelatedSignal[] {
  const hiddenLabels = new Set(['Highest day', 'Lowest logged day', 'Coverage']);
  const seen = new Set<string>();

  return items
    .filter((item) => !hiddenLabels.has(item.label))
    .filter((item) => {
      const key = `${item.label}:${item.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function getSourceLabel(model: MetricContextModel): string | null {
  const source = model.sourceSignals.find((item) => item.label.toLowerCase() === 'source');
  return source?.value || null;
}

export function MetricContextPanel({ model, isLoading = false, onClose }: MetricContextPanelProps) {
  const [portalHost, setPortalHost] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setPortalHost(document.body);
  }, []);

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
  if (!portalHost) return null;

  const hasComputerUsage = model.topApps.length > 0 || model.topDomains.length > 0;
  const changeInsight = model.insightCards.find((item) => item.label === 'Change');
  const latestInsight = model.insightCards.find((item) => item.label === 'Latest');
  const sourceLabel = getSourceLabel(model);
  const usefulRelatedSignals = getUsefulRelatedSignals(model.relatedSignals);
  const glanceRows = [
    ...(changeInsight ? [{ label: 'Change vs prior window', value: changeInsight.value }] : []),
    { label: 'Average logged day', value: model.snapshot.averageLabel },
    { label: 'Logged days', value: model.snapshot.trackedDaysLabel },
    ...(latestInsight ? [{ label: 'Latest', value: latestInsight.value, detail: latestInsight.detail }] : []),
  ];

  return createPortal(
    <div className="fixed inset-y-0 right-0 z-[80] flex w-full bg-[#fefefe] sm:w-[clamp(520px,42vw,680px)]">
      <aside
        aria-label={`${model.title} Context`}
        onClick={(event) => event.stopPropagation()}
        className="flex h-screen w-full flex-col border-l border-[#dedede] bg-[#fefefe]"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#e7e7e5] bg-[#fefefe] px-3">
          <div className="flex items-center gap-1.5 text-neutral-500">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#f2f2f1] text-neutral-700">
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

        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#e7e7e5] bg-[#fefefe] px-3">
          <span className="rounded-md bg-[#f2f2f1] px-2 py-1 text-[12px] leading-none text-neutral-700">
            {model.periodLabel}
          </span>
          <span className="truncate text-[12px] leading-none text-neutral-500">
            {model.analysisPeriodLabel}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="pb-4">
            <h2 className="text-[21px] font-normal leading-tight tracking-normal text-neutral-950">
              {model.title}
            </h2>
            <div className="mt-1.5 text-[13px] leading-none text-neutral-500">{model.valueLabel}</div>
            {sourceLabel ? (
              <div className="mt-3 text-[12px] leading-none text-neutral-500">
                Source: {sourceLabel}
              </div>
            ) : null}
          </div>

          <section className="border-t border-[#ececea] py-4">
            <SectionHeading>At a glance</SectionHeading>
            <DetailRows rows={glanceRows} />
          </section>

          <section className="border-t border-[#ececea] py-4">
            <SectionHeading>What changed</SectionHeading>
            <p className="text-[13px] leading-5 text-neutral-700">
              {isLoading ? 'Loading context...' : model.trend.sentence}
            </p>
          </section>

          <section className="border-t border-[#ececea] py-4">
            <SectionHeading right={model.analysisPeriodLabel}>Recent shape</SectionHeading>
            <TrendBars model={model} />
          </section>

          <section className="border-t border-[#ececea] py-4">
            <SectionHeading>Recent days</SectionHeading>
            <RecentRowsTable model={model} />
          </section>

          {usefulRelatedSignals.length > 0 && (
            <section className="border-t border-[#ececea] py-4">
              <SectionHeading>Related</SectionHeading>
              <DetailRows
                rows={usefulRelatedSignals.map((item) => ({
                  label: item.label,
                  value: item.value,
                  detail: item.detail,
                }))}
              />
            </section>
          )}

          {hasComputerUsage && (
            <section className="border-t border-[#ececea] py-4">
              <SectionHeading>Computer activity</SectionHeading>
              <div className="space-y-3">
                <DetailRows
                  rows={model.topApps.slice(0, 5).map((item) => ({
                    label: item.label,
                    value: item.value,
                    detail: item.detail,
                  }))}
                />
                {model.topDomains.length > 0 ? (
                  <DetailRows
                    rows={model.topDomains.slice(0, 5).map((item) => ({
                      label: item.label,
                      value: item.value,
                      detail: item.detail,
                    }))}
                  />
                ) : null}
              </div>
            </section>
          )}
        </div>

        <div className="shrink-0 border-t border-[#e7e7e5] bg-[#fefefe] p-3">
          <a
            href={model.askHref}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[#d9d9d7] bg-[#fefefe] px-3 text-[13px] font-medium text-neutral-800 hover:bg-[#f3f3f1]"
          >
            <MessageCircle className="h-4 w-4" />
            Ask Ritual about this
          </a>
        </div>
      </aside>
    </div>,
    portalHost,
  );
}

export default MetricContextPanel;
