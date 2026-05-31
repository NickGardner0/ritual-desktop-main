import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';

type OverviewStats = DashboardSnapshot['overviewStats'];

export type DashboardOverviewSnapshotResponse = {
  habits?: unknown[];
  overviewStats?: OverviewStats;
  meta?: {
    generatedAt?: number;
  };
};

export function hasPositiveOverviewStat(stat: unknown): boolean {
  const value = stat as { total?: unknown; days_with_data?: unknown } | null | undefined;
  const total = Number(value?.total || 0);
  const daysWithData = Number(value?.days_with_data || 0);
  return (Number.isFinite(total) && total > 0) || daysWithData > 0;
}

export function countPositiveOverviewStats(stats?: OverviewStats): number {
  if (!stats) return 0;
  return Object.values(stats).filter(hasPositiveOverviewStat).length;
}

export function isDegradedOverviewPayload(
  baseStats: OverviewStats | undefined,
  incomingStats: OverviewStats | undefined,
): boolean {
  const basePositive = countPositiveOverviewStats(baseStats);
  const incomingPositive = countPositiveOverviewStats(incomingStats);

  if (!incomingStats || Object.keys(incomingStats).length === 0) return basePositive > 0;
  if (basePositive === 0) return false;
  if (incomingPositive === 0) return true;

  return incomingPositive <= Math.max(1, Math.floor(basePositive * 0.35));
}

export function mergeOverviewStatsPreservingKnownValues(
  baseStats: OverviewStats | undefined,
  incomingStats: OverviewStats | undefined,
): OverviewStats {
  const base = baseStats || {};
  const incoming = incomingStats || {};
  const merged: OverviewStats = { ...incoming };

  for (const [habitId, baseStat] of Object.entries(base)) {
    const incomingStat = incoming[habitId];
    if (!incomingStat) {
      merged[habitId] = baseStat;
      continue;
    }

    if (hasPositiveOverviewStat(baseStat) && !hasPositiveOverviewStat(incomingStat)) {
      merged[habitId] = baseStat;
    }
  }

  return merged;
}

