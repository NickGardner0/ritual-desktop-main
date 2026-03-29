'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VercelBarListCard } from '@/components/analytics/vercel-bar-list';
import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';
import { format, subDays, startOfDay } from 'date-fns';
import { computeMeaningfulPercentChange } from '@/lib/analytics-change';
import { getTopApps, getTopDomains } from '@/lib/computerActivity/client';

interface ComputerTimeBarListProps {
  activeRange: BarListRange;
  onRangeChange: (range: BarListRange) => void;
}

const BAR_LIST_ROW_LIMIT = 12;

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

export function ComputerTimeBarList({ activeRange, onRangeChange }: ComputerTimeBarListProps) {
  const [appsData, setAppsData] = useState<BarListItem[]>([]);
  const [domainsData, setDomainsData] = useState<BarListItem[]>([]);
  const fetchIdRef = useRef(0);

  // Phase 1: Fetch full-range data (fast, shows results immediately)
  const fetchData = useCallback(async () => {
    const id = ++fetchIdRef.current;
    try {
      const { from, to } = getRangeDatesLocal(activeRange);
      const startDate = format(from, 'yyyy-MM-dd');
      const endDate = format(to, 'yyyy-MM-dd');
      const [appsFull, domainsFull] = await Promise.all([
        getTopApps({ startDate, endDate }, BAR_LIST_ROW_LIMIT),
        getTopDomains({ startDate, endDate }, BAR_LIST_ROW_LIMIT),
      ]);

      if (id !== fetchIdRef.current) return; // stale

      // Show data immediately without % changes
      if (appsFull.length > 0) {
        const maxHours = Math.max(...appsFull.map((a: any) => a.hours || 0), 0.01);
        setAppsData(
          appsFull.map((app) => ({
            name: app.app_name || app.app_bundle_id || 'Unknown',
            value: formatHours(app.hours || 0),
            barPercent: Math.round(((app.hours || 0) / maxHours) * 100),
          })),
        );
      } else {
        setAppsData([]);
      }

      if (domainsFull.length > 0) {
        const maxHours = Math.max(...domainsFull.map((d) => d.hours || 0), 0.01);
        setDomainsData(
          domainsFull.map((domain) => ({
            name: domain.domain || 'Unknown',
            value: formatHours(domain.hours || 0),
            barPercent: Math.round(((domain.hours || 0) / maxHours) * 100),
          })),
        );
      } else {
        setDomainsData([]);
      }

      // Phase 2: Fetch half-range data in background for % changes (staggered to avoid rate limits)
      await new Promise((r) => setTimeout(r, 1500));
      if (id !== fetchIdRef.current) return; // stale after delay

      const midPoint = new Date((from.getTime() + to.getTime()) / 2);
      const firstEnd = format(midPoint, 'yyyy-MM-dd');
      const secondStart = format(new Date(midPoint.getTime() + 86400000), 'yyyy-MM-dd');

      const [appsFirst, appsSecond] = await Promise.all([
        getTopApps({ startDate, endDate: firstEnd }, 20),
        getTopApps({ startDate: secondStart, endDate }, 20),
      ]);
      const [domainsFirst, domainsSecond] = await Promise.all([
        getTopDomains({ startDate, endDate: firstEnd }, 20),
        getTopDomains({ startDate: secondStart, endDate }, 20),
      ]);

      if (id !== fetchIdRef.current) return; // stale

      // Update apps with % changes
      if (appsFull.length > 0) {
        const firstMap = new Map<string, number>();
        for (const a of appsFirst) {
          const key = a.app_name || a.app_bundle_id || '';
          firstMap.set(key, (firstMap.get(key) || 0) + (a.hours || 0));
        }
        const secondMap = new Map<string, number>();
        for (const a of appsSecond) {
          const key = a.app_name || a.app_bundle_id || '';
          secondMap.set(key, (secondMap.get(key) || 0) + (a.hours || 0));
        }
        const maxHours = Math.max(...appsFull.map((a) => a.hours || 0), 0.01);
        setAppsData(
          appsFull.map((app) => {
            const name = app.app_name || app.app_bundle_id || 'Unknown';
            const change = computeMeaningfulPercentChange(secondMap.get(name) || 0, firstMap.get(name) || 0, 'hours');
            return {
              name,
              value: formatHours(app.hours || 0),
              change,
              changeLabel: change === undefined ? 'New' : undefined,
              barPercent: Math.round(((app.hours || 0) / maxHours) * 100),
            };
          }),
        );
      }

      // Update domains with % changes
      if (domainsFull.length > 0) {
        const firstMap = new Map<string, number>();
        for (const d of domainsFirst) {
          const key = d.domain || '';
          firstMap.set(key, (firstMap.get(key) || 0) + (d.hours || 0));
        }
        const secondMap = new Map<string, number>();
        for (const d of domainsSecond) {
          const key = d.domain || '';
          secondMap.set(key, (secondMap.get(key) || 0) + (d.hours || 0));
        }
        const maxHours = Math.max(...domainsFull.map((d) => d.hours || 0), 0.01);
        setDomainsData(
          domainsFull.map((domain) => {
            const name = domain.domain || 'Unknown';
            const change = computeMeaningfulPercentChange(secondMap.get(name) || 0, firstMap.get(name) || 0, 'hours');
            return {
              name,
              value: formatHours(domain.hours || 0),
              change,
              changeLabel: change === undefined ? 'New' : undefined,
              barPercent: Math.round(((domain.hours || 0) / maxHours) * 100),
            };
          }),
        );
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
    // Delay initial fetch to avoid competing with primary analytics API calls
    const timer = setTimeout(() => fetchData(), 800);
    return () => clearTimeout(timer);
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
    />
  );
}
