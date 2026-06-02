import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';

type OverviewStats = DashboardSnapshot['overviewStats'];
type OverviewStat = NonNullable<OverviewStats>[string];

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

function normalizeStatName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function statIdentity(stat: OverviewStat | undefined, fallbackId: string): string {
  const statLike = stat as { name?: unknown; id?: unknown } | undefined;
  return normalizeStatName(statLike?.name) || normalizeStatName(statLike?.id) || normalizeStatName(fallbackId);
}

function withIncomingIdentity(baseStat: OverviewStat, incomingStat: OverviewStat | undefined, incomingId: string): OverviewStat {
  const incomingLike = incomingStat as { name?: unknown; id?: unknown } | undefined;
  return {
    ...baseStat,
    id: String(incomingLike?.id || incomingId),
    name: String(incomingLike?.name || (baseStat as { name?: unknown }).name || ''),
  };
}

export function mergeOverviewStatsPreservingKnownValues(
  baseStats: OverviewStats | undefined,
  incomingStats: OverviewStats | undefined,
): OverviewStats {
  const base = baseStats || {};
  const incoming = incomingStats || {};
  const merged: OverviewStats = { ...incoming };
  const basePositiveByIdentity = new Map<string, OverviewStat>();
  const incomingIdentities = new Set<string>();

  for (const [habitId, baseStat] of Object.entries(base)) {
    if (!hasPositiveOverviewStat(baseStat)) continue;
    const identity = statIdentity(baseStat, habitId);
    if (identity) basePositiveByIdentity.set(identity, baseStat);
  }

  for (const [habitId, incomingStat] of Object.entries(incoming)) {
    const identity = statIdentity(incomingStat, habitId);
    if (identity) incomingIdentities.add(identity);

    if (hasPositiveOverviewStat(incomingStat)) continue;

    const matchingPositiveBase = identity ? basePositiveByIdentity.get(identity) : undefined;
    if (matchingPositiveBase) {
      merged[habitId] = withIncomingIdentity(matchingPositiveBase, incomingStat, habitId);
    }
  }

  for (const [habitId, baseStat] of Object.entries(base)) {
    const incomingStat = incoming[habitId];
    if (!incomingStat) {
      const identity = statIdentity(baseStat, habitId);
      if (identity && incomingIdentities.has(identity)) {
        continue;
      }
      merged[habitId] = baseStat;
      continue;
    }

    if (hasPositiveOverviewStat(baseStat) && !hasPositiveOverviewStat(incomingStat)) {
      merged[habitId] = baseStat;
    }
  }

  return merged;
}
