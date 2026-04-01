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

import { useState, useEffect, memo, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser, useClerk } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { invoke } from '@tauri-apps/api/tauri';
import { Monitor } from 'lucide-react';
import { openInBrowser, isTauri } from '@/lib/tauri-utils';
import { useHabits } from '@/contexts/HabitsContext';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
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
import { cn } from '@/lib/utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

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
function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${period}`;
}

const WHOOP_SYNC_PRESETS = [
  { id: 'smart', label: 'Smart', description: 'Only fetch what changed since the last successful sync.' },
  { id: '30d', label: '30d', description: 'Backfill the last 30 days.' },
  { id: '90d', label: '90d', description: 'Backfill the last 90 days.' },
  { id: '365d', label: '365d', description: 'Backfill the last 365 days.' },
  { id: 'custom', label: 'Custom', description: 'Choose an exact day count to backfill.' },
  { id: 'full', label: 'Full history', description: 'Pull all available Whoop history for this account.' },
] as const;

type WhoopSyncMode = (typeof WHOOP_SYNC_PRESETS)[number]['id'];
const MAX_CUSTOM_WHOOP_DAYS = 3650;

function formatRelativeTime(dateValue: string | null | undefined): string {
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

function formatErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallbackMessage;
}

function isLikelyReactEvent(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ('nativeEvent' in (value as Record<string, unknown>) ||
        'preventDefault' in (value as Record<string, unknown>) ||
        'stopPropagation' in (value as Record<string, unknown>))
  );
}

type WatcherRuntimeStatus = {
  is_running?: boolean;
  pid?: number | null;
  device_id?: string | null;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
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

async function getLocalWatcherRuntimeStatus(): Promise<WatcherRuntimeStatus | null> {
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

async function fetchJsonWithTimeout(
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

async function parseApiError(response: Response, fallbackMessage: string): Promise<string> {
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
function useWhoopStatus() {
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
    staleTime: 1000 * 60 * 2, // Cache for 2 minutes
    enabled: !!user?.id,
  });
}

/**
 * Fetch Apple Watch/Health connection status with React Query
 * Checks for registered devices from the iOS companion app
 */
function useAppleWatchStatus() {
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
    staleTime: 1000 * 60 * 2, // Cache for 2 minutes
    enabled: !!user?.id,
  });
}

function useWearableConnections() {
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
    staleTime: 1000 * 30,
    enabled: !!user?.id,
  });
}

function useFinancialConnections() {
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
    staleTime: 1000 * 30,
    enabled: !!user?.id,
  });
}

/**
 * Fetch Computer Use status with React Query
 * Checks for registered watcher devices (macOS desktop)
 */
function useComputerTrackingStatus() {
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
    staleTime: 1000 * 60 * 2, // Cache for 2 minutes
    enabled: !!user?.id,
  });
}

function useIntegrationsOverview() {
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
    staleTime: 1000 * 60 * 2,
    enabled: !!user?.id,
  });
}

// Memoized integration card
const IntegrationCard = memo(({
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
  <div className="bg-white border border-gray-300 p-4 flex flex-col h-[248px] rounded-sm">
    <div className="h-10 mb-2 flex items-start">
      {logo}
    </div>
    <div className="flex items-center mb-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {comingSoon && (
        <span className="ml-2 text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Coming soon</span>
      )}
    </div>
    <p
      className={cn(
        'text-gray-500 text-xs mb-3 flex-grow',
        descriptionLineClamp === 4 && 'line-clamp-4',
        descriptionLineClamp === 3 && 'line-clamp-3',
        descriptionLineClamp === 2 && 'line-clamp-2'
      )}
    >
      {description}
    </p>

    {details ? (
      <div className="mb-3">
        {details}
      </div>
    ) : null}

    <div className="flex items-center gap-2 mt-auto">
      {isStatusLoading ? (
        <>
          <button
            type="button"
            disabled
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-sm text-gray-500 bg-[#F8F8F8] cursor-default"
          >
            Checking...
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
            >
              Details
            </button>
          )}
        </>
      ) : isConnected ? (
        <>
          <button
            onClick={onDisconnect}
            className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full bg-lime-500 transition-colors focus:outline-none focus:ring-2 focus:ring-lime-500 focus:ring-offset-2"
            role="switch"
            aria-checked="true"
          >
            <span className="pointer-events-none inline-block h-4 w-4 translate-x-4 transform rounded-full bg-white shadow-sm transition-transform" />
          </button>
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="px-3 py-1.5 text-sm whitespace-nowrap border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50"
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
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900"
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
            className="px-3 py-1.5 text-sm bg-black text-white rounded-sm"
          >
            Connect
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
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
                ? "px-3 py-1.5 text-sm border border-gray-300 rounded-sm hover:bg-[#EBEAE8] disabled:opacity-50 text-gray-900"
                : "px-3 py-1.5 text-sm bg-black text-white rounded-sm disabled:opacity-50"
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
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
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
// ================================

export function IntegrationsClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const { fetchHabits, fetchHabitLogs } = useHabits();
  const { data: integrationsOverview, refetch: refetchOverview } = useIntegrationsOverview();
  const whoopStatusData = integrationsOverview?.whoopStatus;
  const appleWatchStatusData = integrationsOverview?.appleWatchStatus;
  const wearableConnectionsData = integrationsOverview?.wearableConnections;
  const financialConnectionsData = integrationsOverview?.financialConnections;
  const computerTrackingStatus = integrationsOverview?.computerTrackingStatus;
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopSyncHour, setWhoopSyncHour] = useState(9); // Default to 9 AM
  const [whoopSyncMode, setWhoopSyncMode] = useState<WhoopSyncMode>('smart');
  const [whoopCustomDaysBack, setWhoopCustomDaysBack] = useState('730');
  const [whoopConnecting, setWhoopConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [plaidConnecting, setPlaidConnecting] = useState(false);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [plaidBackfilling, setPlaidBackfilling] = useState(false);
  const [plaidSettingsSaving, setPlaidSettingsSaving] = useState(false);
  const [plaidAccountSavingId, setPlaidAccountSavingId] = useState<string | null>(null);
  const [appleWatchSyncing, setAppleWatchSyncing] = useState(false);
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);
  const [teslaConnected, setTeslaConnected] = useState(false);
  const [teslaConnecting, setTeslaConnecting] = useState(false);
  const [teslaSyncing, setTeslaSyncing] = useState(false);
  const [teslaBackfilling, setTeslaBackfilling] = useState(false);
  const [teslaBackfillOdometer, setTeslaBackfillOdometer] = useState('');
  const [teslaBackfillDate, setTeslaBackfillDate] = useState('');
  const [wearableConnectingProvider, setWearableConnectingProvider] = useState<string | null>(null);
  const [wearableSyncingProvider, setWearableSyncingProvider] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Apple Watch connection state
  const appleWatchConnected = appleWatchStatusData?.connected || false;
  const appleWatchLastSync = appleWatchStatusData?.lastSyncAt;

  // Computer Use connection state
  const computerTrackingConnected = computerTrackingStatus?.connected || false;
  const computerTrackingEnabled = computerTrackingStatus?.enabled || false;
  const wearableConnections = wearableConnectionsData?.connections || [];
  const findWearableConnection = (provider: string) => wearableConnections.find((item: any) => item.provider === provider);
  const whoopConnection = findWearableConnection('whoop');
  const appleHealthConnection = findWearableConnection('apple_health');
  const ouraConnection = findWearableConnection('oura');
  const garminConnection = findWearableConnection('garmin');
  const teslaConnection = findWearableConnection('tesla');
  const financialConnections = financialConnectionsData?.connections || [];
  const plaidConnection = financialConnections.find((item: any) => item.provider === 'plaid');
  const plaidConnected = !!plaidConnection && plaidConnection.status === 'active';
  const userHasMfaEnabled = Boolean((user as any)?.twoFactorEnabled);
  const plaidMfaRequired = !userHasMfaEnabled;
  const plaidNeedsReconnect = Boolean(plaidConnection?.requires_reconnect);
  const plaidReconnectReason =
    plaidConnection?.last_error_json?.display_message ||
    plaidConnection?.last_error_json?.error_message ||
    plaidConnection?.last_error_json?.message ||
    'This bank connection needs to be repaired before spending can continue syncing.';
  const effectiveWhoopConnected = Boolean(whoopConnected || (whoopConnection && whoopConnection.status === 'active'));
  const effectiveTeslaConnected = Boolean(teslaConnected || (teslaConnection && teslaConnection.status === 'active'));

  // Update local state when query data changes
  useEffect(() => {
    if (whoopStatusData !== undefined || whoopConnection) {
      setWhoopConnected(effectiveWhoopConnected);
      setWhoopSyncHour(whoopStatusData?.sync_hour || whoopConnection?.sync_hour || 9);
    }
  }, [effectiveWhoopConnected, whoopConnection, whoopStatusData]);

  useEffect(() => {
    setTeslaConnected(effectiveTeslaConnected);
  }, [effectiveTeslaConnected]);

  const callbackProcessedRef = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const oauthSessionIdRef = useRef<string | null>(null);
  const oauthSessionTokenRef = useRef<string | null>(null);
  const plaidLoadPromiseRef = useRef<Promise<void> | null>(null);
  const plaidHandlerRef = useRef<{ open: () => void; destroy?: () => void } | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      plaidHandlerRef.current?.destroy?.();
    };
  }, []);

  // Handle Plaid OAuth return (e.g. after Capital One login in system browser)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('oauth_state_id')) return;

    const receivedRedirectUri = window.location.href;

    (async () => {
      try {
        setPlaidConnecting(true);
        const token = await getToken();
        if (!token) throw new Error('Authentication required');

        await ensurePlaidLoaded();

        const linkTokenResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/link-token`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ account_selection_enabled: true }),
        });
        if (!linkTokenResponse.ok) {
          throw new Error('Failed to initialize Plaid Link for OAuth return');
        }
        const { link_token } = await linkTokenResponse.json();

        if (!window.Plaid) throw new Error('Plaid Link did not load');

        plaidHandlerRef.current?.destroy?.();
        plaidHandlerRef.current = window.Plaid.create({
          token: link_token,
          receivedRedirectUri,
          onSuccess: async (publicToken, metadata) => {
            try {
              const exchangeResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/exchange-public-token`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  public_token: publicToken,
                  institution_id: metadata?.institution?.institution_id || null,
                  institution_name: metadata?.institution?.name || null,
                  auto_backfill: true,
                }),
              });
              if (!exchangeResponse.ok) {
                throw new Error('Failed to connect bank account');
              }
              const result = await exchangeResponse.json();
              await refetchAfterFinancialSync();
              alert(result.message || 'Bank connected successfully.');
            } catch (error) {
              console.error('❌ Error exchanging Plaid public token:', error);
              alert(`Failed to connect bank: ${error}`);
            } finally {
              setPlaidConnecting(false);
              plaidHandlerRef.current = null;
              // Clean up the OAuth params from the URL
              window.history.replaceState({}, '', window.location.pathname);
            }
          },
          onExit: (error) => {
            if (error) {
              console.error('❌ Plaid OAuth return failed:', error);
              alert(`Bank connection failed: ${error.display_message || error.error_message || 'Unknown error'}`);
            }
            setPlaidConnecting(false);
            plaidHandlerRef.current = null;
            window.history.replaceState({}, '', window.location.pathname);
          },
        });

        plaidHandlerRef.current.open();
      } catch (error) {
        console.error('❌ Error resuming Plaid OAuth:', error);
        alert(`Failed to complete bank connection: ${error}`);
        setPlaidConnecting(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensurePlaidLoaded = useCallback(async () => {
    if (typeof window === 'undefined') {
      throw new Error('Plaid Link is only available in the browser');
    }
    if (window.Plaid) {
      return;
    }
    if (!plaidLoadPromiseRef.current) {
      plaidLoadPromiseRef.current = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector('script[data-plaid-link="true"]') as HTMLScriptElement | null;
        if (existing) {
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => reject(new Error('Failed to load Plaid Link')), { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.async = true;
        script.dataset.plaidLink = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Plaid Link'));
        document.body.appendChild(script);
      });
    }
    await plaidLoadPromiseRef.current;
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const whoopCode = searchParams.get('whoop_code');
    const whoopError = searchParams.get('whoop_error');
    const wearableProvider = searchParams.get('wearable_provider');
    const wearableConnected = searchParams.get('wearable_connected');
    const wearableError = searchParams.get('wearable_error');

    const teslaCode = searchParams.get('tesla_code');
    const teslaError = searchParams.get('tesla_error');

    if (whoopCode && !callbackProcessedRef.current) {
      callbackProcessedRef.current = true;
      setIsProcessingCallback(true);
      handleWhoopCallback(whoopCode);
      return;
    }

    if (teslaCode && !callbackProcessedRef.current) {
      callbackProcessedRef.current = true;
      setIsProcessingCallback(true);
      handleTeslaCallback(teslaCode);
      return;
    }

    if (teslaError) {
      console.error('Tesla OAuth error:', teslaError);
      alert(`Tesla connection failed: ${teslaError}`);
      router.replace('/integrations');
      return;
    }

    if (wearableProvider && wearableConnected === '1') {
      refetchOverview();
      setWearableConnectingProvider(null);
      alert(`${wearableProvider === 'oura' ? 'Oura' : wearableProvider === 'garmin' ? 'Garmin' : wearableProvider} connected successfully.`);
      router.replace('/integrations');
      return;
    }

    if (wearableProvider && wearableError) {
      setWearableConnectingProvider(null);
      alert(`${wearableProvider} connection failed: ${wearableError}`);
      router.replace('/integrations');
      return;
    }

    if (whoopError) {
      console.error('❌ Whoop OAuth error:', whoopError);
      alert(`Whoop connection failed: ${whoopError}`);
      router.replace('/integrations');
    }
  }, [searchParams, refetchOverview, router]);

  async function handleWhoopCallback(code: string) {
    try {
      setWhoopConnecting(true);

      const token = await getToken();
      if (!token) {
        setWhoopConnecting(false);
        setIsProcessingCallback(false);
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/callback?code=${code}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to connect Whoop');
      }

      const result = await response.json();
      console.log('✅ Whoop connected:', result);

      setWhoopConnected(true);
      setWhoopConnecting(false);
      setIsProcessingCallback(false);
      refetchOverview();
      router.replace('/integrations');

      setTimeout(() => handleWhoopSync(), 1000);
    } catch (error) {
      console.error('❌ Error handling Whoop callback:', error);
      alert(`Failed to connect Whoop: ${error}`);
      setWhoopConnecting(false);
      setIsProcessingCallback(false);
      callbackProcessedRef.current = false;
      router.replace('/integrations');
    }
  }

  function startPollingForConnection() {
    console.log('🔄 Starting to poll for Whoop connection...');
    let pollCount = 0;
    const maxPolls = 60;

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(async () => {
      pollCount++;

      try {
        const token = await getToken();
        if (!token) {
          stopPolling();
          return;
        }

        const sessionId = oauthSessionIdRef.current;
        const sessionToken = oauthSessionTokenRef.current;
        if (sessionId && sessionToken) {
          const codeResponse = await fetch(
            `/api/integrations/whoop/store-code?sessionId=${encodeURIComponent(sessionId)}&sessionToken=${encodeURIComponent(sessionToken)}`
          );

          if (codeResponse.ok) {
            const codeData = await codeResponse.json();
            if (codeData.found && codeData.code) {
              oauthSessionIdRef.current = null;
              oauthSessionTokenRef.current = null;
              await handleWhoopCallback(codeData.code);
              stopPolling();
              return;
            }
          }
        }

        const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.connected) {
            setWhoopConnected(true);
            setWhoopConnecting(false);
            refetchOverview();
            stopPolling();
            alert('✅ Whoop connected successfully!');
            return;
          }
        }

        if (pollCount >= maxPolls) {
          setWhoopConnecting(false);
          stopPolling();
        }
      } catch (error) {
        console.error('❌ Error polling connection:', error);
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }

  async function handleWhoopConnect() {
    try {
      setWhoopConnecting(true);
      oauthSessionIdRef.current = null;
      oauthSessionTokenRef.current = null;

      const clientId = process.env.NEXT_PUBLIC_WHOOP_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_WHOOP_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        throw new Error('Whoop configuration missing');
      }

      const randomState = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const isDesktopApp = isTauri();

      let sessionId = null;
      if (isDesktopApp) {
        sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        oauthSessionIdRef.current = sessionId;
        oauthSessionTokenRef.current = sessionToken;
      }

      const stateData = {
        random: randomState,
        source: isDesktopApp ? 'desktop' : 'web',
        ...(sessionId && { sessionId }),
        ...(oauthSessionTokenRef.current && { sessionToken: oauthSessionTokenRef.current })
      };
      const state = btoa(JSON.stringify(stateData));

      const authUrl = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'offline read:recovery read:sleep read:workout read:cycles read:profile');
      authUrl.searchParams.set('state', state);

      await openInBrowser(authUrl.toString());

      if (isDesktopApp) {
        startPollingForConnection();
      }
    } catch (error) {
      console.error('❌ Error connecting to Whoop:', error);
      setWhoopConnecting(false);
    }
  }

  // ── Tesla handlers ───────────────────────────────────

  async function handleTeslaCallback(code: string) {
    try {
      setTeslaConnecting(true);
      const token = await getToken();
      if (!token) {
        setTeslaConnecting(false);
        setIsProcessingCallback(false);
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/tesla/callback?code=${code}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error('Failed to connect Tesla');

      setTeslaConnected(true);
      setTeslaConnecting(false);
      setIsProcessingCallback(false);
      refetchOverview();
      router.replace('/integrations');
    } catch (error) {
      console.error('Error handling Tesla callback:', error);
      alert(`Failed to connect Tesla: ${error}`);
      setTeslaConnecting(false);
      setIsProcessingCallback(false);
      callbackProcessedRef.current = false;
      router.replace('/integrations');
    }
  }

  async function handleTeslaConnect() {
    try {
      setTeslaConnecting(true);
      oauthSessionIdRef.current = null;
      oauthSessionTokenRef.current = null;

      const clientId = process.env.NEXT_PUBLIC_TESLA_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_TESLA_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        throw new Error('Tesla configuration missing. Set NEXT_PUBLIC_TESLA_CLIENT_ID and NEXT_PUBLIC_TESLA_REDIRECT_URI.');
      }

      const randomState = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const isDesktopApp = isTauri();

      let sessionId = null;
      if (isDesktopApp) {
        sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        oauthSessionIdRef.current = sessionId;
        oauthSessionTokenRef.current = sessionToken;
      }

      const stateData = {
        random: randomState,
        source: isDesktopApp ? 'desktop' : 'web',
        ...(sessionId && { sessionId }),
        ...(oauthSessionTokenRef.current && { sessionToken: oauthSessionTokenRef.current }),
      };
      const state = btoa(JSON.stringify(stateData));

      const authUrl = new URL('https://auth.tesla.com/oauth2/v3/authorize');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid vehicle_device_data offline_access');
      authUrl.searchParams.set('state', state);

      await openInBrowser(authUrl.toString());

      if (isDesktopApp) {
        startPollingForTeslaConnection();
      }
    } catch (error) {
      console.error('Error connecting to Tesla:', error);
      setTeslaConnecting(false);
    }
  }

  function startPollingForTeslaConnection() {
    let pollCount = 0;
    const maxPolls = 60;

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(async () => {
      pollCount++;

      try {
        const token = await getToken();
        if (!token) {
          stopPolling();
          return;
        }

        const sessionId = oauthSessionIdRef.current;
        const sessionToken = oauthSessionTokenRef.current;
        if (sessionId && sessionToken) {
          const codeResponse = await fetch(
            `/api/integrations/tesla/store-code?sessionId=${encodeURIComponent(sessionId)}&sessionToken=${encodeURIComponent(sessionToken)}`
          );

          if (codeResponse.ok) {
            const codeData = await codeResponse.json();
            if (codeData.found && codeData.code) {
              oauthSessionIdRef.current = null;
              oauthSessionTokenRef.current = null;
              await handleTeslaCallback(codeData.code);
              stopPolling();
              return;
            }
          }
        }

        const response = await fetch(`${API_BASE_URL}/api/integrations/tesla/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.connected) {
            setTeslaConnected(true);
            setTeslaConnecting(false);
            refetchOverview();
            stopPolling();
            return;
          }
        }

        if (pollCount >= maxPolls) {
          setTeslaConnecting(false);
          stopPolling();
        }
      } catch (error) {
        console.error('Error polling Tesla connection:', error);
      }
    }, 2000);
  }

  async function handleTeslaSync() {
    try {
      setTeslaSyncing(true);
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/integrations/tesla/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error('Tesla sync failed');
      const result = await response.json();
      console.log('Tesla sync result:', result);
      refetchOverview();
      fetchHabits();
      fetchHabitLogs();
    } catch (error) {
      console.error('Tesla sync error:', error);
      alert(`Tesla sync failed: ${error}`);
    } finally {
      setTeslaSyncing(false);
    }
  }

  async function handleTeslaBackfill() {
    const odometer = parseFloat(teslaBackfillOdometer);
    if (!odometer || odometer <= 0 || !teslaBackfillDate) {
      alert('Please enter a valid odometer reading and date.');
      return;
    }

    try {
      setTeslaBackfilling(true);
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/integrations/tesla/backfill-odometer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ previous_odometer: odometer, as_of_date: teslaBackfillDate }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Backfill failed');
      }

      const result = await response.json();
      alert(`Backfilled ${result.days_backfilled} days (${result.total_miles} total miles, ~${result.daily_average} mi/day)`);
      setTeslaBackfillOdometer('');
      setTeslaBackfillDate('');
      refetchOverview();
      fetchHabits();
      fetchHabitLogs();
    } catch (error) {
      console.error('Tesla backfill error:', error);
      alert(`Backfill failed: ${error}`);
    } finally {
      setTeslaBackfilling(false);
    }
  }

  async function handleTeslaDisconnect() {
    try {
      const token = await getToken();
      if (!token) return;

      await fetch(`${API_BASE_URL}/api/integrations/tesla`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      setTeslaConnected(false);
      refetchOverview();
    } catch (error) {
      console.error('Tesla disconnect error:', error);
    }
  }

  const refetchAfterFinancialSync = useCallback(async () => {
    await Promise.all([
      refetchOverview(),
      fetchHabits(),
      fetchHabitLogs(),
    ]);
  }, [fetchHabitLogs, fetchHabits, refetchOverview]);

  const handlePlaidLink = useCallback(async (options?: { updateMode?: boolean }) => {
    try {
      // MFA check disabled — go straight to Plaid Link
      // if (plaidMfaRequired) {
      //   openUserProfile();
      //   throw new Error('Multi-factor authentication must be enabled before connecting a bank account.');
      // }
      setPlaidConnecting(true);
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication required');
      }

      await ensurePlaidLoaded();

      const linkTokenResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/link-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connection_id: options?.updateMode ? plaidConnection?.id : null,
          update_mode: Boolean(options?.updateMode),
          account_selection_enabled: true,
        }),
      });
      if (!linkTokenResponse.ok) {
        throw new Error(await parseApiError(linkTokenResponse, 'Failed to initialize Plaid Link'));
      }

      const linkTokenResult = await linkTokenResponse.json();
      if (!window.Plaid) {
        throw new Error('Plaid Link did not load');
      }

      plaidHandlerRef.current?.destroy?.();
      plaidHandlerRef.current = window.Plaid.create({
        token: linkTokenResult.link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            if (options?.updateMode) {
              if (!plaidConnection?.id) {
                throw new Error('Plaid connection not found');
              }
              const syncResponse = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/sync`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
              if (!syncResponse.ok) {
                throw new Error(await parseApiError(syncResponse, 'Failed to refresh Plaid connection'));
              }

              await refetchAfterFinancialSync();
              alert('Plaid connection refreshed successfully.');
              return;
            }

            const exchangeResponse = await fetch(`${API_BASE_URL}/api/financial/plaid/exchange-public-token`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                public_token: publicToken,
                institution_id: metadata?.institution?.institution_id || null,
                institution_name: metadata?.institution?.name || null,
                auto_backfill: true,
              }),
            });

            if (!exchangeResponse.ok) {
              throw new Error(await parseApiError(exchangeResponse, 'Failed to connect Plaid'));
            }

            const result = await exchangeResponse.json();
            await refetchAfterFinancialSync();
            alert(result.message || 'Plaid connected successfully.');
          } catch (error) {
            console.error('❌ Error exchanging Plaid public token:', error);
            alert(`Failed to connect Plaid: ${error}`);
          } finally {
            setPlaidConnecting(false);
            plaidHandlerRef.current = null;
          }
        },
        onExit: (error) => {
          if (error) {
            console.error('❌ Plaid Link exited with error:', error);
            alert(`Plaid connection failed: ${error.display_message || error.error_message || 'Unknown error'}`);
          }
          setPlaidConnecting(false);
          plaidHandlerRef.current = null;
        },
      });

      plaidHandlerRef.current.open();
    } catch (error) {
      console.error('❌ Error connecting Plaid:', error);
      alert(`Failed to connect Plaid: ${error}`);
      setPlaidConnecting(false);
    }
  }, [ensurePlaidLoaded, getToken, openUserProfile, plaidConnection?.id, plaidMfaRequired, refetchAfterFinancialSync]);

  const handlePlaidConnect = useCallback(() => {
    return handlePlaidLink({ updateMode: false });
  }, [handlePlaidLink]);

  const handlePlaidReconnect = useCallback(() => {
    return handlePlaidLink({ updateMode: true });
  }, [handlePlaidLink]);

  const handlePlaidMfaSetup = useCallback(() => {
    openUserProfile();
  }, [openUserProfile]);

  async function handlePlaidSyncSettingsUpdate(
    updates: { auto_sync_enabled?: boolean; sync_hour?: number }
  ) {
    try {
      if (!plaidConnection?.id) {
        return;
      }
      setPlaidSettingsSaving(true);
      const token = await getToken();
      if (!token) return;

      const nextEnabled = updates.auto_sync_enabled ?? plaidConnection.auto_sync_enabled ?? true;
      const nextHour = updates.sync_hour ?? plaidConnection.sync_hour ?? 9;

      const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/sync-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auto_sync_enabled: nextEnabled,
          sync_hour: nextHour,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update Plaid sync settings');
      }

      await refetchOverview();
    } catch (error) {
      console.error('❌ Error updating Plaid sync settings:', error);
      alert(`Failed to update Plaid sync settings: ${error}`);
    } finally {
      setPlaidSettingsSaving(false);
    }
  }

  async function handlePlaidAccountInclusion(accountId: string, includeInSpending: boolean) {
    try {
      if (!plaidConnection?.id) {
        return;
      }
      setPlaidAccountSavingId(accountId);
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/accounts/${accountId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          include_in_spending: includeInSpending,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update account preference');
      }

      await refetchAfterFinancialSync();
    } catch (error) {
      console.error('❌ Error updating Plaid account preference:', error);
      alert(`Failed to update account preference: ${error}`);
    } finally {
      setPlaidAccountSavingId(null);
    }
  }

  async function handlePlaidBackfill() {
    try {
      if (!plaidConnection?.id) {
        throw new Error('Plaid connection not found');
      }
      setPlaidBackfilling(true);
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/backfill`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Backfill failed');
      }

      const result = await response.json();
      await refetchAfterFinancialSync();
      alert(
        `Backfill completed.\n\n` +
        `Transactions seen: ${result.items_seen || 0}\n` +
        `Daily spending days updated: ${result.rollup?.days_completed || 0}`
      );
    } catch (error) {
      console.error('❌ Error backfilling Plaid history:', error);
      alert(`Failed to backfill Plaid history: ${error}`);
    } finally {
      setPlaidBackfilling(false);
    }
  }

  async function handlePlaidSync() {
    try {
      if (!plaidConnection?.id) {
        throw new Error('Plaid connection not found');
      }
      setPlaidSyncing(true);
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Sync failed');
      }

      const result = await response.json();
      await refetchAfterFinancialSync();
      alert(
        `Sync completed.\n\n` +
        `Transactions seen: ${result.items_seen || 0}\n` +
        `Transactions written: ${result.items_written || 0}\n` +
        `Daily spending days updated: ${result.rollup?.days_completed || 0}`
      );
    } catch (error) {
      console.error('❌ Error syncing Plaid:', error);
      alert(`Failed to sync Plaid: ${error}`);
    } finally {
      setPlaidSyncing(false);
    }
  }

  async function handlePlaidDisconnect() {
    try {
      if (!plaidConnection?.id) {
        return;
      }
      const token = await getToken();
      if (!token) return;

      if (!confirm('Disconnect Plaid? Existing spending logs will remain unless you resync later.')) {
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/financial/connections/${plaidConnection.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect Plaid');
      }

      await refetchOverview();
      alert('Plaid disconnected successfully.');
    } catch (error) {
      console.error('❌ Error disconnecting Plaid:', error);
      alert(`Failed to disconnect Plaid: ${error}`);
    }
  }

  const renderIntegrationLogo = (integration: string, size: 'card' | 'panel' = 'card') => {
    const imageClass = size === 'panel' ? 'h-8 w-auto object-contain' : 'h-6 w-auto object-contain';

    switch (integration) {
      case 'plaid':
        return (
          <Image
            src="/images/plaid-mark.svg"
            alt="Plaid"
            width={48}
            height={52}
            className={size === 'panel' ? 'h-8 w-auto object-contain' : 'h-7 w-auto object-contain'}
          />
        );
      case 'whoop':
        return (
          <Image
            src="/images/whoop.svg"
            alt="Whoop"
            width={80}
            height={32}
            className={imageClass}
          />
        );
      case 'oura':
        return <Image src="/images/oura.svg" alt="Oura" width={40} height={40} className={size === 'panel' ? 'h-9 w-auto object-contain' : 'h-10 w-auto object-contain'} />;
      case 'garmin':
        return <Image src="/images/garmin.svg" alt="Garmin" width={60} height={24} className={imageClass} />;
      case 'applewatch':
        return (
          <svg className={size === 'panel' ? 'h-8 w-8' : 'h-6 w-6'} viewBox="0 0 814 1000" fill="currentColor">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
          </svg>
        );
      case 'computer':
        return <Monitor className={size === 'panel' ? 'h-8 w-8 text-gray-900' : 'h-7 w-7 text-gray-900'} />;
      case 'screentime':
        return <Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={28} height={28} className={size === 'panel' ? 'h-8 w-8' : 'h-7 w-7'} />;
      case 'fitbit':
        return <Image src="/images/fitbit.svg" alt="Fitbit" width={60} height={24} className={imageClass} />;
      case 'calai':
        return <Image src="/images/cal_ai.svg" alt="Cal AI" width={80} height={32} className={size === 'panel' ? 'h-9 w-auto object-contain' : 'h-8 w-auto object-contain'} />;
      case 'googlecalendar':
        return <Image src="/images/Google_Calendar_Logo.svg" alt="Google Calendar" width={24} height={24} className={size === 'panel' ? 'h-8 w-8' : 'h-6 w-6'} />;
      case 'tesla':
        return <Image src="/images/Tesla_T_symbol.svg" alt="Tesla" width={24} height={24} className={size === 'panel' ? 'h-8 w-8' : 'h-6 w-6'} />;
      default:
        return null;
    }
  };

  const renderPlaidDetails = () => {
    if (!plaidConnection || !plaidConnected) {
      return null;
    }

    return (
      <div className="space-y-4">
        {plaidNeedsReconnect ? (
          <div className="rounded-sm border border-gray-200 bg-white p-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Reconnect required</p>
            <p className="mt-2 text-sm leading-6 text-gray-900">{plaidReconnectReason}</p>
            <div className="mt-3">
              <button
                onClick={handlePlaidReconnect}
                disabled={plaidConnecting}
                className="px-3 py-2 text-sm border border-gray-300 rounded-sm hover:bg-[#f3f3f3] disabled:opacity-50"
              >
                {plaidConnecting ? 'Reconnecting...' : 'Reconnect bank'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Institution</p>
            <p className="mt-1 text-sm text-gray-900">{plaidConnection.institution_name || 'Connected bank'}</p>
          </div>
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Active accounts</p>
            <p className="mt-1 text-sm text-gray-900">{plaidConnection.account_count || 0}</p>
          </div>
        </div>

        <div className="rounded-sm border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Auto sync</p>
              <p className="mt-1 text-sm text-gray-600">Keep spending totals current in the background.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={plaidConnection.auto_sync_enabled ?? true}
                disabled={plaidSettingsSaving}
                onChange={(event) =>
                  handlePlaidSyncSettingsUpdate({
                    auto_sync_enabled: event.target.checked,
                    sync_hour: plaidConnection.sync_hour ?? 9,
                  })
                }
                className="h-3.5 w-3.5 rounded border-gray-300 text-black focus:ring-0"
              />
              <span>{plaidConnection.auto_sync_enabled ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
            <div>
              <p className="text-sm text-gray-900">Preferred sync time</p>
              <p className="mt-1 text-xs text-gray-500">Choose when Ritual should refresh spending totals.</p>
            </div>
            <select
              value={plaidConnection.sync_hour ?? 9}
              disabled={plaidSettingsSaving || !(plaidConnection.auto_sync_enabled ?? true)}
              onChange={(event) =>
                handlePlaidSyncSettingsUpdate({
                  auto_sync_enabled: plaidConnection.auto_sync_enabled ?? true,
                  sync_hour: Number(event.target.value),
                })
              }
              className="h-9 min-w-[112px] rounded-sm border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {formatHour(hour)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Last sync</span>
            <span className="text-gray-700">{formatRelativeTime(plaidConnection.last_sync_at || plaidConnection.last_successful_sync_at)}</span>
          </div>
          {plaidConnection.latest_transaction_date ? (
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span>Latest imported date</span>
              <span className="text-gray-700">{plaidConnection.latest_transaction_date}</span>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Included accounts</p>
          <div className="space-y-2">
            {(plaidConnection.accounts || []).filter((account: any) => account.is_active).map((account: any) => (
              <label key={account.id} className="flex items-start gap-3 rounded-sm border border-gray-200 bg-white p-3 text-sm text-gray-900">
                <input
                  type="checkbox"
                  checked={account.include_in_spending}
                  disabled={plaidAccountSavingId === account.id}
                  onChange={(event) => handlePlaidAccountInclusion(account.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-black focus:ring-0"
                />
                <span className="leading-4">
                  <span className="block text-gray-900">
                    {account.name}
                    {account.mask ? ` ••${account.mask}` : ''}
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {(account.account_type || 'account').replace('_', ' ')}
                    {account.account_subtype ? ` · ${String(account.account_subtype).replace('_', ' ')}` : ''}
                  </span>
                </span>
              </label>
            ))}
            {!(plaidConnection.accounts || []).some((account: any) => account.is_active) ? (
              <p className="rounded-sm border border-dashed border-gray-200 bg-white p-3 text-sm text-gray-500">No active accounts available yet.</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const openIntegrationDetails = (integration: string) => {
    setSelectedIntegration(integration);
    setDetailsOpen(true);
  };

  const renderPanelAction = () => {
    if (selectedIntegration === 'plaid') {
      if (!plaidConnected) {
        return (
          <button
            onClick={handlePlaidConnect}
            disabled={plaidConnecting}
            className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
          >
            {plaidConnecting ? 'Connecting...' : 'Connect'}
          </button>
        );
      }
      if (plaidNeedsReconnect) {
        return (
          <button
            onClick={handlePlaidReconnect}
            disabled={plaidConnecting}
            className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
          >
            {plaidConnecting ? 'Reconnecting...' : 'Reconnect'}
          </button>
        );
      }
      return (
        <button
          onClick={handlePlaidSync}
          disabled={plaidSyncing}
          className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
        >
          {plaidSyncing ? 'Syncing...' : 'Sync now'}
        </button>
      );
    }

    if (selectedIntegration === 'whoop') {
      return (
        <Button
          onClick={() => handleWhoopSync()}
          disabled={syncing}
          variant="outline"
          className="h-11 rounded-sm border-[#1f1e1a] px-4 text-sm text-[#1f1e1a] hover:bg-[#f3f1ea]"
        >
          {syncing ? 'Syncing...' : 'Quick sync'}
        </Button>
      );
    }

    if (selectedIntegration === 'oura') {
      return (
        <button
          onClick={() => handleWearableProviderSync('oura')}
          disabled={wearableSyncingProvider === 'oura'}
          className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
        >
          {wearableSyncingProvider === 'oura' ? 'Syncing...' : 'Sync now'}
        </button>
      );
    }

    if (selectedIntegration === 'garmin') {
      return (
        <button
          onClick={() => handleWearableProviderSync('garmin')}
          disabled={wearableSyncingProvider === 'garmin'}
          className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
        >
          {wearableSyncingProvider === 'garmin' ? 'Syncing...' : 'Sync now'}
        </button>
      );
    }

    if (selectedIntegration === 'applewatch' || selectedIntegration === 'computer') {
      return null;
    }

    return (
      <button
        disabled
        className="px-4 py-2 text-sm border border-[#d8d5cb] text-[#8a877d] rounded-sm"
      >
        Coming soon
      </button>
    );
  };

  const renderPanelHeader = (
    integration: string,
    title: string,
    subtitle: string,
  ) => (
    <div className="border-b border-[#e7e5dd] px-5 py-5">
      <div className="rounded-sm border border-[#e7e5dd] bg-[#f8f7f3] p-4">
        <div className="flex aspect-[16/8.6] items-center justify-center rounded-sm border border-[#23211d] bg-[linear-gradient(0deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px] bg-[#111111]">
          <div className="scale-[1.35] text-white">
            {renderIntegrationLogo(integration, 'panel')}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-b border-[#e7e5dd] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-[#e7e5dd] bg-white text-[#1f1e1a]">
            {renderIntegrationLogo(integration, 'panel')}
          </div>
          <div>
            <h3 className="text-[28px] leading-none tracking-[-0.03em] text-[#1f1e1a]">{title}</h3>
            <p className="mt-1 text-xs text-[#8a877d]">{subtitle}</p>
          </div>
        </div>
        <div>{renderPanelAction()}</div>
      </div>
    </div>
  );

  const renderIntegrationDetailsPanel = () => {
    if (selectedIntegration === 'plaid') {
      return (
        <div className="flex h-full flex-col bg-white">
          {renderPanelHeader('plaid', 'Plaid', `Bank sync • ${plaidNeedsReconnect ? 'Reconnect required' : plaidConnected ? 'By Plaid' : 'Ready to connect'}`)}
          <div className="min-h-0 flex-1 px-5">
            <ScrollArea className="h-full">
              <Accordion type="multiple" defaultValue={['how-it-works', 'settings']} className="pt-4">
                <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                  <AccordionContent className="text-sm text-[#69665c]">
                    Connect Plaid to import full available spending history from posted depository transactions. Ritual converts that into one daily Spending value instead of exposing a transaction ledger.
                    {plaidConnected ? (
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={handlePlaidBackfill}
                          disabled={plaidBackfilling}
                          className="px-3 py-2 text-sm border border-[#d8d5cb] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
                        >
                          {plaidBackfilling ? 'Backfilling...' : 'Backfill history'}
                        </button>
                      </div>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="settings" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Sync settings</AccordionTrigger>
                  <AccordionContent>
                    {renderPlaidDetails()}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <div className="border-t border-[#e7e5dd] pb-5 pt-6">
                <p className="text-[11px] leading-5 text-[#8a877d]">
                  Plaid is used here only to compute daily spending totals. Individual transaction categorization and merchant analytics are intentionally out of scope for this Ritual integration.
                </p>
              </div>
            </ScrollArea>
          </div>
        </div>
      );
    }

    if (selectedIntegration === 'whoop') {
      return (
        <div className="flex h-full flex-col bg-white">
          {renderPanelHeader('whoop', 'Whoop', `Recovery • By Whoop`)}
          <div className="min-h-0 flex-1 px-5">
            <ScrollArea className="h-full">
              <Accordion type="multiple" defaultValue={['how-it-works', 'settings']} className="pt-4">
                <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                  <AccordionContent className="text-sm text-[#69665c]">
                    <div className="space-y-3">
                      <p>Track recovery, sleep, and strain data from your Whoop device and keep those habits in sync with Ritual.</p>
                      <p>
                        Smart sync resumes from the last successful checkpoint. If you want to backfill older history, use one of the manual sync presets below or run a full-history import.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="settings" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Sync settings</AccordionTrigger>
                  <AccordionContent>{renderWhoopSyncDetails()}</AccordionContent>
                </AccordionItem>
              </Accordion>
            </ScrollArea>
          </div>
        </div>
      );
    }

    if (selectedIntegration === 'applewatch') {
      return (
        <div className="flex h-full flex-col bg-white">
          {renderPanelHeader('applewatch', 'Apple Watch', `Health data • Via Ritual Companion`)}
          <div className="min-h-0 flex-1 px-5">
            <ScrollArea className="h-full">
              <Accordion type="multiple" defaultValue={['how-it-works', ...(appleWatchConnected ? ['settings'] : [])]} className="pt-4">
                <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                  <AccordionContent className="text-sm text-[#69665c]">
                    Sync data from your iPhone companion app, including workouts, steps, heart rate, and sleep metrics.
                  </AccordionContent>
                </AccordionItem>
                {appleWatchConnected ? (
                  <AccordionItem value="settings" className="border-[#e7e5dd]">
                    <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Sync settings</AccordionTrigger>
                    <AccordionContent>{renderAutoSyncDetails('apple_health', appleHealthConnection, appleWatchLastSync, null)}</AccordionContent>
                  </AccordionItem>
                ) : null}
              </Accordion>
            </ScrollArea>
          </div>
        </div>
      );
    }

    if (selectedIntegration === 'oura') {
      return (
        <div className="flex h-full flex-col bg-white">
          {renderPanelHeader('oura', 'Oura Ring', 'Sleep & readiness • By Oura')}
          <div className="min-h-0 flex-1 px-5">
            <ScrollArea className="h-full">
              <Accordion type="multiple" defaultValue={['how-it-works', ...(ouraConnection && ouraConnection.status === 'active' ? ['settings'] : [])]} className="pt-4">
                <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                  <AccordionContent className="text-sm text-[#69665c]">
                    Sync your sleep, readiness, HRV, and temperature trends from Oura Ring.
                  </AccordionContent>
                </AccordionItem>
                {ouraConnection && ouraConnection.status === 'active' ? (
                  <AccordionItem value="settings" className="border-[#e7e5dd]">
                    <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Sync settings</AccordionTrigger>
                    <AccordionContent>{renderAutoSyncDetails('oura', ouraConnection, null, null)}</AccordionContent>
                  </AccordionItem>
                ) : null}
              </Accordion>
            </ScrollArea>
          </div>
        </div>
      );
    }

    if (selectedIntegration === 'garmin') {
      return (
        <div className="flex h-full flex-col bg-white">
          {renderPanelHeader('garmin', 'Garmin', 'Activity & recovery • By Garmin')}
          <div className="min-h-0 flex-1 px-5">
            <ScrollArea className="h-full">
              <Accordion type="multiple" defaultValue={['how-it-works', ...(garminConnection && garminConnection.status === 'active' ? ['settings'] : [])]} className="pt-4">
                <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                  <AccordionContent className="text-sm text-[#69665c]">
                    Integrate Garmin devices for activity, workout, sleep, and recovery tracking.
                  </AccordionContent>
                </AccordionItem>
                {garminConnection && garminConnection.status === 'active' ? (
                  <AccordionItem value="settings" className="border-[#e7e5dd]">
                    <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Sync settings</AccordionTrigger>
                    <AccordionContent>{renderAutoSyncDetails('garmin', garminConnection, null, null)}</AccordionContent>
                  </AccordionItem>
                ) : null}
              </Accordion>
            </ScrollArea>
          </div>
        </div>
      );
    }

    if (selectedIntegration === 'tesla') {
      return (
        <div className="flex h-full flex-col bg-white">
          {renderPanelHeader('tesla', 'Tesla', 'Miles driven • By Tesla')}
          <div className="min-h-0 flex-1 px-5">
            <ScrollArea className="h-full">
              <Accordion type="multiple" defaultValue={['how-it-works', ...(effectiveTeslaConnected ? ['settings'] : [])]} className="pt-4">
                <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                  <AccordionContent className="text-sm text-[#69665c]">
                    <p className="mb-3">
                      Ritual reads your Tesla&apos;s odometer every 6 hours and logs the miles you&apos;ve driven as a daily habit.
                    </p>
                    <p>
                      On the first sync, your current odometer is saved as a baseline. From then on, each sync computes the difference and logs new miles driven.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                {effectiveTeslaConnected ? (
                  <>
                    <AccordionItem value="settings" className="border-[#e7e5dd]">
                      <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Sync settings</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pb-4">
                          <div>
                            <p className="text-sm text-[#69665c]">
                              Odometer is synced automatically every 6 hours. You can also sync manually.
                            </p>
                            {teslaConnection?.last_sync_at && (
                              <p className="mt-2 text-xs text-[#9d9a90]">
                                Last synced: {new Date(teslaConnection.last_sync_at).toLocaleString()}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={handleTeslaSync}
                            disabled={teslaSyncing}
                            className="w-full rounded-sm border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-50"
                          >
                            {teslaSyncing ? 'Syncing...' : 'Sync now'}
                          </button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="backfill" className="border-[#e7e5dd]">
                      <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Backfill historical miles</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pb-4">
                          <p className="text-sm text-[#69665c]">
                            Enter a past odometer reading from your Tesla app to backfill daily miles between that date and today. Miles will be distributed evenly across each day.
                          </p>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-[#69665c]">
                              Odometer reading (miles)
                            </label>
                            <input
                              type="number"
                              value={teslaBackfillOdometer}
                              onChange={(e) => setTeslaBackfillOdometer(e.target.value)}
                              placeholder="e.g. 42150"
                              className="w-full rounded-sm border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-[#69665c]">
                              As of date
                            </label>
                            <input
                              type="date"
                              value={teslaBackfillDate}
                              onChange={(e) => setTeslaBackfillDate(e.target.value)}
                              className="w-full rounded-sm border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleTeslaBackfill}
                            disabled={teslaBackfilling || !teslaBackfillOdometer || !teslaBackfillDate}
                            className="w-full rounded-sm border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-50"
                          >
                            {teslaBackfilling ? 'Backfilling...' : 'Backfill miles'}
                          </button>
                          <p className="text-xs text-[#9d9a90]">
                            Tip: Open the Tesla app → tap your car → Vehicle → Odometer to find past readings.
                          </p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </>
                ) : null}
              </Accordion>
            </ScrollArea>
          </div>
        </div>
      );
    }

    const titles: Record<string, string> = {
      computer: 'Computer Use',
      screentime: 'Apple Screen Time',
      fitbit: 'Fitbit',
      calai: 'Cal AI',
      googlecalendar: 'Google Calendar',
    };

    return (
      <div className="flex h-full flex-col bg-white">
        {renderPanelHeader(selectedIntegration || 'computer', titles[selectedIntegration || ''] || 'Integration Details', selectedIntegration === 'computer' ? 'Desktop tracking • Local device' : 'Available soon')}
        <div className="min-h-0 flex-1 px-5">
          <ScrollArea className="h-full">
            <Accordion type="multiple" defaultValue={['how-it-works']} className="pt-4">
              <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                <AccordionContent className="text-sm text-[#69665c]">
                  {selectedIntegration === 'computer'
                    ? 'Manage computer tracking from the Computer Tracking settings panel.'
                    : 'Additional integration details and setup controls will live here.'}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </ScrollArea>
        </div>
      </div>
    );
  };

  function getWhoopSyncRequestFromMode(): {
    daysBack?: number;
    forceFullSync?: boolean;
    fullHistory?: boolean;
  } {
    switch (whoopSyncMode) {
      case '30d':
        return { daysBack: 30 };
      case '90d':
        return { daysBack: 90 };
      case '365d':
        return { daysBack: 365 };
      case 'custom': {
        const parsed = Number.parseInt(whoopCustomDaysBack, 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_CUSTOM_WHOOP_DAYS) {
          throw new Error(`Enter a custom backfill between 1 and ${MAX_CUSTOM_WHOOP_DAYS} days before syncing.`);
        }
        return { daysBack: parsed };
      }
      case 'full':
        return { fullHistory: true };
      case 'smart':
      default:
        return {};
    }
  }

  async function handleWhoopSync(options?: {
    daysBack?: number;
    forceFullSync?: boolean;
    fullHistory?: boolean;
  }) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      setSyncing(true);

      const token = await getToken();
      if (!token) {
        setSyncing(false);
        return;
      }

      const syncRequest =
        options && !isLikelyReactEvent(options)
          ? options
          : getWhoopSyncRequestFromMode();

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 90000);

      const response = await fetch('/api/integrations/whoop/sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(syncRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Sync failed'));
      }

      const result = await response.json();
      const syncCounts = result.data?.counts || {};
      const { recovery, sleep, workouts } = syncCounts;
      const total = (recovery || 0) + (sleep || 0) + (workouts || 0);

      setWhoopConnected(true);
      void Promise.allSettled([
        refetchOverview(),
        fetchHabits(),
        fetchHabitLogs(),
      ]);

      const syncLabel = syncRequest.fullHistory
        ? 'full history'
        : syncRequest.daysBack
          ? `last ${syncRequest.daysBack} days`
          : syncRequest.forceFullSync
            ? 'default backfill'
            : 'latest changes';

      if (total > 0) {
        alert(`Synced ${total} record(s) successfully from ${syncLabel}!\n\n` +
          `- Recovery: ${recovery || 0}\n` +
          `- Sleep: ${sleep || 0}\n` +
          `- Workouts: ${workouts || 0}`);
      } else {
        alert(`Sync completed for ${syncLabel}. No new data found.`);
      }
    } catch (error) {
      console.error('❌ Error syncing Whoop:', error);
      const fallbackMessage =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Sync timed out. The request took too long.'
          : 'Unknown error';
      alert(`Sync failed: ${formatErrorMessage(error, fallbackMessage)}`);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      setSyncing(false);
    }
  }

  async function handleWhoopDisconnect() {
    try {
      const token = await getToken();
      if (!token) return;

      if (!confirm('Are you sure you want to disconnect Whoop?')) {
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, 'Failed to disconnect Whoop'));
      }

      setWhoopConnected(false);
      refetchOverview();
      callbackProcessedRef.current = false;
      alert('Whoop disconnected successfully');
    } catch (error) {
      console.error('❌ Error disconnecting Whoop:', error);
      alert(`Failed to disconnect: ${formatErrorMessage(error, 'Unknown error')}`);
    }
  }

  async function handleWhoopSyncHourUpdate(newHour: number) {
    try {
      const token = await getToken();
      if (!token) {
        console.error('No authentication token');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/sync-hour`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sync_hour: newHour }),
      });

      if (response.ok) {
        setWhoopSyncHour(newHour);
        alert('✅ Sync time updated successfully!');
        refetchOverview();
      } else {
        console.error('Failed to update sync hour');
        alert('❌ Failed to update sync time');
      }
    } catch (error) {
      console.error(error);
      alert('❌ Error updating sync time');
    }
  }

  async function handleWearableSyncSettingsUpdate(
    provider: 'whoop' | 'apple_health' | 'oura' | 'garmin',
    updates: { auto_sync_enabled?: boolean; sync_hour?: number }
  ) {
    try {
      const token = await getToken();
      if (!token) return;

      const connection = provider === 'whoop'
        ? whoopConnection
        : provider === 'apple_health'
          ? appleHealthConnection
          : provider === 'oura'
            ? ouraConnection
            : garminConnection;

      const nextEnabled = updates.auto_sync_enabled ?? connection?.auto_sync_enabled ?? (provider !== 'apple_health');
      const nextHour = updates.sync_hour ?? connection?.sync_hour ?? (provider === 'whoop' ? whoopSyncHour : 9);

      const response = await fetch(`${API_BASE_URL}/api/wearables/connections/${provider}/sync-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auto_sync_enabled: nextEnabled,
          sync_hour: nextHour,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update sync settings');
      }

      if (provider === 'whoop') {
        setWhoopSyncHour(nextHour);
        await refetchOverview();
        }
      await refetchOverview();
    } catch (error) {
      console.error(`❌ Error updating ${provider} sync settings:`, error);
      alert(`Failed to update ${provider} sync settings.`);
    }
  }

  const renderAutoSyncDetails = (
    provider: 'whoop' | 'apple_health' | 'oura' | 'garmin',
    connection: any,
    fallbackLastSync?: string | null,
    staleMessage?: string | null,
  ) => {
    const autoSyncEnabled = connection?.auto_sync_enabled ?? (provider !== 'apple_health');
    const syncHour = connection?.sync_hour ?? (provider === 'whoop' ? whoopSyncHour : 9);
    const lastSyncValue = fallbackLastSync || connection?.last_sync_at || connection?.last_successful_sync_at || null;
    const note = connection?.auto_sync_note;

    return (
      <div className="space-y-4">
        <div className="rounded-sm border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Auto sync</p>
              <p className="mt-1 text-sm text-gray-600">Keep this integration updated automatically.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                onChange={(event) =>
                  handleWearableSyncSettingsUpdate(provider, {
                    auto_sync_enabled: event.target.checked,
                    sync_hour: syncHour,
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-black focus:ring-0"
              />
              <span>{autoSyncEnabled ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
            <div>
              <p className="text-sm text-gray-900">Preferred sync time</p>
              <p className="mt-1 text-xs text-gray-500">Choose the hour for background refreshes.</p>
            </div>
            <select
              value={syncHour}
              onChange={(event) =>
                handleWearableSyncSettingsUpdate(provider, {
                  auto_sync_enabled: autoSyncEnabled,
                  sync_hour: Number(event.target.value),
                })
              }
              disabled={!autoSyncEnabled}
              className="h-9 min-w-[112px] rounded-sm border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:opacity-50"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {formatHour(hour)}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Last sync</span>
            <span className="text-gray-700">{formatRelativeTime(lastSyncValue)}</span>
          </div>
          {note ? (
            <p className="mt-2 text-xs leading-5 text-gray-500">{note}</p>
          ) : null}
          {staleMessage ? (
            <p className="mt-2 text-xs leading-5 text-gray-500">{staleMessage}</p>
          ) : null}
        </div>
      </div>
    );
  };

  const renderWhoopSyncDetails = () => {
    const autoSyncEnabled = whoopConnection?.auto_sync_enabled ?? true;
    const syncHour = whoopConnection?.sync_hour ?? whoopSyncHour ?? 9;
    const lastSyncValue = whoopStatusData?.last_sync_at || whoopConnection?.last_sync_at || whoopConnection?.last_successful_sync_at || null;
    const note = whoopConnection?.auto_sync_note;
    const staleMessage = whoopConnection?.stale_message || null;
    const selectedPreset = WHOOP_SYNC_PRESETS.find((preset) => preset.id === whoopSyncMode);
    const customDays = Number.parseInt(whoopCustomDaysBack, 10);
    const customDaysValid = Number.isFinite(customDays) && customDays > 0 && customDays <= MAX_CUSTOM_WHOOP_DAYS;

    return (
      <div className="space-y-5">
        <div className="rounded-sm border border-[#e7e5dd] bg-[#f8f7f3] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[#8a877d]">Auto sync</p>
              <p className="mt-1 text-sm text-[#1f1e1a]">Keep Whoop data refreshed automatically.</p>
              <p className="mt-1 text-xs leading-5 text-[#69665c]">
                Background sync resumes from the last successful checkpoint with a short safety overlap.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#8a877d]">{autoSyncEnabled ? 'On' : 'Off'}</span>
              <Switch
                checked={autoSyncEnabled}
                onCheckedChange={(checked) =>
                  handleWearableSyncSettingsUpdate('whoop', {
                    auto_sync_enabled: checked,
                    sync_hour: syncHour,
                  })
                }
                className="data-[state=checked]:bg-[#1f1e1a] data-[state=unchecked]:bg-[#d8d5cb]"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 border-t border-[#e7e5dd] pt-4 md:grid-cols-[1fr_180px] md:items-end">
            <div>
              <p className="text-sm text-[#1f1e1a]">Preferred sync time</p>
              <p className="mt-1 text-xs text-[#69665c]">Choose the hour for automatic refreshes.</p>
            </div>
            <Select
              value={String(syncHour)}
              onValueChange={(value) =>
                handleWearableSyncSettingsUpdate('whoop', {
                  auto_sync_enabled: autoSyncEnabled,
                  sync_hour: Number(value),
                })
              }
              disabled={!autoSyncEnabled}
            >
              <SelectTrigger className="h-11 rounded-sm border-[#d8d5cb] bg-white text-[#1f1e1a] focus:ring-0 disabled:opacity-50">
                <SelectValue placeholder="Select time" />
              </SelectTrigger>
              <SelectContent className="border-[#d8d5cb] bg-white text-[#1f1e1a]">
                {Array.from({ length: 24 }, (_, hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {formatHour(hour)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-[#8a877d]">
            <span>Last sync</span>
            <span className="text-[#1f1e1a]">{formatRelativeTime(lastSyncValue)}</span>
          </div>
          {note ? <p className="mt-2 text-xs leading-5 text-[#69665c]">{note}</p> : null}
          {staleMessage ? <p className="mt-2 text-xs leading-5 text-[#69665c]">{staleMessage}</p> : null}
        </div>

        <div className="rounded-sm border border-[#e7e5dd] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[#8a877d]">Manual sync</p>
              <h4 className="mt-1 text-lg font-medium tracking-[-0.02em] text-[#1f1e1a]">Choose how much history to import</h4>
              <p className="mt-2 max-w-[28rem] text-sm leading-6 text-[#69665c]">
                Use smart sync for day-to-day refreshes, a bounded backfill for a known gap, or full history to pull everything Whoop makes available for this account.
              </p>
            </div>
            <Button
              onClick={() => handleWhoopSync()}
              disabled={syncing || (whoopSyncMode === 'custom' && !customDaysValid)}
              className="h-11 rounded-sm bg-[#1f1e1a] px-4 text-sm text-white hover:bg-[#111111]"
            >
              {syncing ? 'Syncing...' : selectedPreset ? `Run ${selectedPreset.label}` : 'Run sync'}
            </Button>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {WHOOP_SYNC_PRESETS.map((preset) => {
              const active = whoopSyncMode === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setWhoopSyncMode(preset.id)}
                  className={cn(
                    'rounded-sm border px-3 py-3 text-left transition-colors',
                    active
                      ? 'border-[#1f1e1a] bg-[#1f1e1a] text-white'
                      : 'border-[#d8d5cb] bg-white text-[#1f1e1a] hover:bg-[#f3f1ea]'
                  )}
                >
                  <div className="text-sm font-medium">{preset.label}</div>
                  <div className={cn('mt-1 text-xs leading-5', active ? 'text-white/80' : 'text-[#69665c]')}>
                    {preset.description}
                  </div>
                </button>
              );
            })}
          </div>

          {whoopSyncMode === 'custom' ? (
            <div className="mt-4 rounded-sm border border-[#e7e5dd] bg-[#f8f7f3] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex-1">
                  <label htmlFor="whoop-custom-days" className="text-sm font-medium text-[#1f1e1a]">
                    Custom backfill window
                  </label>
                  <p className="mt-1 text-xs text-[#69665c]">
                    Enter any day count from 1 to {MAX_CUSTOM_WHOOP_DAYS}. Use full history if you want everything available.
                  </p>
                </div>
                <div className="w-full md:w-[180px]">
                  <Input
                    id="whoop-custom-days"
                    type="number"
                    min={1}
                    max={MAX_CUSTOM_WHOOP_DAYS}
                    step={1}
                    value={whoopCustomDaysBack}
                    onChange={(event) => setWhoopCustomDaysBack(event.target.value)}
                    className="h-11 rounded-sm border-[#d8d5cb] bg-white text-[#1f1e1a]"
                  />
                </div>
              </div>
              {!customDaysValid ? (
                <p className="mt-2 text-xs text-[#9a3412]">Enter a value between 1 and {MAX_CUSTOM_WHOOP_DAYS} days.</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 rounded-sm border border-dashed border-[#d8d5cb] bg-[#fcfbf8] p-4 text-xs leading-6 text-[#69665c]">
            {whoopSyncMode === 'full'
              ? 'Full history imports can take longer because Ritual will request everything Whoop makes available for this connection.'
              : whoopSyncMode === 'smart'
                ? 'Smart sync is the recommended default. It preserves your checkpoint and only overlaps a short safety window to avoid gaps.'
                : whoopSyncMode === 'custom'
                  ? 'Custom backfills are useful after a short outage, reconnect, or when you want to repair a specific missing range.'
                  : `This preset will backfill the last ${selectedPreset?.label.replace('d', '') || ''} days before returning to incremental syncs.`}
          </div>
        </div>
      </div>
    );
  };

  // ================================
  // APPLE WATCH HANDLERS
  // ================================

  async function handleAppleWatchDisconnect() {
    try {
      const token = await getToken();
      if (!token) return;

      if (!confirm('Are you sure you want to disconnect Apple Watch? You can reconnect using the Ritual iOS companion app.')) {
        return;
      }

      // Get the device ID to deactivate
      const devices = appleWatchStatusData?.devices || [];
      if (devices.length === 0) {
        alert('No Apple Watch device found');
        return;
      }

      // Deactivate all connected devices
      for (const device of devices) {
        const response = await fetch(`${API_BASE_URL}/api/wearables/apple/devices/${device.device_id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to disconnect device');
        }
      }

      refetchOverview();
      alert('Apple Watch disconnected successfully. You can reconnect using the Ritual iOS companion app.');
    } catch (error) {
      console.error('❌ Error disconnecting Apple Watch:', error);
      alert(`Failed to disconnect: ${error}`);
    }
  }

  function handleAppleWatchConnect() {
    // Show instructions for connecting via iOS companion app
    alert(
      '📱 To connect your Apple Watch:\n\n' +
      '1. Download the Ritual Companion app on your iPhone\n' +
      '2. Sign in with your Ritual account\n' +
      '3. Tap "Connect" to register your device\n' +
      '4. Grant HealthKit permissions\n' +
      '5. Tap "Sync Now" to sync your data\n\n' +
      'Your Apple Watch data will be synced through your iPhone.'
    );
  }

  async function handleWearableProviderConnect(provider: 'oura' | 'garmin') {
    try {
      setWearableConnectingProvider(provider);

      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/wearables/connections/${provider}/authorize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to start wearable authorization');
      }

      const result = await response.json();
      if (result.authorization_url) {
        await openInBrowser(result.authorization_url);
        return;
      }

      alert(result.message || 'Wearable connection started.');
    } catch (error) {
      console.error(`❌ Error connecting ${provider}:`, error);
      alert(`Failed to connect ${provider}: ${error}`);
      setWearableConnectingProvider(null);
    }
  }

  async function handleWearableProviderDisconnect(provider: 'oura' | 'garmin') {
    try {
      const token = await getToken();
      if (!token) return;

      if (!confirm(`Disconnect ${provider === 'oura' ? 'Oura' : 'Garmin'}?`)) {
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/wearables/connections/${provider}/disconnect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect wearable');
      }

      await refetchOverview();
      alert(`${provider === 'oura' ? 'Oura' : 'Garmin'} disconnected.`);
    } catch (error) {
      console.error(`❌ Error disconnecting ${provider}:`, error);
      alert(`Failed to disconnect ${provider}: ${error}`);
    }
  }

  async function handleWearableProviderSync(provider: 'oura' | 'garmin') {
    try {
      setWearableSyncingProvider(provider);
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/wearables/connections/${provider}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Wearable sync failed');
      }

      const result = await response.json();
      await Promise.all([
        refetchOverview(),
        fetchHabits(),
        fetchHabitLogs(),
      ]);
      alert(result.message || `${provider} sync finished.`);
    } catch (error) {
      console.error(`❌ Error syncing ${provider}:`, error);
      alert(`Failed to sync ${provider}: ${error}`);
    } finally {
      setWearableSyncingProvider(null);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-lg font-medium">Integrations</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Computer Use Card - Only show on desktop (Tauri) */}
        {isTauri() && (
          <IntegrationCard
            logo={<Monitor className="h-7 w-7 text-gray-900" />}
            title="Computer Use"
            description="Track your computer usage including apps, websites, and active time automatically."
            isConnected={computerTrackingConnected}
            onConnect={() => router.replace('/integrations?openSettings=computer-tracking')}
            onDisconnect={() => router.replace('/integrations?openSettings=computer-tracking')}
            onDetails={() => openIntegrationDetails('computer')}
          />
        )}

        {/* Apple Watch Card - 2nd, right next to Computer Use */}
        <IntegrationCard
          logo={
            <svg className="h-6 w-6" viewBox="0 0 814 1000" fill="currentColor">
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
            </svg>
          }
          title="Apple Watch"
          description="Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics."
          isConnected={appleWatchConnected}
          onConnect={handleAppleWatchConnect}
          onDisconnect={handleAppleWatchDisconnect}
          onDetails={() => openIntegrationDetails('applewatch')}
        />

        {/* Whoop Card */}
        <IntegrationCard
          logo={
            <Image
              src="/images/whoop.svg"
              alt="Whoop"
              width={80}
              height={32}
              className="h-6 w-auto object-contain"
            />
          }
          title="Whoop"
          description="Track your recovery, sleep, and strain data from your Whoop device."
          isConnected={effectiveWhoopConnected}
          isConnecting={whoopConnecting}
          isSyncing={syncing}
          onConnect={handleWhoopConnect}
          onSync={() => handleWhoopSync()}
          onDisconnect={handleWhoopDisconnect}
          onDetails={() => openIntegrationDetails('whoop')}
        />

        {/* Oura Ring - before Coming soon cards */}
        <IntegrationCard
          logo={<Image src="/images/oura.svg" alt="Oura" width={40} height={40} className="h-10 w-auto object-contain" />}
          title="Oura Ring"
          description="Sync your sleep, readiness, HRV, and temperature trends from Oura Ring."
          isConnected={!!ouraConnection && ouraConnection.status === 'active'}
          isConnecting={wearableConnectingProvider === 'oura'}
          isSyncing={wearableSyncingProvider === 'oura'}
          onConnect={() => handleWearableProviderConnect('oura')}
          onSync={() => handleWearableProviderSync('oura')}
          onDisconnect={() => handleWearableProviderDisconnect('oura')}
          onDetails={() => openIntegrationDetails('oura')}
        />

        {/* Garmin - before Coming soon cards */}
        <IntegrationCard
          logo={<Image src="/images/garmin.svg" alt="Garmin" width={60} height={24} className="h-6 w-auto object-contain" />}
          title="Garmin"
          description="Integrate Garmin devices for activity, workout, sleep, and recovery tracking."
          isConnected={!!garminConnection && garminConnection.status === 'active'}
          isConnecting={wearableConnectingProvider === 'garmin'}
          isSyncing={wearableSyncingProvider === 'garmin'}
          onConnect={() => handleWearableProviderConnect('garmin')}
          onSync={() => handleWearableProviderSync('garmin')}
          onDisconnect={() => handleWearableProviderDisconnect('garmin')}
          onDetails={() => openIntegrationDetails('garmin')}
        />

        {/* Coming soon cards */}
        <IntegrationCard
          logo={
            <Image src="/images/plaid-mark.svg" alt="Plaid" width={48} height={52} className="h-7 w-auto object-contain" />
          }
          title="Plaid"
          descriptionLineClamp={3}
          description="Connect any of your bank accounts to track your spending behavior—Ritual summarizes posted transactions into simple daily totals."
          isConnected={plaidConnected}
          isConnecting={plaidConnecting}
          isSyncing={!plaidNeedsReconnect && plaidSyncing}
          connectLabel="Connect"
          onConnect={handlePlaidConnect}
          onSync={plaidNeedsReconnect ? undefined : handlePlaidSync}
          onDisconnect={handlePlaidDisconnect}
          onDetails={() => openIntegrationDetails('plaid')}
          extraActions={
            plaidConnected && plaidNeedsReconnect ? (
              <button
                onClick={handlePlaidReconnect}
                disabled={plaidConnecting}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50"
              >
                {plaidConnecting ? 'Reconnecting...' : 'Reconnect'}
              </button>
            ) : null
          }
        />

        <IntegrationCard
          logo={<Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={28} height={28} className="h-7 w-7" />}
          title="Apple Screen Time"
          description="Track your digital habits by importing Screen Time data from your iPhone or iPad."
          comingSoon
          onDetails={() => openIntegrationDetails('screentime')}
        />

        <IntegrationCard
          logo={<Image src="/images/fitbit.svg" alt="Fitbit" width={60} height={24} className="h-6 w-auto object-contain" />}
          title="Fitbit"
          description="Connect your Fitbit to track activity and health metrics"
          comingSoon
          onDetails={() => openIntegrationDetails('fitbit')}
        />

        <IntegrationCard
          logo={<Image src="/images/cal_ai.svg" alt="Cal AI" width={80} height={32} className="h-8 w-auto object-contain" />}
          title="Cal AI"
          description="Track your nutrition and calories with AI-powered food recognition"
          comingSoon
          onDetails={() => openIntegrationDetails('calai')}
        />

        <IntegrationCard
          logo={<Image src="/images/Google_Calendar_Logo.svg" alt="Google Calendar" width={24} height={24} className="h-6 w-6" />}
          title="Google Calendar"
          description="Track meeting time, frequency, and patterns by syncing your Google Calendar events"
          comingSoon
          onDetails={() => openIntegrationDetails('googlecalendar')}
        />

        <IntegrationCard
          logo={<Image src="/images/Tesla_T_symbol.svg" alt="Tesla" width={24} height={24} className="h-6 w-6" />}
          title="Tesla"
          description="Track miles driven from your Tesla vehicles."
          isConnected={effectiveTeslaConnected}
          isConnecting={teslaConnecting}
          isSyncing={teslaSyncing}
          onConnect={handleTeslaConnect}
          onSync={handleTeslaSync}
          onDisconnect={handleTeslaDisconnect}
          onDetails={() => openIntegrationDetails('tesla')}
        />
      </div>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="overflow-hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>{selectedIntegration ? `${selectedIntegration} details` : 'Integration details'}</SheetTitle>
          </SheetHeader>
          {renderIntegrationDetailsPanel()}
        </SheetContent>
      </Sheet>
    </>
  );
}
