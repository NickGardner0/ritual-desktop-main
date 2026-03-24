'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { VercelBarListCard } from '@/components/analytics/vercel-bar-list';
import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';
import { format, subDays, startOfDay } from 'date-fns';
import { isTauri } from '@/lib/tauri-utils';
import { invokeDetailedActivityWithInitRetry } from '@/lib/computerActivity/tauri-activity';

interface ComputerTimeBarListProps {
  activeRange: BarListRange;
  onRangeChange: (range: BarListRange) => void;
}

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

function computeChange(currentHours: number, previousHours: number): number {
  if (previousHours <= 0) return currentHours > 0 ? 100 : 0;
  const change = ((currentHours - previousHours) / previousHours) * 100;
  return Number.isFinite(change) ? change : 0;
}

async function fetchTopItems(
  endpoint: string,
  startDate: string,
  endDate: string,
  limit: number,
  token: string | null,
): Promise<any[]> {
  try {
    const res = await fetch(
      `${endpoint}?start_date=${startDate}&end_date=${endDate}&limit=${limit}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) return [];
    const json = await res.json();
    const items = json.data || json.apps || json.domains || [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function ComputerTimeBarList({ activeRange, onRangeChange }: ComputerTimeBarListProps) {
  const { getToken } = useAuth();
  const [appsData, setAppsData] = useState<BarListItem[]>([]);
  const [domainsData, setDomainsData] = useState<BarListItem[]>([]);
  const fetchIdRef = useRef(0);

  // Phase 1: Fetch full-range data (fast, shows results immediately)
  const fetchData = useCallback(async () => {
    const id = ++fetchIdRef.current;
    try {
      if (isTauri()) {
        const { from, to } = getRangeDatesLocal(activeRange);
        const fullStart = from.getTime();
        const fullEnd = to.getTime();
        const midPoint = new Date((fullStart + fullEnd) / 2);
        const firstEnd = midPoint.getTime();
        const secondStart = midPoint.getTime() + 86400000;

        const [full, firstHalf, secondHalf] = await Promise.all([
          invokeDetailedActivityWithInitRetry({ startTs: fullStart, endTs: fullEnd, limit: 1 }),
          invokeDetailedActivityWithInitRetry({ startTs: fullStart, endTs: firstEnd, limit: 1 }),
          invokeDetailedActivityWithInitRetry({ startTs: secondStart, endTs: fullEnd, limit: 1 }),
        ]);

        if (id !== fetchIdRef.current) return;

        const firstAppMap = new Map<string, number>();
        firstHalf.apps.forEach((app) => {
          const key = app.app_name || app.app_bundle_id || 'Unknown';
          firstAppMap.set(key, Number(app.total_duration_ms || 0));
        });
        const secondAppMap = new Map<string, number>();
        secondHalf.apps.forEach((app) => {
          const key = app.app_name || app.app_bundle_id || 'Unknown';
          secondAppMap.set(key, Number(app.total_duration_ms || 0));
        });
        const firstDomainMap = new Map<string, number>();
        firstHalf.domains.forEach((domain) => {
          const key = domain.domain || 'Unknown';
          firstDomainMap.set(key, Number(domain.total_duration_ms || 0));
        });
        const secondDomainMap = new Map<string, number>();
        secondHalf.domains.forEach((domain) => {
          const key = domain.domain || 'Unknown';
          secondDomainMap.set(key, Number(domain.total_duration_ms || 0));
        });

        const fullApps = full.apps.slice(0, 11);
        const fullDomains = full.domains.slice(0, 11);

        if (fullApps.length > 0) {
          const maxHours = Math.max(...fullApps.map((app) => (app.total_duration_ms || 0) / 3600000), 0.01);
          setAppsData(
            fullApps.map((app) => {
              const name = app.app_name || app.app_bundle_id || 'Unknown';
              const hours = (app.total_duration_ms || 0) / 3600000;
              return {
                name,
                value: formatHours(hours),
                change: computeChange(
                  (secondAppMap.get(name) || 0) / 3600000,
                  (firstAppMap.get(name) || 0) / 3600000,
                ),
                barPercent: Math.round((hours / maxHours) * 100),
              };
            }),
          );
        } else {
          setAppsData([]);
        }

        if (fullDomains.length > 0) {
          const maxHours = Math.max(...fullDomains.map((domain) => (domain.total_duration_ms || 0) / 3600000), 0.01);
          setDomainsData(
            fullDomains.map((domain) => {
              const name = domain.domain || 'Unknown';
              const hours = (domain.total_duration_ms || 0) / 3600000;
              return {
                name,
                value: formatHours(hours),
                change: computeChange(
                  (secondDomainMap.get(name) || 0) / 3600000,
                  (firstDomainMap.get(name) || 0) / 3600000,
                ),
                barPercent: Math.round((hours / maxHours) * 100),
              };
            }),
          );
        } else {
          setDomainsData([]);
        }

        return;
      }

      const token = await getToken();
      const { from, to } = getRangeDatesLocal(activeRange);
      const startDate = format(from, 'yyyy-MM-dd');
      const endDate = format(to, 'yyyy-MM-dd');

      const [appsFull, domainsFull] = await Promise.all([
        fetchTopItems('/api/watcher/stats/top-apps', startDate, endDate, 11, token),
        fetchTopItems('/api/watcher/stats/top-domains', startDate, endDate, 11, token),
      ]);

      if (id !== fetchIdRef.current) return; // stale

      // Show data immediately without % changes
      if (appsFull.length > 0) {
        const maxHours = Math.max(...appsFull.map((a: any) => a.hours || 0), 0.01);
        setAppsData(
          appsFull.map((app: any) => ({
            name: app.app_name || app.app_bundle_id || 'Unknown',
            value: formatHours(app.hours || 0),
            barPercent: Math.round(((app.hours || 0) / maxHours) * 100),
          })),
        );
      }

      if (domainsFull.length > 0) {
        const maxHours = Math.max(...domainsFull.map((d: any) => d.hours || 0), 0.01);
        setDomainsData(
          domainsFull.map((domain: any) => ({
            name: domain.domain || 'Unknown',
            value: formatHours(domain.hours || 0),
            barPercent: Math.round(((domain.hours || 0) / maxHours) * 100),
          })),
        );
      }

      // Phase 2: Fetch half-range data in background for % changes (staggered to avoid rate limits)
      await new Promise((r) => setTimeout(r, 1500));
      if (id !== fetchIdRef.current) return; // stale after delay

      const midPoint = new Date((from.getTime() + to.getTime()) / 2);
      const firstEnd = format(midPoint, 'yyyy-MM-dd');
      const secondStart = format(new Date(midPoint.getTime() + 86400000), 'yyyy-MM-dd');

      const [appsFirst, appsSecond] = await Promise.all([
        fetchTopItems('/api/watcher/stats/top-apps', startDate, firstEnd, 20, token),
        fetchTopItems('/api/watcher/stats/top-apps', secondStart, endDate, 20, token),
      ]);
      const [domainsFirst, domainsSecond] = await Promise.all([
        fetchTopItems('/api/watcher/stats/top-domains', startDate, firstEnd, 20, token),
        fetchTopItems('/api/watcher/stats/top-domains', secondStart, endDate, 20, token),
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
        const maxHours = Math.max(...appsFull.map((a: any) => a.hours || 0), 0.01);
        setAppsData(
          appsFull.map((app: any) => {
            const name = app.app_name || app.app_bundle_id || 'Unknown';
            return {
              name,
              value: formatHours(app.hours || 0),
              change: computeChange(secondMap.get(name) || 0, firstMap.get(name) || 0),
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
        const maxHours = Math.max(...domainsFull.map((d: any) => d.hours || 0), 0.01);
        setDomainsData(
          domainsFull.map((domain: any) => {
            const name = domain.domain || 'Unknown';
            return {
              name,
              value: formatHours(domain.hours || 0),
              change: computeChange(secondMap.get(name) || 0, firstMap.get(name) || 0),
              barPercent: Math.round(((domain.hours || 0) / maxHours) * 100),
            };
          }),
        );
      }
    } catch {
      // Silently fail
    }
  }, [activeRange, getToken]);

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
