'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VercelBarListCard } from '@/components/analytics/vercel-bar-list';
import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';
import { format, subDays, startOfDay } from 'date-fns';
import { getTopApps, getTopDomains } from '@/lib/computerActivity/client';

interface ComputerTimeBarListProps {
  activeRange: BarListRange;
  onRangeChange: (range: BarListRange) => void;
}

function rangeLabel(range: BarListRange): string | undefined {
  if (range === 'ALL') return undefined;
  return `vs prior ${range}`;
}

/**
 * Merge raw rows that should appear as a single line in the UI.
 *
 * Upstream `getTopApps` can return multiple rows that share the same display
 * name (e.g. "ritual-desktop" backed by both a dev and a release bundle id, or
 * a process group whose bundle id changed). The bar list previously rendered
 * those as duplicate rows with contradictory deltas; merge them by display
 * name so each app/domain appears exactly once.
 */
function mergeByName<T extends { hours?: number }>(
  rows: T[],
  getName: (row: T) => string,
): { name: string; hours: number; sources: T[] }[] {
  const byName = new Map<string, { name: string; hours: number; sources: T[] }>();
  for (const row of rows) {
    const name = getName(row).trim();
    if (!name) continue;
    const existing = byName.get(name);
    if (existing) {
      existing.hours += row.hours || 0;
      existing.sources.push(row);
    } else {
      byName.set(name, { name, hours: row.hours || 0, sources: [row] });
    }
  }
  return [...byName.values()].sort((a, b) => b.hours - a.hours);
}

const BAR_LIST_ROW_LIMIT = 12;
const BAR_LIST_COMPARE_FETCH_LIMIT = 100;

function getRangeDatesLocal(range: BarListRange) {
  const now = new Date();
  const today = startOfDay(now);
  switch (range) {
    case '1W': return { from: subDays(today, 6), to: now };
    case '1M': return { from: subDays(today, 29), to: now };
    case '3M': return { from: subDays(today, 89), to: now };
    case '6M': return { from: subDays(today, 179), to: now };
    case '1Y': return { from: subDays(today, 364), to: now };
    case 'ALL': return { from: subDays(today, 1824), to: now };
    default: return { from: subDays(today, 29), to: now };
  }
}

function formatHours(hours: number): string {
  if (hours >= 100) return `${Math.round(hours)}h`;
  if (hours >= 10) return `${hours.toFixed(1)}h`;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const mins = Math.round(hours * 60);
  return `${mins}m`;
}

function computeAppOrDomainChange(currentHours: number, previousHours: number): number | undefined {
  const current = Number(currentHours) || 0;
  const previous = Number(previousHours) || 0;

  if (previous > 0) {
    const rawChange = ((current - previous) / previous) * 100;
    if (!Number.isFinite(rawChange)) return undefined;
    return Math.max(-100, Math.min(999, rawChange));
  }

  if (current <= 0) {
    return 0;
  }

  return undefined;
}

function getAppDisplayName(app: { app_bundle_id?: string | null; app_name?: string | null }): string {
  return String(app.app_name || app.app_bundle_id || 'Unknown');
}

function getDomainDisplayName(domain: { domain?: string | null }): string {
  return String(domain.domain || 'Unknown').toLowerCase();
}

export function ComputerTimeBarList({ activeRange, onRangeChange }: ComputerTimeBarListProps) {
  const [appsData, setAppsData] = useState<BarListItem[]>([]);
  const [domainsData, setDomainsData] = useState<BarListItem[]>([]);
  const fetchIdRef = useRef(0);

  // Phase 1: Fetch full-range data (fast, shows results immediately).
  // Phase 2: Fetch the prior equivalent window for % change comparison.
  const fetchData = useCallback(async () => {
    const id = ++fetchIdRef.current;
    try {
      const { from, to } = getRangeDatesLocal(activeRange);
      const startDate = format(from, 'yyyy-MM-dd');
      const endDate = format(to, 'yyyy-MM-dd');
      const [appsFullRaw, domainsFullRaw] = await Promise.all([
        getTopApps({ startDate, endDate }, BAR_LIST_COMPARE_FETCH_LIMIT),
        getTopDomains({ startDate, endDate }, BAR_LIST_COMPARE_FETCH_LIMIT),
      ]);

      if (id !== fetchIdRef.current) return; // stale

      // Merge upstream rows by display name so the same app/domain never
      // appears twice in the rendered list.
      const appsFull = mergeByName(appsFullRaw, getAppDisplayName).slice(0, BAR_LIST_ROW_LIMIT);
      const domainsFull = mergeByName(domainsFullRaw, getDomainDisplayName).slice(0, BAR_LIST_ROW_LIMIT);

      // Show data immediately without % changes.
      if (appsFull.length > 0) {
        const maxHours = Math.max(...appsFull.map((a) => a.hours), 0.01);
        setAppsData(
          appsFull.map((app) => ({
            name: app.name,
            value: formatHours(app.hours),
            barPercent: Math.round((app.hours / maxHours) * 100),
          })),
        );
      } else {
        setAppsData([]);
      }

      if (domainsFull.length > 0) {
        const maxHours = Math.max(...domainsFull.map((d) => d.hours), 0.01);
        setDomainsData(
          domainsFull.map((domain) => ({
            name: domain.name,
            value: formatHours(domain.hours),
            barPercent: Math.round((domain.hours / maxHours) * 100),
          })),
        );
      } else {
        setDomainsData([]);
      }

      // Skip comparison entirely for ALL — there is no meaningful prior window.
      if (activeRange === 'ALL') return;

      try {
        // Phase 2: Fetch prior equivalent window. If this slower compare phase
        // fails, preserve the already-loaded rows.
        if (id !== fetchIdRef.current) return; // stale

        const windowMs = to.getTime() - from.getTime();
        const priorTo = new Date(from.getTime() - 86400000); // day before current window
        const priorFrom = new Date(priorTo.getTime() - windowMs);
        const priorStartDate = format(priorFrom, 'yyyy-MM-dd');
        const priorEndDate = format(priorTo, 'yyyy-MM-dd');

        const [appsPriorRaw, domainsPriorRaw] = await Promise.all([
          getTopApps({ startDate: priorStartDate, endDate: priorEndDate }, BAR_LIST_COMPARE_FETCH_LIMIT),
          getTopDomains({ startDate: priorStartDate, endDate: priorEndDate }, BAR_LIST_COMPARE_FETCH_LIMIT),
        ]);

        if (id !== fetchIdRef.current) return; // stale

        const appsPriorByName = new Map<string, number>();
        for (const merged of mergeByName(appsPriorRaw, getAppDisplayName)) {
          appsPriorByName.set(merged.name, merged.hours);
        }
        const domainsPriorByName = new Map<string, number>();
        for (const merged of mergeByName(domainsPriorRaw, getDomainDisplayName)) {
          domainsPriorByName.set(merged.name, merged.hours);
        }

        if (appsFull.length > 0) {
          const maxHours = Math.max(...appsFull.map((a) => a.hours), 0.01);
          setAppsData(
            appsFull.map((app) => {
              const previousHours = appsPriorByName.get(app.name) || 0;
              const change = computeAppOrDomainChange(app.hours, previousHours);
              return {
                name: app.name,
                value: formatHours(app.hours),
                change,
                changeLabel: change === undefined && app.hours > 0 && previousHours <= 0 ? 'New' : undefined,
                barPercent: Math.round((app.hours / maxHours) * 100),
              };
            }),
          );
        }

        if (domainsFull.length > 0) {
          const maxHours = Math.max(...domainsFull.map((d) => d.hours), 0.01);
          setDomainsData(
            domainsFull.map((domain) => {
              const previousHours = domainsPriorByName.get(domain.name) || 0;
              const change = computeAppOrDomainChange(domain.hours, previousHours);
              return {
                name: domain.name,
                value: formatHours(domain.hours),
                change,
                changeLabel: change === undefined && domain.hours > 0 && previousHours <= 0 ? 'New' : undefined,
                barPercent: Math.round((domain.hours / maxHours) * 100),
              };
            }),
          );
        }
      } catch (compareError) {
        console.warn('[computer-time-bar-list] Compare fetch failed; preserving initial rows', compareError);
      }
    } catch (error) {
      console.warn('[computer-time-bar-list] Failed to load app/domain metrics', error);
      if (id === fetchIdRef.current) {
        setAppsData([]);
        setDomainsData([]);
      }
    }
  }, [activeRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <VercelBarListCard
      tabs={[
        { id: 'apps', label: 'Apps' },
        { id: 'domains', label: 'Websites' },
      ]}
      defaultTab="apps"
      data={{
        apps: appsData,
        domains: domainsData,
      }}
      showRangeSelector
      activeRange={activeRange}
      onRangeChange={onRangeChange}
      comparisonLabel={rangeLabel(activeRange)}
    />
  );
}
