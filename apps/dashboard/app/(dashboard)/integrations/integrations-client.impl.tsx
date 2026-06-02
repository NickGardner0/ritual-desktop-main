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
import { invalidateAfterActivitySync, invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import { clearPersistedDashboardSnapshots } from '@/hooks/use-dashboard-snapshot-query';

import {
  API_BASE_URL,
  INTEGRATIONS_GREEN_SWITCH_CLASS,
  IntegrationCard,
  MAX_CUSTOM_WHOOP_DAYS,
  WHOOP_SYNC_PRESETS,
  buildWhoopSyncFeedbackMessage,
  formatErrorMessage,
  formatHour,
  formatRelativeTime,
  isLikelyReactEvent,
  parseApiError,
  useAppleWatchStatus,
  useComputerTrackingStatus,
  useFinancialConnections,
  useIphoneTimeIntegrationStatus,
  useIntegrationsOverview,
  useWearableConnections,
  useWhoopStatus,
} from './integrations-client.shared';
import type { WhoopSyncFeedback, WhoopSyncMode } from './integrations-client.shared';
import { createIntegrationDetailRenderers } from './integrations-client.details';
import { buildIntegrationCards, IntegrationCardsGrid } from './integrations-client.cards';
import { useAppleHealthExport } from './use-apple-health-export';
import { usePlaidIntegration } from './use-plaid-integration';
import { useTeslaIntegration } from './use-tesla-integration';

export function IntegrationsClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const { fetchHabits, fetchHabitLogs } = useHabits();
  const queryClient = useQueryClient();
  const { data: integrationsOverview, refetch: refetchOverviewQuery } = useIntegrationsOverview();
  const iphoneTimeIntegrationQuery = useIphoneTimeIntegrationStatus();
  const iphoneTimeIntegration = iphoneTimeIntegrationQuery.data;
  const refetchOverview = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['integrations-overview'] });
    return refetchOverviewQuery();
  }, [queryClient, refetchOverviewQuery]);
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
  const [whoopSyncFeedback, setWhoopSyncFeedback] = useState<WhoopSyncFeedback | null>(null);
  const [appleWatchSyncing, setAppleWatchSyncing] = useState(false);
  const [iphoneTimeConnecting, setIphoneTimeConnecting] = useState(false);
  const [iphoneTimeSyncing, setIphoneTimeSyncing] = useState(false);
  const [iphoneTimeImporting, setIphoneTimeImporting] = useState(false);
  const {
    applyExportDatePreset,
    exportDatePreset,
    exportEndDate,
    exportFormat,
    exportHistory,
    exportLoading,
    exportResult,
    exportSchedule,
    exportStartDate,
    exportWriteMode,
    handleExportNow,
    historyLoaded,
    loadExportHistory,
    loadExportSchedule,
    loadMetricCatalogAndPreferences,
    metricCatalog,
    metricsLoaded,
    saveExportSchedule,
    saveMetricPreferences,
    scheduleLoaded,
    scheduleSaving,
    selectedMetrics,
    setExportDatePreset,
    setExportEndDate,
    setExportFormat,
    setExportHistory,
    setExportStartDate,
    setExportWriteMode,
    updateScheduleField,
  } = useAppleHealthExport({ getToken });
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);
  const [wearableConnectingProvider, setWearableConnectingProvider] = useState<string | null>(null);
  const [wearableSyncingProvider, setWearableSyncingProvider] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'metrics' | 'export' | 'settings'>('overview');
  const [integrationSearch, setIntegrationSearch] = useState('');
  const [integrationFilter, setIntegrationFilter] = useState<'all' | 'connected'>('all');
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

  // Update local state when query data changes
  useEffect(() => {
    if (whoopStatusData !== undefined || whoopConnection) {
      setWhoopConnected(effectiveWhoopConnected);
      setWhoopSyncHour(whoopStatusData?.sync_hour || whoopConnection?.sync_hour || 9);
    }
  }, [effectiveWhoopConnected, whoopConnection, whoopStatusData]);


  const callbackProcessedRef = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const oauthSessionIdRef = useRef<string | null>(null);
  const oauthSessionTokenRef = useRef<string | null>(null);

  const {
    handlePlaidAccountInclusion,
    handlePlaidBackfill,
    handlePlaidConnect,
    handlePlaidDisconnect,
    handlePlaidReconnect,
    handlePlaidSync,
    handlePlaidSyncSettingsUpdate,
    plaidAccountSavingId,
    plaidBackfilling,
    plaidConnecting,
    plaidSettingsSaving,
    plaidSyncing,
  } = usePlaidIntegration({
    fetchHabitLogs,
    fetchHabits,
    getToken,
    openUserProfile,
    plaidConnection,
    plaidMfaRequired,
    refetchOverview,
  });

  const {
    effectiveTeslaConnected,
    handleTeslaBackfill,
    handleTeslaCallback,
    handleTeslaConnect,
    handleTeslaDisconnect,
    handleTeslaSync,
    setTeslaBackfillDate,
    setTeslaBackfillOdometer,
    teslaBackfillDate,
    teslaBackfillOdometer,
    teslaBackfilling,
    teslaConnecting,
    teslaSyncing,
  } = useTeslaIntegration({
    callbackProcessedRef,
    fetchHabitLogs,
    fetchHabits,
    getToken,
    oauthSessionIdRef,
    oauthSessionTokenRef,
    pollingIntervalRef,
    refetchOverview,
    router,
    setIsProcessingCallback,
    teslaConnection,
  });

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
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

  const openIntegrationDetails = (integration: string) => {
    setSelectedIntegration(integration);
    setDetailsTab('overview');
    setDetailsOpen(true);
  };

  const refreshIphoneTimeIntegration = useCallback(async () => {
    await iphoneTimeIntegrationQuery.refetch();
    void refetchOverview();
    void invalidateAfterActivitySync(queryClient, user?.id);
  }, [iphoneTimeIntegrationQuery, queryClient, refetchOverview, user?.id]);

  const handleIphoneTimeConnect = useCallback(async () => {
    try {
      setIphoneTimeConnecting(true);
      openIntegrationDetails('screentime');
      if (!isTauri()) {
        return;
      }
      await iphoneTimeIntegrationQuery.refetch();
    } catch (error) {
      console.error('Failed to check iPhone Time status:', error);
    } finally {
      setIphoneTimeConnecting(false);
    }
  }, [iphoneTimeIntegrationQuery]);

  const handleIphoneTimeSync = useCallback(async () => {
    if (!isTauri()) {
      openIntegrationDetails('screentime');
      return;
    }
    try {
      setIphoneTimeSyncing(true);
      await invoke('desktop_trigger_biome_iphone_sync');
      await refreshIphoneTimeIntegration();
    } catch (error) {
      console.error('Failed to sync iPhone Time:', error);
      alert(`Failed to sync iPhone Time: ${formatErrorMessage(error, 'Unknown error')}`);
      await iphoneTimeIntegrationQuery.refetch();
    } finally {
      setIphoneTimeSyncing(false);
    }
  }, [iphoneTimeIntegrationQuery, refreshIphoneTimeIntegration]);

  const handleIphoneTimeImport = useCallback(async () => {
    if (!isTauri()) {
      openIntegrationDetails('screentime');
      return;
    }
    try {
      setIphoneTimeImporting(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        defaultPath: '/Users/Shared/ritual-biome-iphone-export.jsonl',
        filters: [
          { name: 'Biome JSONL export', extensions: ['jsonl', 'json'] },
        ],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      await invoke('import_biome_iphone_export', { path: selected });
      await handleIphoneTimeSync();
    } catch (error) {
      console.error('Failed to import iPhone Time export:', error);
      alert(`Failed to import iPhone Time export: ${formatErrorMessage(error, 'Unknown error')}`);
      await iphoneTimeIntegrationQuery.refetch();
    } finally {
      setIphoneTimeImporting(false);
    }
  }, [handleIphoneTimeSync, iphoneTimeIntegrationQuery]);


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
      setWhoopSyncFeedback({
        type: 'syncing',
        message: 'Syncing Whoop data...',
      });

      const token = await getToken();
      if (!token) {
        setWhoopSyncFeedback({
          type: 'error',
          message: 'Sign in again to sync Whoop.',
        });
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
      const syncLabel = syncRequest.fullHistory
        ? 'full history'
        : syncRequest.daysBack
          ? `the last ${syncRequest.daysBack} days`
          : syncRequest.forceFullSync
            ? 'the default backfill'
            : 'latest changes';
      const successMessage = buildWhoopSyncFeedbackMessage(
        syncCounts,
        syncLabel,
        result.data_freshness,
      );

      setWhoopConnected(true);
      markReadConsistencyRequired(user?.id, 45_000);
      clearPersistedDashboardSnapshots(user?.id);
      const refreshResults = await Promise.allSettled([
        invalidateHabitData(queryClient, user?.id || 'anonymous'),
        refetchOverview(),
        fetchHabits(),
        fetchHabitLogs(),
      ]);
      const refreshFailed = refreshResults.some((result) => result.status === 'rejected');

      setWhoopSyncFeedback({
        type: 'success',
        message: refreshFailed
          ? `${successMessage} Some views may take a moment to refresh.`
          : successMessage,
      });
    } catch (error) {
      console.error('❌ Error syncing Whoop:', error);
      const fallbackMessage =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Sync timed out. The request took too long.'
          : 'Unknown error';
      const message = `Sync failed: ${formatErrorMessage(error, fallbackMessage)}`;
      setWhoopSyncFeedback({
        type: 'error',
        message,
      });
      alert(message);
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

  const { renderIntegrationDetailsPanel } = createIntegrationDetailRenderers({
    appleHealthConnection,
    appleWatchConnected,
    appleWatchLastSync,
    appleWatchStatusData,
    applyExportDatePreset,
    detailsTab,
    effectiveTeslaConnected,
    exportDatePreset,
    exportEndDate,
    exportFormat,
    exportHistory,
    exportLoading,
    exportResult,
    exportSchedule,
    exportStartDate,
    exportWriteMode,
    garminConnection,
    getToken,
    handleAppleWatchDisconnect,
    handleExportNow,
    handlePlaidAccountInclusion,
    handlePlaidBackfill,
    handlePlaidConnect,
    handlePlaidReconnect,
    handlePlaidSync,
    handlePlaidSyncSettingsUpdate,
    handleTeslaBackfill,
    handleTeslaConnect,
    handleTeslaDisconnect,
    handleTeslaSync,
    handleWearableProviderSync,
    handleWearableSyncSettingsUpdate,
    handleWhoopConnect,
    handleWhoopDisconnect,
    handleWhoopSync,
    handleIphoneTimeConnect,
    handleIphoneTimeImport,
    handleIphoneTimeSync,
    historyLoaded,
    iphoneTimeConnecting,
    iphoneTimeImporting,
    iphoneTimeIntegration,
    iphoneTimeStatusLoading: iphoneTimeIntegrationQuery.isLoading,
    iphoneTimeSyncing,
    loadExportHistory,
    loadExportSchedule,
    loadMetricCatalogAndPreferences,
    metricCatalog,
    metricsLoaded,
    ouraConnection,
    plaidAccountSavingId,
    plaidBackfilling,
    plaidConnected,
    plaidConnecting,
    plaidConnection,
    plaidNeedsReconnect,
    plaidReconnectReason,
    plaidSettingsSaving,
    plaidSyncing,
    saveExportSchedule,
    saveMetricPreferences,
    scheduleLoaded,
    scheduleSaving,
    selectedIntegration,
    selectedMetrics,
    setDetailsTab,
    setExportDatePreset,
    setExportEndDate,
    setExportFormat,
    setExportHistory,
    setExportStartDate,
    setExportWriteMode,
    setTeslaBackfillDate,
    setTeslaBackfillOdometer,
    setWhoopCustomDaysBack,
    setWhoopSyncMode,
    syncing,
    teslaBackfillDate,
    teslaBackfillOdometer,
    teslaBackfilling,
    teslaConnecting,
    teslaConnection,
    teslaSyncing,
    updateScheduleField,
    wearableSyncingProvider,
    whoopConnection,
    whoopCustomDaysBack,
    whoopStatusData,
    whoopSyncFeedback,
    whoopSyncHour,
    whoopSyncMode,
  });

  const integrationCards = buildIntegrationCards({
    appleWatchConnected,
    computerTrackingConnected,
    effectiveTeslaConnected,
    effectiveWhoopConnected,
    garminConnection,
    handleAppleWatchConnect,
    handleAppleWatchDisconnect,
    handlePlaidConnect,
    handlePlaidDisconnect,
    handlePlaidReconnect,
    handlePlaidSync,
    handleTeslaConnect,
    handleTeslaDisconnect,
    handleTeslaSync,
    handleWearableProviderConnect,
    handleWearableProviderDisconnect,
    handleWearableProviderSync,
    handleWhoopConnect,
    handleWhoopDisconnect,
    handleWhoopSync,
    handleIphoneTimeConnect,
    handleIphoneTimeSync,
    iphoneTimeConnecting,
    iphoneTimeIntegration,
    iphoneTimeStatusLoading: iphoneTimeIntegrationQuery.isLoading,
    iphoneTimeSyncing,
    openIntegrationDetails,
    ouraConnection,
    plaidConnected,
    plaidConnecting,
    plaidNeedsReconnect,
    plaidSyncing,
    router,
    syncing,
    teslaConnecting,
    teslaSyncing,
    wearableConnectingProvider,
    wearableSyncingProvider,
    whoopConnecting,
    whoopSyncFeedback,
  });

  return (
    <>
      <IntegrationCardsGrid
        integrationCards={integrationCards}
        integrationFilter={integrationFilter}
        integrationSearch={integrationSearch}
        setIntegrationFilter={setIntegrationFilter}
        setIntegrationSearch={setIntegrationSearch}
      />
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
