'use client';

import { useState, useEffect, memo, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser, useClerk } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, Monitor, Search } from 'lucide-react';
import { getDesktopCapabilities, useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { openInBrowser } from '@/lib/tauri-utils';
import { useHabits } from '@/contexts/HabitsContext';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { MetricSelectionTree } from '@/components/metric-selection-tree';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { QUERY_POLICY } from '@/lib/query-policies';
import { cn } from '@/lib/utils';
import { invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import { clearPersistedDashboardSnapshots } from '@/hooks/use-dashboard-snapshot-query';

export const INTEGRATIONS_GREEN_SWITCH_CLASS =
  'data-[state=checked]:bg-[#73bf1d] data-[state=unchecked]:bg-gray-200 focus-visible:ring-[#73bf1d]';

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string
        onSuccess: (publicToken: string, metadata: any) => void | Promise<void>
        onExit?: (error: any, metadata: any) => void
        receivedRedirectUri?: string | null
      }) => {
        open: () => void
        destroy?: () => void
      }
    }
  }
}

// Helper to convert 0-23 hour to 12-hour display string
export function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${period}`;
}

export const WHOOP_SYNC_PRESETS = [
  { id: 'smart', label: 'Smart', description: 'Only fetch what changed since the last successful sync.' },
  { id: '30d', label: '30d', description: 'Backfill the last 30 days.' },
  { id: '90d', label: '90d', description: 'Backfill the last 90 days.' },
  { id: '365d', label: '365d', description: 'Backfill the last 365 days.' },
  { id: 'custom', label: 'Custom', description: 'Choose an exact day count to backfill.' },
  { id: 'full', label: 'Full history', description: 'Pull all available Whoop history for this account.' },
] as const;

export type WhoopSyncMode = (typeof WHOOP_SYNC_PRESETS)[number]['id'];
export const MAX_CUSTOM_WHOOP_DAYS = 3650;

export type WhoopSyncFeedback = {
  type: 'syncing' | 'success' | 'error';
  message: string;
};

export function formatRelativeTime(dateValue: string | null | undefined): string {
  if (!dateValue) {
    return 'Never';
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleString();
}

export function formatErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallbackMessage;
}

export function formatRecordCount(count: number, singular: string, plural = `${singular}s`): string | null {
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildWhoopSyncFeedbackMessage(
  counts: { recovery?: number; sleep?: number; workouts?: number },
  syncLabel: string,
  freshness?: { latest_upstream_sleep_date?: string | null; latest_sleep_date?: string | null },
): string {
  const recovery = Number(counts.recovery || 0);
  const sleep = Number(counts.sleep || 0);
  const workouts = Number(counts.workouts || 0);
  const total = recovery + sleep + workouts;
  const latestSleepDate = freshness?.latest_sleep_date || freshness?.latest_upstream_sleep_date || null;
  const freshnessSuffix = latestSleepDate
    ? ` Latest Whoop sleep imported: ${latestSleepDate}.`
    : '';

  if (total <= 0) {
    return `Sync completed for ${syncLabel}. No new Whoop records were found.${freshnessSuffix}`;
  }

  const parts = [
    formatRecordCount(sleep, 'sleep record'),
    formatRecordCount(recovery, 'recovery record'),
    formatRecordCount(workouts, 'workout record'),
  ].filter(Boolean);

  return `Synced ${parts.join(', ')} from ${syncLabel}. Dashboard data refreshed.${freshnessSuffix}`;
}

export function isLikelyReactEvent(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ('nativeEvent' in (value as Record<string, unknown>) ||
        'preventDefault' in (value as Record<string, unknown>) ||
        'stopPropagation' in (value as Record<string, unknown>))
  );
}

export type WatcherRuntimeStatus = {
  is_running?: boolean;
  pid?: number | null;
  device_id?: string | null;
};

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function getLocalWatcherRuntimeStatus(): Promise<WatcherRuntimeStatus | null> {
  if (!getDesktopCapabilities().isDesktop) {
    return null;
  }

  try {
    return await withTimeout(
      invoke<WatcherRuntimeStatus>('get_watcher_status'),
      2500,
      null,
    );
  } catch (error) {
    console.warn('Failed to read local watcher runtime status:', error);
    return null;
  }
}

export const IPHONE_TIME_CARD_DESCRIPTION = 'Track your iPhone screen time and app usage by syncing across devices.';
export const IPHONE_TIME_ICLOUD_WARNING =
  'Ritual can only read iPhone Screen Time if this Mac user is signed into the same iCloud account as the iPhone and Screen Time data has synced locally.';

export type BiomeDrainSnapshot = {
  lastCheckedAtMs?: number | null;
  lastStatus?: string | null;
  lastProcessedCount?: number | null;
  lastError?: string | null;
};

export type BiomeOutboxDiagnostics = {
  path?: string | null;
  exists?: boolean;
  eventCount?: number;
  malformedLineCount?: number;
  bytes?: number;
};

export type BiomeIphoneDiagnostics = {
  syncDbPath?: string | null;
  syncDbExists?: boolean;
  syncDbError?: string | null;
  iosDevicePeerCount?: number;
  appInFocusRemotePath?: string | null;
  appInFocusRemoteExists?: boolean;
  deviceFolderCount?: number;
  sourceFileCount?: number;
  outbox?: BiomeOutboxDiagnostics;
  committedCursorsPath?: string | null;
  committedCursors?: Record<string, number>;
  lastDrain?: BiomeDrainSnapshot;
  notes?: string[];
};

export type IphoneTimeIntegrationStatusId =
  | 'not_desktop'
  | 'watcher_not_running'
  | 'waiting_for_icloud_sync'
  | 'source_ready'
  | 'queued'
  | 'syncing'
  | 'connected'
  | 'error';

type ScreenTimeSummaryRow = {
  day?: unknown;
  date?: unknown;
  active_ms?: unknown;
  activeMs?: unknown;
  total_active_ms?: unknown;
};

export type ScreenTimeSummary = Record<string, unknown> & {
  daily?: ScreenTimeSummaryRow[];
  total_active_ms?: unknown;
  totalActiveMs?: unknown;
  total_events?: unknown;
  totalEvents?: unknown;
  has_data?: unknown;
};

export type IphoneTimeIntegrationStatus = {
  status: IphoneTimeIntegrationStatusId;
  statusLabel: string;
  isConnected: boolean;
  warning: string | null;
  backendSummary: ScreenTimeSummary | null;
  diagnostics: BiomeIphoneDiagnostics | null;
  watcherStatus: WatcherRuntimeStatus | null;
  lastImportedDate: string | null;
  totalImportedEvents: number;
  totalActiveMs: number;
  outboxCount: number;
  localSourceFileCount: number;
  lastDrainLabel: string;
  lastError: string | null;
  notes: string[];
};

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function extractScreenTimeSummary(payload: unknown): ScreenTimeSummary | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  if (isObjectRecord(payload.data)) {
    return payload.data as ScreenTimeSummary;
  }
  return payload as ScreenTimeSummary;
}

function latestDayFromSummary(summary: ScreenTimeSummary | null): string | null {
  const daily = Array.isArray(summary?.daily) ? summary?.daily : [];
  let latest: string | null = null;
  for (const row of daily) {
    const day = typeof row?.day === 'string' ? row.day : typeof row?.date === 'string' ? row.date : null;
    const activeMs = Number(row?.active_ms ?? row?.activeMs ?? row?.total_active_ms ?? 0);
    if (!day || activeMs <= 0) {
      continue;
    }
    if (latest === null || day > latest) {
      latest = day;
    }
  }
  return latest;
}

function formatDrainLabel(snapshot?: BiomeDrainSnapshot | null): string {
  if (!snapshot?.lastCheckedAtMs) {
    return 'Never';
  }
  const checkedAt = new Date(snapshot.lastCheckedAtMs).toISOString();
  const status = snapshot.lastStatus ? `${snapshot.lastStatus} ` : '';
  const count = typeof snapshot.lastProcessedCount === 'number' ? `, ${snapshot.lastProcessedCount} rows` : '';
  return `${status}${formatRelativeTime(checkedAt)}${count}`;
}

function statusLabel(status: IphoneTimeIntegrationStatusId): string {
  switch (status) {
    case 'not_desktop':
      return 'Desktop app required';
    case 'watcher_not_running':
      return 'Computer Use is not running';
    case 'waiting_for_icloud_sync':
      return 'Waiting for iCloud sync';
    case 'source_ready':
      return 'Source files ready';
    case 'queued':
      return 'Queued for sync';
    case 'syncing':
      return 'Syncing';
    case 'connected':
      return 'Connected';
    case 'error':
      return 'Needs attention';
  }
}

export function deriveIphoneTimeIntegrationStatus({
  backendSummary,
  diagnostics,
  isDesktop,
  localError,
  watcherStatus,
}: {
  backendSummary: ScreenTimeSummary | null;
  diagnostics: BiomeIphoneDiagnostics | null;
  isDesktop: boolean;
  localError?: string | null;
  watcherStatus: WatcherRuntimeStatus | null;
}): IphoneTimeIntegrationStatus {
  const totalActiveMs = Number(backendSummary?.total_active_ms ?? backendSummary?.totalActiveMs ?? 0);
  const totalImportedEvents = Number(backendSummary?.total_events ?? backendSummary?.totalEvents ?? 0);
  const lastImportedDate = latestDayFromSummary(backendSummary);
  const backendHasFacts = totalActiveMs > 0 || Boolean(lastImportedDate) || Boolean(backendSummary?.has_data);
  const outboxCount = Number(diagnostics?.outbox?.eventCount ?? 0);
  const localSourceFileCount = Number(diagnostics?.sourceFileCount ?? 0);
  const lastDrainError = diagnostics?.lastDrain?.lastError || null;
  const syncDbError = diagnostics?.syncDbError || null;
  const lastDrainStatus = diagnostics?.lastDrain?.lastStatus || null;
  const isRecentlySyncing =
    lastDrainStatus === 'running' ||
    (lastDrainStatus === 'success' &&
      diagnostics?.lastDrain?.lastCheckedAtMs &&
      Date.now() - diagnostics.lastDrain.lastCheckedAtMs < 15_000);

  let status: IphoneTimeIntegrationStatusId = 'waiting_for_icloud_sync';
  let warning: string | null = null;

  if (!isDesktop) {
    status = 'not_desktop';
  } else if (localError || lastDrainError || syncDbError) {
    status = 'error';
  } else if (watcherStatus && watcherStatus.is_running === false && !backendHasFacts) {
    status = 'watcher_not_running';
  } else if (isRecentlySyncing) {
    status = 'syncing';
  } else if (outboxCount > 0) {
    status = 'queued';
  } else if (backendHasFacts) {
    status = 'connected';
  } else if (localSourceFileCount > 0) {
    status = 'source_ready';
  } else {
    status = 'waiting_for_icloud_sync';
  }

  if (isDesktop && localSourceFileCount <= 0 && !backendHasFacts) {
    warning = IPHONE_TIME_ICLOUD_WARNING;
  }

  const notes = [
    ...(diagnostics?.notes ?? []),
    ...(localError ? [localError] : []),
  ];

  return {
    status,
    statusLabel: statusLabel(status),
    isConnected: backendHasFacts,
    warning,
    backendSummary,
    diagnostics,
    watcherStatus,
    lastImportedDate,
    totalImportedEvents,
    totalActiveMs,
    outboxCount,
    localSourceFileCount,
    lastDrainLabel: formatDrainLabel(diagnostics?.lastDrain),
    lastError: localError || lastDrainError || syncDbError || null,
    notes,
  };
}

export function useIphoneTimeIntegrationStatus() {
  const { isDesktop } = useDesktopCapabilities();
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['iphone-time-integration-status', user?.id],
    queryFn: async (): Promise<IphoneTimeIntegrationStatus> => {
      const desktop = isDesktop;
      const endDate = todayISODate();
      const token = await getToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      let backendSummary: ScreenTimeSummary | null = null;
      let localError: string | null = null;

      try {
        const response = await fetchJsonWithTimeout(
          `/api/screen-time/stats/summary?start_date=2000-01-01&end_date=${endDate}`,
          { headers },
          8000,
        );
        if (response.ok) {
          backendSummary = extractScreenTimeSummary(await response.json());
        } else {
          localError = `Screen Time summary returned HTTP ${response.status}`;
        }
      } catch (error) {
        localError = formatErrorMessage(error, 'Screen Time summary is unavailable.');
      }

      let diagnostics: BiomeIphoneDiagnostics | null = null;
      let watcherStatus: WatcherRuntimeStatus | null = null;
      if (desktop) {
        watcherStatus = await getLocalWatcherRuntimeStatus();
        try {
          diagnostics = await withTimeout<BiomeIphoneDiagnostics | null>(
            invoke<BiomeIphoneDiagnostics>('get_biome_iphone_diagnostics') as Promise<BiomeIphoneDiagnostics | null>,
            4000,
            null,
          );
        } catch (error) {
          localError = formatErrorMessage(error, 'Biome diagnostics are unavailable.');
        }
      }

      return deriveIphoneTimeIntegrationStatus({
        backendSummary,
        diagnostics,
        isDesktop: desktop,
        localError,
        watcherStatus,
      });
    },
    staleTime: QUERY_POLICY.general.staleTime,
    enabled: !!user?.id,
  });
}

export async function fetchJsonWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function parseApiError(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const payload = await response.json();
    const detail = payload?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    if (detail && typeof detail === 'object') {
      return (
        detail.display_message ||
        detail.error_message ||
        detail.message ||
        fallbackMessage
      );
    }
  } catch {
    // ignore parse failures and fall back below
  }
  return fallbackMessage;
}
