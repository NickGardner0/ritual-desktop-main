'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser, useClerk } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useHabits } from '@/contexts/HabitsContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { useIntegrationsOverview, useIphoneTimeIntegrationStatus } from './integrations-client.shared';
import { buildIntegrationCards, IntegrationCardsGrid } from './integrations-client.cards';
import { renderIntegrationDetailsPanel } from './integrations-client.details';
import {
  handleWearableSyncSettingsUpdate as updateWearableSyncSettings,
  useLegacyWearableHandlers,
} from './integrations-client.legacy-wearables';
import { useIntegrationOAuthEffects } from './integrations-client.oauth-effects';
import { useAppleHealthExport } from './plugins/apple-health/use-apple-health-export';
import { useIphoneTimeIntegration } from './plugins/iphone-time/use-iphone-time-integration';
import { usePlaidIntegration } from './plugins/plaid/use-plaid-integration';
import { useTeslaIntegration } from './plugins/tesla/use-tesla-integration';
import { useWhoopIntegration } from './plugins/whoop/use-whoop-integration';
import type { IntegrationCardRuntimeContext, IntegrationRuntimeContext } from './plugins/types';

export function IntegrationsClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { openUserProfile } = useClerk();
  const { fetchHabits, fetchHabitLogs } = useHabits();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDesktop } = useDesktopCapabilities();

  const { data: integrationsOverview, refetch: refetchOverviewQuery } = useIntegrationsOverview();
  const iphoneTimeIntegrationQuery = useIphoneTimeIntegrationStatus();

  const refetchOverview = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['integrations-overview'] });
    return refetchOverviewQuery();
  }, [queryClient, refetchOverviewQuery]);

  const [isProcessingCallback, setIsProcessingCallback] = useState(false);
  const [wearableConnectingProvider, setWearableConnectingProvider] = useState<string | null>(null);
  const [wearableSyncingProvider, setWearableSyncingProvider] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<'overview' | 'metrics' | 'export' | 'settings'>('overview');
  const [integrationSearch, setIntegrationSearch] = useState('');
  const [integrationFilter, setIntegrationFilter] = useState<'all' | 'connected'>('all');

  const callbackProcessedRef = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const oauthSessionIdRef = useRef<string | null>(null);
  const oauthSessionTokenRef = useRef<string | null>(null);

  const whoopStatusData = integrationsOverview?.whoopStatus;
  const appleWatchStatusData = integrationsOverview?.appleWatchStatus;
  const wearableConnections = integrationsOverview?.wearableConnections?.connections || [];
  const financialConnections = integrationsOverview?.financialConnections?.connections || [];
  const computerTrackingStatus = integrationsOverview?.computerTrackingStatus;

  const findWearableConnection = (provider: string) =>
    wearableConnections.find((item: { provider?: string }) => item.provider === provider);

  const whoopConnection = findWearableConnection('whoop');
  const appleHealthConnection = findWearableConnection('apple_health');
  const ouraConnection = findWearableConnection('oura');
  const garminConnection = findWearableConnection('garmin');
  const teslaConnection = findWearableConnection('tesla');
  const plaidConnection = financialConnections.find((item: { provider?: string }) => item.provider === 'plaid');

  const appleWatchConnected = appleWatchStatusData?.connected || false;
  const appleWatchLastSync = appleWatchStatusData?.lastSyncAt;
  const computerTrackingConnected = computerTrackingStatus?.connected || false;
  const plaidConnected = !!plaidConnection && (plaidConnection as { status?: string }).status === 'active';
  const userHasMfaEnabled = Boolean((user as { twoFactorEnabled?: boolean })?.twoFactorEnabled);
  const plaidMfaRequired = !userHasMfaEnabled;
  const plaidNeedsReconnect = Boolean((plaidConnection as { requires_reconnect?: boolean })?.requires_reconnect);
  const plaidReconnectReason =
    (plaidConnection as { last_error_json?: Record<string, string> })?.last_error_json?.display_message ||
    (plaidConnection as { last_error_json?: Record<string, string> })?.last_error_json?.error_message ||
    (plaidConnection as { last_error_json?: Record<string, string> })?.last_error_json?.message ||
    'This bank connection needs to be repaired before spending can continue syncing.';

  const effectiveWhoopConnected = Boolean(
    (whoopConnection && (whoopConnection as { status?: string }).status === 'active') ||
      (whoopStatusData as { connected?: boolean })?.connected,
  );

  const openIntegrationDetails = useCallback((integration: string) => {
    setSelectedIntegration(integration);
    setDetailsTab('overview');
    setDetailsOpen(true);
  }, []);

  const appleHealthExport = useAppleHealthExport({ getToken });

  const whoopIntegration = useWhoopIntegration({
    callbackProcessedRef,
    effectiveWhoopConnected,
    fetchHabitLogs,
    fetchHabits,
    getToken,
    oauthSessionIdRef,
    oauthSessionTokenRef,
    pollingIntervalRef,
    queryClient,
    refetchOverview,
    setIsProcessingCallback,
    userId: user?.id,
    whoopConnection,
    whoopStatusData,
  });

  const plaidIntegration = usePlaidIntegration({
    fetchHabitLogs,
    fetchHabits,
    getToken,
    openUserProfile,
    plaidConnection,
    plaidMfaRequired,
    refetchOverview,
  });

  const teslaIntegration = useTeslaIntegration({
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

  const iphoneTimeIntegration = useIphoneTimeIntegration({
    iphoneTimeIntegrationQuery,
    openIntegrationDetails,
    queryClient,
    refetchOverview,
    userId: user?.id,
  });

  const legacyWearables = useLegacyWearableHandlers({
    appleWatchStatusData,
    fetchHabitLogs,
    fetchHabits,
    getToken,
    refetchOverview,
    setWearableConnectingProvider,
    setWearableSyncingProvider,
  });

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  useIntegrationOAuthEffects({
    callbackProcessedRef,
    handleTeslaCallback: teslaIntegration.handleTeslaCallback,
    handleWhoopCallback: whoopIntegration.handleWhoopCallback,
    refetchOverview,
    router,
    searchParams,
    setIsProcessingCallback,
    setWearableConnectingProvider,
  });

  const handleWearableSyncSettingsUpdate = useCallback(
    (provider: 'whoop' | 'apple_health' | 'oura' | 'garmin', updates: { auto_sync_enabled?: boolean; sync_hour?: number }) =>
      updateWearableSyncSettings({
        appleHealthConnection,
        garminConnection,
        getToken,
        ouraConnection,
        provider,
        refetchOverview,
        setWhoopSyncHour: whoopIntegration.setWhoopSyncHour,
        updates,
        whoopConnection,
        whoopSyncHour: whoopIntegration.whoopSyncHour,
      }),
    [
      appleHealthConnection,
      garminConnection,
      getToken,
      ouraConnection,
      refetchOverview,
      whoopConnection,
      whoopIntegration.setWhoopSyncHour,
      whoopIntegration.whoopSyncHour,
    ],
  );

  const runtimeContext = useMemo<IntegrationRuntimeContext>(
    () => ({
      appleHealthConnection,
      appleWatchConnected,
      appleWatchLastSync,
      appleWatchStatusData,
      callbackProcessedRef,
      computerTrackingConnected,
      detailsTab,
      effectiveWhoopConnected: Boolean(
        whoopIntegration.whoopConnected ||
          (whoopConnection && (whoopConnection as { status?: string }).status === 'active'),
      ),
      fetchHabitLogs,
      fetchHabits,
      garminConnection,
      getToken,
      handleWearableSyncSettingsUpdate,
      integrationsOverview,
      isDesktop,
      iphoneTimeIntegrationQuery,
      oauthSessionIdRef,
      oauthSessionTokenRef,
      openIntegrationDetails,
      openUserProfile,
      ouraConnection,
      plaidConnected,
      plaidConnection,
      plaidMfaRequired,
      plaidNeedsReconnect,
      plaidReconnectReason,
      pollingIntervalRef,
      queryClient,
      refetchOverview,
      router,
      selectedIntegration,
      setDetailsTab,
      setIsProcessingCallback,
      teslaConnection,
      userHasMfaEnabled,
      userId: user?.id,
      wearableConnectingProvider,
      wearableSyncingProvider,
      whoopConnection,
      whoopStatusData,
      ...appleHealthExport,
      ...whoopIntegration,
      ...plaidIntegration,
      ...teslaIntegration,
      ...iphoneTimeIntegration,
      ...legacyWearables,
    }),
    [
      appleHealthConnection,
      appleHealthExport,
      appleWatchConnected,
      appleWatchLastSync,
      appleWatchStatusData,
      computerTrackingConnected,
      detailsTab,
      fetchHabitLogs,
      fetchHabits,
      garminConnection,
      getToken,
      handleWearableSyncSettingsUpdate,
      integrationsOverview,
      isDesktop,
      iphoneTimeIntegration,
      iphoneTimeIntegrationQuery,
      legacyWearables,
      openIntegrationDetails,
      openUserProfile,
      ouraConnection,
      plaidConnected,
      plaidConnection,
      plaidIntegration,
      plaidMfaRequired,
      plaidNeedsReconnect,
      plaidReconnectReason,
      queryClient,
      refetchOverview,
      router,
      selectedIntegration,
      teslaConnection,
      teslaIntegration,
      user?.id,
      userHasMfaEnabled,
      wearableConnectingProvider,
      wearableSyncingProvider,
      whoopConnection,
      whoopIntegration,
      whoopStatusData,
    ],
  );

  const integrationCardContext = useMemo(() => {
    return {
      appleWatchConnected,
      computerTrackingConnected,
      effectiveTeslaConnected: teslaIntegration.effectiveTeslaConnected,
      effectiveWhoopConnected: Boolean(
        whoopIntegration.whoopConnected ||
          (whoopConnection && (whoopConnection as { status?: string }).status === 'active'),
      ),
      garminConnection,
      handleAppleWatchConnect: legacyWearables.handleAppleWatchConnect,
      handleAppleWatchDisconnect: legacyWearables.handleAppleWatchDisconnect,
      handleIphoneTimeConnect: iphoneTimeIntegration.handleIphoneTimeConnect,
      handleIphoneTimeSync: iphoneTimeIntegration.handleIphoneTimeSync,
      handlePlaidConnect: plaidIntegration.handlePlaidConnect,
      handlePlaidDisconnect: plaidIntegration.handlePlaidDisconnect,
      handlePlaidReconnect: plaidIntegration.handlePlaidReconnect,
      handlePlaidSync: plaidIntegration.handlePlaidSync,
      handleTeslaConnect: teslaIntegration.handleTeslaConnect,
      handleTeslaDisconnect: teslaIntegration.handleTeslaDisconnect,
      handleTeslaSync: teslaIntegration.handleTeslaSync,
      handleWearableProviderConnect: legacyWearables.handleWearableProviderConnect,
      handleWearableProviderDisconnect: legacyWearables.handleWearableProviderDisconnect,
      handleWearableProviderSync: legacyWearables.handleWearableProviderSync,
      handleWhoopConnect: whoopIntegration.handleWhoopConnect,
      handleWhoopDisconnect: whoopIntegration.handleWhoopDisconnect,
      handleWhoopSync: whoopIntegration.handleWhoopSync,
      isDesktop,
      iphoneTimeConnecting: iphoneTimeIntegration.iphoneTimeConnecting,
      iphoneTimeIntegration: iphoneTimeIntegration.iphoneTimeIntegration,
      iphoneTimeStatusLoading: iphoneTimeIntegration.iphoneTimeStatusLoading,
      iphoneTimeSyncing: iphoneTimeIntegration.iphoneTimeSyncing,
      openIntegrationDetails,
      ouraConnection,
      plaidConnected,
      plaidConnecting: plaidIntegration.plaidConnecting,
      plaidNeedsReconnect,
      plaidSyncing: plaidIntegration.plaidSyncing,
      router,
      syncing: whoopIntegration.syncing,
      teslaConnecting: teslaIntegration.teslaConnecting,
      teslaSyncing: teslaIntegration.teslaSyncing,
      wearableConnectingProvider,
      wearableSyncingProvider,
      whoopConnecting: whoopIntegration.whoopConnecting,
      whoopSyncFeedback: whoopIntegration.whoopSyncFeedback,
    } satisfies IntegrationCardRuntimeContext;
  }, [
    appleWatchConnected,
    computerTrackingConnected,
    garminConnection,
    isDesktop,
    iphoneTimeIntegration,
    legacyWearables,
    openIntegrationDetails,
    ouraConnection,
    plaidConnected,
    plaidIntegration,
    plaidNeedsReconnect,
    router,
    teslaIntegration,
    wearableConnectingProvider,
    wearableSyncingProvider,
    whoopConnection,
    whoopIntegration,
  ]);

  const integrationCards = buildIntegrationCards(integrationCardContext);

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
          {renderIntegrationDetailsPanel(selectedIntegration, runtimeContext)}
        </SheetContent>
      </Sheet>
    </>
  );
}
