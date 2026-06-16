import type { ReactNode } from 'react';

export type IntegrationCardItem = {
  id: string;
  title: string;
  description: string;
  keywords?: string[];
  isConnected: boolean;
  node: ReactNode;
};

export type IntegrationPlugin = {
  id: string;
  detailKey: string;
  title: string;
  keywords?: string[];
  buildCard: (ctx: IntegrationCardRuntimeContext) => IntegrationCardItem | null;
  DetailPanel: (props: { ctx: IntegrationRuntimeContext }) => ReactNode;
  PanelAction?: (props: { ctx: IntegrationRuntimeContext }) => ReactNode;
  useIntegration?: (deps: IntegrationOrchestratorDeps) => Record<string, unknown>;
};

export type IntegrationOrchestratorDeps = {
  getToken: () => Promise<string | null>;
  userId?: string;
  refetchOverview: () => unknown;
    fetchHabits: () => unknown;
    fetchHabitLogs: () => unknown;
  isDesktop: boolean;
  router: { replace: (path: string) => void };
  openUserProfile: () => void;
  openIntegrationDetails: (integration: string) => void;
  integrationsOverview: ReturnType<typeof import('../integrations-client.shared').useIntegrationsOverview>['data'];
  iphoneTimeIntegrationQuery: ReturnType<typeof import('../integrations-client.shared').useIphoneTimeIntegrationStatus>;
  callbackProcessedRef: { current: boolean };
  oauthSessionIdRef: { current: string | null };
  oauthSessionTokenRef: { current: string | null };
  pollingIntervalRef: { current: NodeJS.Timeout | null };
  setIsProcessingCallback: (value: boolean) => void;
  queryClient: import('@tanstack/react-query').QueryClient;
  handleWearableSyncSettingsUpdate: (
    provider: 'whoop' | 'apple_health' | 'oura' | 'garmin',
    updates: { auto_sync_enabled?: boolean; sync_hour?: number },
  ) => Promise<void>;
  handleWearableProviderSync: (provider: 'oura' | 'garmin') => Promise<void>;
  detailsTab: 'overview' | 'metrics' | 'export' | 'settings';
  setDetailsTab: (tab: 'overview' | 'metrics' | 'export' | 'settings') => void;
  handleAppleWatchConnect: () => void;
  handleAppleWatchDisconnect: () => Promise<void>;
  appleWatchStatusData: {
    connected?: boolean;
    devices?: Array<{ device_id: string; is_active?: boolean }>;
    lastSyncAt?: string | null;
    deviceName?: string | null;
  } | undefined;
  appleHealthConnection: Record<string, unknown> | undefined;
  whoopConnection: Record<string, unknown> | undefined;
  whoopStatusData: Record<string, unknown> | undefined;
  teslaConnection: Record<string, unknown> | undefined;
  plaidConnection: Record<string, unknown> | undefined;
  plaidMfaRequired: boolean;
  userHasMfaEnabled: boolean;
};

export type IntegrationRuntimeContext = IntegrationOrchestratorDeps &
  Record<string, unknown> & {
    selectedIntegration: string | null;
    computerTrackingConnected: boolean;
    appleWatchConnected: boolean;
    appleWatchLastSync?: string | null;
    effectiveWhoopConnected: boolean;
    effectiveTeslaConnected: boolean;
    plaidConnected: boolean;
    plaidNeedsReconnect: boolean;
    plaidReconnectReason: string;
    wearableConnectingProvider: string | null;
    wearableSyncingProvider: string | null;
    ouraConnection: Record<string, unknown> | undefined;
    garminConnection: Record<string, unknown> | undefined;
  };

export type IntegrationCardRuntimeContext = Record<string, unknown> & {
  appleWatchConnected: boolean;
  computerTrackingConnected: boolean;
  effectiveTeslaConnected: boolean;
  effectiveWhoopConnected: boolean;
  garminConnection: Record<string, unknown> | undefined;
  handleAppleWatchConnect: () => void;
  handleAppleWatchDisconnect: () => Promise<void>;
  handleIphoneTimeConnect: unknown;
  handleIphoneTimeSync: unknown;
  handlePlaidConnect: unknown;
  handlePlaidDisconnect: unknown;
  handlePlaidReconnect: unknown;
  handlePlaidSync: unknown;
  handleTeslaConnect: unknown;
  handleTeslaDisconnect: unknown;
  handleTeslaSync: unknown;
  handleWearableProviderConnect: (provider: 'oura' | 'garmin') => void;
  handleWearableProviderDisconnect: (provider: 'oura' | 'garmin') => void;
  handleWearableProviderSync: (provider: 'oura' | 'garmin') => void;
  handleWhoopConnect: unknown;
  handleWhoopDisconnect: unknown;
  handleWhoopSync: unknown;
  isDesktop: boolean;
  iphoneTimeConnecting: unknown;
  iphoneTimeIntegration: unknown;
  iphoneTimeStatusLoading: unknown;
  iphoneTimeSyncing: unknown;
  openIntegrationDetails: (integration: string) => void;
  ouraConnection: Record<string, unknown> | undefined;
  plaidConnected: boolean;
  plaidConnecting: unknown;
  plaidNeedsReconnect: boolean;
  plaidSyncing: unknown;
  router: { replace: (path: string) => void };
  syncing: unknown;
  teslaConnecting: unknown;
  teslaSyncing: unknown;
  wearableConnectingProvider: string | null;
  wearableSyncingProvider: string | null;
  whoopConnecting: unknown;
  whoopSyncFeedback: unknown;
};
