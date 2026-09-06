import type { ReactNode } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { IphoneTimeIntegrationStatus, WhoopSyncFeedback, WhoopSyncMode } from '../integrations-client.shared';

export type IntegrationCardItem = {
  id: string;
  title: string;
  description: string;
  keywords?: string[];
  isConnected: boolean;
  comingSoon?: boolean;
  node: ReactNode;
};

export type IntegrationRouter = {
  replace: (path: string) => void;
};

export type IntegrationDetailsTab = 'overview' | 'metrics' | 'export' | 'settings';
export type WearableSyncProvider = 'whoop' | 'apple_health' | 'oura' | 'garmin';
export type LegacyWearableProvider = 'oura' | 'garmin';

export type IntegrationLastError = {
  display_message?: string;
  error_message?: string;
  message?: string;
};

export type WearableConnection = {
  auto_sync_enabled?: boolean | null;
  auto_sync_note?: string | null;
  id?: string;
  last_successful_sync_at?: string | null;
  last_sync_at?: string | null;
  provider?: string;
  sleep_status_message?: string | null;
  stale_message?: string | null;
  status?: string;
  sync_hour?: number | null;
};

export type AppleWatchStatusData = {
  connected?: boolean;
  devices?: Array<{ device_id: string; is_active?: boolean }>;
  deviceName?: string | null;
  lastSyncAt?: string | null;
};

export type WhoopStatusData = WearableConnection & {
  connected?: boolean;
};

export type TeslaConnection = {
  id?: string;
  last_sync_at?: string | null;
  status?: string;
};

export type PlaidAccount = {
  account_subtype?: string | null;
  account_type?: string | null;
  id: string;
  include_in_spending?: boolean;
  is_active?: boolean;
  mask?: string | null;
  name?: string | null;
};

export type PlaidConnection = {
  account_count?: number | null;
  accounts?: PlaidAccount[];
  id?: string;
  auto_sync_enabled?: boolean | null;
  institution_name?: string | null;
  last_error_json?: IntegrationLastError | null;
  last_successful_sync_at?: string | null;
  last_sync_at?: string | null;
  latest_transaction_date?: string | null;
  provider?: string;
  requires_reconnect?: boolean;
  status?: string;
  sync_hour?: number | null;
};

export type IntegrationHookDeps = {
  callbackProcessedRef: MutableRefObject<boolean>;
  fetchHabitLogs: () => unknown;
  fetchHabits: () => unknown;
  getToken: () => Promise<string | null>;
  oauthSessionIdRef: MutableRefObject<string | null>;
  oauthSessionTokenRef: MutableRefObject<string | null>;
  pollingIntervalRef: MutableRefObject<NodeJS.Timeout | null>;
  queryClient: QueryClient;
  refetchOverview: () => unknown;
  router: IntegrationRouter;
  setIsProcessingCallback: (value: boolean) => void;
  userId?: string;
};

export type IntegrationOrchestratorDeps = IntegrationHookDeps & {
  iphoneTimeIntegrationQuery: ReturnType<typeof import('../integrations-client.shared').useIphoneTimeIntegrationStatus>;
  isDesktop: boolean;
  openIntegrationDetails: (integration: string) => void;
  openUserProfile: () => void;
};

export type AppleHealthExportFormat = 'markdown' | 'json' | 'csv';
export type AppleHealthExportWriteMode = 'overwrite' | 'append' | 'skip';
export type AppleHealthExportDatePreset = 'yesterday' | '7d' | '30d' | 'custom';

export type AppleHealthExportSchedule = {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  format: AppleHealthExportFormat;
  time: string;
  day_of_week: number | null;
  folder_path: string | null;
  include_all_metrics: boolean;
  metric_types: string[] | null;
};

export type AppleHealthExportResult = {
  type: 'success' | 'error';
  message: string;
};

export type AppleHealthExportHistoryEntry = {
  id: string;
  timestamp: string;
  start_date: string;
  end_date: string;
  format: string;
  status: 'success' | 'failed';
  sample_count: number;
  file_size_bytes: number | null;
  file_path: string | null;
  error: string | null;
  triggered_by: 'manual' | 'scheduled';
};

export type AppleHealthExportContext = {
  applyExportDatePreset: (preset: AppleHealthExportDatePreset) => void;
  exportDatePreset: AppleHealthExportDatePreset;
  exportEndDate: string;
  exportFormat: AppleHealthExportFormat;
  exportHistory: AppleHealthExportHistoryEntry[];
  exportLoading: boolean;
  exportResult: AppleHealthExportResult | null;
  exportSchedule: AppleHealthExportSchedule | null;
  exportStartDate: string;
  exportWriteMode: AppleHealthExportWriteMode;
  handleExportNow: () => void | Promise<void>;
  historyLoaded: boolean;
  loadExportHistory: () => void | Promise<void>;
  loadExportSchedule: () => void | Promise<void>;
  loadMetricCatalogAndPreferences: () => void | Promise<void>;
  metricCatalog: unknown[];
  metricsLoaded: boolean;
  saveExportSchedule: (schedule: AppleHealthExportSchedule | null) => void | Promise<void>;
  saveMetricPreferences: (selected: string[]) => void | Promise<void>;
  scheduleLoaded: boolean;
  scheduleSaving: boolean;
  selectedMetrics: Set<string>;
  setExportDatePreset: (preset: AppleHealthExportDatePreset) => void;
  setExportEndDate: (value: string) => void;
  setExportFormat: (format: AppleHealthExportFormat) => void;
  setExportHistory: Dispatch<SetStateAction<AppleHealthExportHistoryEntry[]>>;
  setExportSchedule: Dispatch<SetStateAction<AppleHealthExportSchedule | null>>;
  setExportStartDate: (value: string) => void;
  setExportWriteMode: (mode: AppleHealthExportWriteMode) => void;
  updateScheduleField: <K extends keyof AppleHealthExportSchedule>(
    field: K,
    value: AppleHealthExportSchedule[K],
  ) => void;
};

export type WhoopIntegrationContext = {
  handleWhoopCallback: (code: string) => void | Promise<void>;
  handleWhoopConnect: () => void | Promise<void>;
  handleWhoopDisconnect: () => void | Promise<void>;
  handleWhoopSync: (options?: { daysBack?: number; forceFullSync?: boolean; fullHistory?: boolean }) => void | Promise<void>;
  setWhoopCustomDaysBack: (value: string) => void;
  setWhoopSyncHour: (hour: number) => void;
  setWhoopSyncMode: (mode: WhoopSyncMode) => void;
  syncing: boolean;
  whoopConnecting: boolean;
  whoopConnected: boolean;
  whoopCustomDaysBack: string;
  whoopSyncFeedback: WhoopSyncFeedback | null;
  whoopSyncHour: number;
  whoopSyncMode: WhoopSyncMode;
};

export type PlaidIntegrationContext = {
  handlePlaidAccountInclusion: (id: string, included: boolean) => void | Promise<void>;
  handlePlaidBackfill: () => void | Promise<void>;
  handlePlaidConnect: () => void | Promise<void>;
  handlePlaidDisconnect: () => void | Promise<void>;
  handlePlaidMfaSetup: () => void;
  handlePlaidReconnect: () => void | Promise<void>;
  handlePlaidSync: () => void | Promise<void>;
  handlePlaidSyncSettingsUpdate: (updates: { auto_sync_enabled?: boolean; sync_hour?: number }) => void | Promise<void>;
  plaidAccountSavingId: string | null;
  plaidBackfilling: boolean;
  plaidConnecting: boolean;
  plaidSettingsSaving: boolean;
  plaidSyncing: boolean;
};

export type TeslaIntegrationContext = {
  effectiveTeslaConnected: boolean;
  handleTeslaBackfill: () => void | Promise<void>;
  handleTeslaCallback: (code: string) => void | Promise<void>;
  handleTeslaConnect: () => void | Promise<void>;
  handleTeslaDisconnect: () => void | Promise<void>;
  handleTeslaSync: () => void | Promise<void>;
  setTeslaBackfillDate: (value: string) => void;
  setTeslaBackfillOdometer: (value: string) => void;
  teslaBackfillDate: string;
  teslaBackfillOdometer: string;
  teslaBackfilling: boolean;
  teslaConnecting: boolean;
  teslaSyncing: boolean;
};

export type IphoneTimeIntegrationContext = {
  handleIphoneTimeConnect: () => void | Promise<void>;
  handleIphoneTimeImport: () => void | Promise<void>;
  handleIphoneTimeSync: () => void | Promise<void>;
  iphoneTimeConnecting: boolean;
  iphoneTimeImporting: boolean;
  iphoneTimeIntegration?: IphoneTimeIntegrationStatus;
  iphoneTimeStatusLoading: boolean;
  iphoneTimeSyncing: boolean;
};

export type ComputerTrackingIntegrationContext = {
  computerTrackingConnected: boolean;
  computerTrackingConnecting: boolean;
  computerTrackingRegistered: boolean;
  handleComputerTrackingConnect: () => void | Promise<void>;
  handleComputerTrackingDisconnect: () => void | Promise<void>;
};

export type WearableSyncSettingsContext = {
  handleWearableSyncSettingsUpdate: (
    provider: WearableSyncProvider,
    updates: { auto_sync_enabled?: boolean; sync_hour?: number },
  ) => Promise<void>;
  whoopSyncHour?: number;
};

export type LegacyWearableContext = {
  handleAppleWatchConnect: () => void;
  handleAppleWatchDisconnect: () => Promise<void>;
  handleWearableProviderConnect: (provider: LegacyWearableProvider) => void;
  handleWearableProviderDisconnect: (provider: LegacyWearableProvider) => void;
  handleWearableProviderSync: (provider: LegacyWearableProvider) => void | Promise<void>;
  wearableConnectingProvider: string | null;
  wearableSyncingProvider: string | null;
};

export type IntegrationCardRuntimeContext =
  Pick<IntegrationRuntimeContext,
    | 'appleWatchConnected'
    | 'computerTrackingConnected'
    | 'computerTrackingConnecting'
    | 'computerTrackingRegistered'
    | 'effectiveTeslaConnected'
    | 'effectiveWhoopConnected'
    | 'garminConnection'
    | 'isDesktop'
    | 'iphoneTimeConnecting'
    | 'iphoneTimeIntegration'
    | 'iphoneTimeStatusLoading'
    | 'iphoneTimeSyncing'
    | 'ouraConnection'
    | 'plaidConnected'
    | 'plaidConnecting'
    | 'plaidNeedsReconnect'
    | 'plaidSyncing'
    | 'router'
    | 'syncing'
    | 'teslaConnecting'
    | 'teslaSyncing'
    | 'whoopConnecting'
    | 'whoopSyncFeedback'
  > &
    Pick<
      LegacyWearableContext,
      | 'handleAppleWatchConnect'
      | 'handleAppleWatchDisconnect'
      | 'handleWearableProviderConnect'
      | 'handleWearableProviderDisconnect'
      | 'handleWearableProviderSync'
      | 'wearableConnectingProvider'
      | 'wearableSyncingProvider'
    > &
    Pick<
      IntegrationRuntimeContext,
      | 'handleComputerTrackingConnect'
      | 'handleComputerTrackingDisconnect'
      | 'handleIphoneTimeConnect'
      | 'handleIphoneTimeSync'
      | 'handlePlaidConnect'
      | 'handlePlaidDisconnect'
      | 'handlePlaidReconnect'
      | 'handlePlaidSync'
      | 'handleTeslaConnect'
      | 'handleTeslaDisconnect'
      | 'handleTeslaSync'
      | 'handleWhoopConnect'
      | 'handleWhoopDisconnect'
      | 'handleWhoopSync'
      | 'openIntegrationDetails'
    >;

export type IntegrationRuntimeContext = {
  appleHealthConnection?: WearableConnection;
  appleWatchConnected: boolean;
  appleWatchLastSync?: string | null;
  appleWatchStatusData?: AppleWatchStatusData;
  detailsTab: IntegrationDetailsTab;
  effectiveWhoopConnected: boolean;
  effectiveTeslaConnected: boolean;
  garminConnection?: WearableConnection;
  getToken: () => Promise<string | null>;
  isDesktop: boolean;
  openIntegrationDetails: (integration: string) => void;
  ouraConnection?: WearableConnection;
  plaidConnected: boolean;
  plaidConnection?: PlaidConnection;
  plaidNeedsReconnect: boolean;
  plaidReconnectReason: string;
  router: IntegrationRouter;
  selectedIntegration: string | null;
  setDetailsTab: (tab: IntegrationDetailsTab) => void;
  teslaConnection?: TeslaConnection;
  whoopConnection?: WearableConnection;
  whoopStatusData?: WhoopStatusData;
} & AppleHealthExportContext &
  WhoopIntegrationContext &
  PlaidIntegrationContext &
  TeslaIntegrationContext &
  IphoneTimeIntegrationContext &
  ComputerTrackingIntegrationContext &
  LegacyWearableContext &
  WearableSyncSettingsContext;

export type IntegrationPlugin<
  CardContext extends IntegrationCardRuntimeContext = IntegrationCardRuntimeContext,
  DetailContext extends IntegrationRuntimeContext = IntegrationRuntimeContext,
> = {
  id: string;
  detailKey: string;
  title: string;
  keywords?: string[];
  buildCard: (ctx: CardContext) => IntegrationCardItem | null;
  DetailPanel: (props: { ctx: DetailContext }) => ReactNode;
  PanelAction?: (props: { ctx: DetailContext }) => ReactNode;
};
