/**
 * Integrations Client Component
 * 
 * Handles all client-side interactions:
 * - OAuth flows
 * - Connection/disconnection
 * - Sync operations
 * - Polling for desktop app
 * 
 * Receives initial connection status from Server Component
 */

'use client';

import { useState, useEffect, memo, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser, useClerk } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, Monitor, Search } from 'lucide-react';
import { openInBrowser, isTauri } from '@/lib/tauri-utils';
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

export const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
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
): string {
  const recovery = Number(counts.recovery || 0);
  const sleep = Number(counts.sleep || 0);
  const workouts = Number(counts.workouts || 0);
  const total = recovery + sleep + workouts;

  if (total <= 0) {
    return `Sync completed for ${syncLabel}. No new Whoop records were found.`;
  }

  const parts = [
    formatRecordCount(sleep, 'sleep record'),
    formatRecordCount(recovery, 'recovery record'),
    formatRecordCount(workouts, 'workout record'),
  ].filter(Boolean);

  return `Synced ${parts.join(', ')} from ${syncLabel}. Dashboard data refreshed.`;
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
  if (!isTauri()) {
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

/**
 * Fetch Whoop connection status with React Query (cached!)
 */
export function useWhoopStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['whoop-status', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch('/api/integrations/whoop/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Whoop status');
      }

      const data = await response.json();
      return data; // return full status object
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

/**
 * Fetch Apple Watch/Health connection status with React Query
 * Checks for registered devices from the iOS companion app
 */
export function useAppleWatchStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['apple-watch-status', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch('/api/wearables/apple/devices', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Apple Watch status');
      }

      const data = await response.json();
      // Check if there's at least one active iOS device
      const activeDevices = (data.devices || []).filter((d: any) => d.is_active && d.platform === 'ios');
      return {
        connected: activeDevices.length > 0,
        devices: activeDevices,
        lastSyncAt: activeDevices[0]?.last_sync_at || null,
        deviceName: activeDevices[0]?.device_name || null,
      };
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

export function useWearableConnections() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['wearable-connections', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch('/api/wearables/connections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch wearable connections');
      }

      return response.json();
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

export function useFinancialConnections() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['financial-connections', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch('/api/financial/connections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch financial connections');
      }

      return response.json();
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

/**
 * Fetch Computer Use status with React Query
 * Checks for registered watcher devices (macOS desktop)
 */
export function useComputerTrackingStatus() {
  const { user } = useUser();

  return useQuery({
    queryKey: ['computer-tracking-status', user?.id],
    queryFn: async () => {
      try {
        const response = await fetch('/api/watcher/devices');
        
        if (!response.ok) {
          return { connected: false, enabled: false, deviceName: null };
        }

        const data = await response.json();
        const devices = data.devices || [];
        const activeDevice = devices.find((d: any) => d.is_enabled);
        
        return {
          connected: devices.length > 0,
          enabled: !!activeDevice,
          deviceName: activeDevice?.device_name || devices[0]?.device_name || 'My Mac',
          deviceId: activeDevice?.device_id || devices[0]?.device_id || null,
        };
      } catch {
        return { connected: false, enabled: false, deviceName: null, deviceId: null };
      }
    },
    staleTime: QUERY_POLICY.general.staleTime,
    enabled: !!user?.id,
  });
}

export function useIntegrationsOverview() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['integrations-overview', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const authHeaders: HeadersInit = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const fetchBackendJson = async (path: string, fallback: any) => {
        try {
          const response = await fetchJsonWithTimeout(
            path,
            { headers: authHeaders },
            8000,
          );
          if (!response.ok) {
            return fallback;
          }
          return await response.json();
        } catch {
          return fallback;
        }
      };

      const [
        whoopResponse,
        appleWatchResponse,
        wearablesResponse,
        financialResponse,
        computerTrackingResponse,
      ] = await Promise.all([
        fetchBackendJson('/api/integrations/whoop/status', { connected: false, sync_hour: 9 }),
        fetchBackendJson('/api/wearables/apple/devices', { devices: [] }),
        fetchBackendJson('/api/wearables/connections', { connections: [] }),
        fetchBackendJson('/api/financial/connections', { connections: [] }),
        fetchBackendJson('/api/watcher/devices', { devices: [] }),
      ]);
      const whoopStatusPayload = whoopResponse;
      const appleWatchPayload = appleWatchResponse;
      const wearablesPayload = wearablesResponse;
      const financialPayload = financialResponse;
      const computerTrackingPayload = computerTrackingResponse;

      const wearableConnections = wearablesPayload?.connections || [];
      const appleHealthConnection = wearableConnections.find((item: any) => item.provider === 'apple_health');
      const whoopConnection = wearableConnections.find((item: any) => item.provider === 'whoop');
      const appleDevices = (appleWatchPayload?.devices || []).filter((device: any) => device.is_active && device.platform === 'ios');
      const watcherDevices = computerTrackingPayload?.devices || [];
      const activeWatcherDevice = watcherDevices.find((device: any) => device.is_enabled);
      const localWatcherStatus =
        watcherDevices.length > 0
          ? null
          : await getLocalWatcherRuntimeStatus();
      const localWatcherConnected = Boolean(localWatcherStatus?.is_running || localWatcherStatus?.device_id);
      const appleWatchConnected = appleDevices.length > 0 || appleHealthConnection?.status === 'active';
      const whoopConnected = Boolean(whoopStatusPayload?.connected || whoopConnection?.status === 'active');

      return {
        whoopStatus: {
          ...whoopStatusPayload,
          connected: whoopConnected,
          sync_hour: whoopStatusPayload?.sync_hour ?? whoopConnection?.sync_hour ?? 9,
          last_sync_at:
            whoopStatusPayload?.last_sync_at
            || whoopConnection?.last_sync_at
            || whoopConnection?.last_successful_sync_at
            || null,
          is_active: whoopStatusPayload?.is_active ?? (whoopConnection?.status === 'active'),
        },
        appleWatchStatus: {
          connected: appleWatchConnected,
          devices: appleDevices,
          lastSyncAt:
            appleDevices[0]?.last_sync_at
            || appleHealthConnection?.last_sync_at
            || appleHealthConnection?.last_successful_sync_at
            || null,
          deviceName: appleDevices[0]?.device_name || (appleWatchConnected ? 'Apple Health Device' : null),
        },
        wearableConnections: wearablesPayload,
        financialConnections: financialPayload,
        computerTrackingStatus: {
          connected: watcherDevices.length > 0 || localWatcherConnected,
          enabled: !!activeWatcherDevice || Boolean(localWatcherStatus?.is_running),
          deviceName:
            activeWatcherDevice?.device_name
            || watcherDevices[0]?.device_name
            || (localWatcherConnected ? 'This Mac' : 'My Mac'),
          deviceId: activeWatcherDevice?.device_id || watcherDevices[0]?.device_id || localWatcherStatus?.device_id || null,
        },
      };
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

// Memoized integration card
export const IntegrationCard = memo(({
  logo,
  title,
  description,
  comingSoon,
  isStatusLoading,
  isConnected,
  isConnecting,
  isSyncing,
  connectVariant = 'primary',
  connectLabel = 'Connect',
  syncLabel = 'Sync Now',
  details,
  onConnect,
  onSync,
  onDisconnect,
  onDetails,
  extraActions,
  descriptionLineClamp = 2
}: {
  logo: React.ReactNode
  title: string
  description: string
  /** Card copy uses line-clamp; higher values avoid ellipsis on longer Plaid descriptions. */
  descriptionLineClamp?: 2 | 3 | 4
  comingSoon?: boolean
  isStatusLoading?: boolean
  isConnected?: boolean
  isConnecting?: boolean
  isSyncing?: boolean
  connectVariant?: 'primary' | 'outline'
  connectLabel?: string
  syncLabel?: string
  details?: React.ReactNode
  onConnect?: () => void
  onSync?: () => void
  onDisconnect?: () => void
  onDetails?: () => void
  extraActions?: React.ReactNode
}) => (
  <div className="bg-white border border-gray-300 px-3 py-2.5 flex flex-col h-[212px] rounded-sm">
        <div className="mb-1 flex h-7 items-center [&>*]:max-h-6 [&>*]:w-auto [&_img]:max-h-6 [&_img]:w-auto">
      {logo}
    </div>
    <div className="flex items-center mb-0.5">
      <h3 className="text-[14px] leading-5 font-medium">{title}</h3>
      {comingSoon && (
        <span className="ml-2 text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Coming soon</span>
      )}
    </div>
    <p
      className={cn(
        'text-[12px] leading-[1.35] text-gray-500 mb-2 flex-grow',
        descriptionLineClamp === 4 && 'line-clamp-4',
        descriptionLineClamp === 3 && 'line-clamp-3',
        descriptionLineClamp === 2 && 'line-clamp-2'
      )}
    >
      {description}
    </p>

    {details ? (
      <div className="mb-2.5">
        {details}
      </div>
    ) : null}

    <div className="mt-auto flex items-center gap-1.5">
      {isStatusLoading ? (
        <>
          <button
            type="button"
            disabled
            className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm text-gray-500 bg-[#F8F8F8] cursor-default"
          >
            Checking...
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
            >
              Details
            </button>
          )}
        </>
      ) : isConnected ? (
        <>
          <button
            onClick={onDisconnect}
            className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full bg-[#73bf1d] transition-colors focus:outline-none focus:ring-2 focus:ring-[#73bf1d] focus:ring-offset-2"
            role="switch"
            aria-checked="true"
          >
            <span className="pointer-events-none inline-block h-4 w-4 translate-x-4 transform rounded-full bg-white shadow-sm transition-transform" />
          </button>
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="px-2.5 py-1.5 text-[13px] whitespace-nowrap border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50"
            >
              {isSyncing ? (
                <>
                  <BrailleSpinner className="mr-1.5 inline-block text-sm" />
                  Syncing...
                </>
              ) : (
                syncLabel
              )}
            </button>
          )}
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900"
            >
              Details
            </button>
          )}
          {extraActions}
        </>
      ) : comingSoon ? (
        <>
          <button
            type="button"
            className="px-2.5 py-1.5 text-[13px] bg-black text-white rounded-sm"
          >
            Connect
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
            >
              Details
            </button>
          )}
        </>
      ) : (
        <>
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className={
              connectVariant === 'outline'
                ? "px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8] disabled:opacity-50 text-gray-900"
                : "px-2.5 py-1.5 text-[13px] bg-black text-white rounded-sm disabled:opacity-50"
            }
          >
            {isConnecting ? (
              <>
                <BrailleSpinner className="mr-1.5 inline-block text-sm" />
                Connecting...
              </>
            ) : (
              connectLabel
            )}
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
            >
              Details
            </button>
          )}
        </>
      )}
    </div>
  </div>
));

IntegrationCard.displayName = 'IntegrationCard';

// ================================
// MAIN CLIENT COMPONENT
