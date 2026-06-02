'use client';

import Image from 'next/image';
import { ChevronRight, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MetricSelectionTree } from '@/components/metric-selection-tree';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { isTauri } from '@/lib/tauri-utils';
import { cn } from '@/lib/utils';
import {
  INTEGRATIONS_GREEN_SWITCH_CLASS,
  IPHONE_TIME_ICLOUD_WARNING,
  formatHour,
  formatRelativeTime,
} from './integrations-client.shared';
import {
  renderIntegrationAutoSyncDetails,
  renderWhoopSyncDetailsPanel,
} from './integrations-client.wearable-details';

export type IntegrationDetailRendererContext = Record<string, any>;

export function createIntegrationDetailRenderers(ctx: IntegrationDetailRendererContext) {
  const {
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
    iphoneTimeStatusLoading,
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
    setExportSchedule,
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
  } = ctx;

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
        return <Image src="/images/oura.svg" alt="Oura" width={40} height={40} className={size === 'panel' ? 'h-14 w-auto object-contain -m-2' : 'h-16 w-auto object-contain -m-3'} />;
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
      case 'imessage':
        return <Image src="/images/imessage.svg" alt="iMessage" width={36} height={36} className={size === 'panel' ? 'h-8 w-8 rounded-[8px]' : 'h-8 w-8 rounded-[8px]'} />;
      case 'raycast':
        return <Image src="/images/raycast.png" alt="Raycast" width={36} height={36} className={size === 'panel' ? 'h-9 w-9 rounded-lg object-contain' : 'h-9 w-9 rounded-lg object-contain'} />;
      case 'obsidian':
        return <Image src="/images/obsidian.svg" alt="Obsidian" width={24} height={24} className={size === 'panel' ? 'h-8 w-8' : 'h-7 w-7'} />;
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

    if (selectedIntegration === 'screentime') {
      const hasSyncableState =
        iphoneTimeIntegration?.isConnected ||
        iphoneTimeIntegration?.status === 'queued' ||
        iphoneTimeIntegration?.status === 'source_ready';

      if (hasSyncableState) {
        return (
          <button
            onClick={handleIphoneTimeSync}
            disabled={iphoneTimeSyncing}
            className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
          >
            {iphoneTimeSyncing ? 'Syncing...' : 'Sync now'}
          </button>
        );
      }

      return (
        <button
          onClick={handleIphoneTimeConnect}
          disabled={iphoneTimeConnecting || iphoneTimeStatusLoading}
          className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
        >
          {iphoneTimeConnecting || iphoneTimeStatusLoading ? 'Checking...' : 'Connect'}
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
    if (selectedIntegration === 'screentime') {
      const status = iphoneTimeIntegration;
      const statRows = [
        ['Current status', status?.statusLabel || (iphoneTimeStatusLoading ? 'Checking...' : 'Unknown')],
        ['Last imported date', status?.lastImportedDate || 'None yet'],
        ['Total imported events', Number(status?.totalImportedEvents || 0).toLocaleString()],
        ['Outbox count', Number(status?.outboxCount || 0).toLocaleString()],
        ['Local Biome files', Number(status?.localSourceFileCount || 0).toLocaleString()],
        ['Last drain', status?.lastDrainLabel || 'Never'],
      ];
      const hasSourceFiles = Number(status?.localSourceFileCount || 0) > 0;
      const helperCommand = '/Users/Shared/ritual-watcher-biome-diagnostic --biome-export-jsonl /Users/Shared/ritual-biome-iphone-export.jsonl';

      return (
        <div className="flex h-full flex-col bg-white">
          {renderPanelHeader('screentime', 'Apple Screen Time', 'iPhone Time • Apple Biome')}
          <div className="min-h-0 flex-1 px-5">
            <ScrollArea className="h-full">
              <div className="space-y-6 pb-6 pt-4">
                <div className="rounded-sm border border-[#e7e5dd] bg-[#fbfaf7] p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {statRows.map(([label, value]) => (
                      <div key={label} className="rounded-sm border border-[#e7e5dd] bg-white px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a877d]">{label}</p>
                        <p className="mt-1 text-sm font-medium text-[#1f1e1a]">{value}</p>
                      </div>
                    ))}
                  </div>
                  {status?.lastError ? (
                    <p className="mt-3 rounded-sm border border-[#f4c7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#9a3412]">
                      {status.lastError}
                    </p>
                  ) : null}
                </div>

                {status?.warning || (!hasSourceFiles && !status?.isConnected) ? (
                  <div className="rounded-sm border border-[#f1d2aa] bg-[#fff8ed] p-4 text-sm leading-6 text-[#6b4a1f]">
                    {status?.warning || IPHONE_TIME_ICLOUD_WARNING}
                  </div>
                ) : null}

                <Accordion type="multiple" defaultValue={['setup', 'bridge']} className="border-t border-[#e7e5dd]">
                  <AccordionItem value="setup" className="border-[#e7e5dd]">
                    <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Setup</AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm leading-6 text-[#69665c]">
                      <p>
                        Ritual reads Apple Biome App.InFocus data that macOS syncs locally when this Mac user is signed into the same iCloud account as the iPhone.
                      </p>
                      <p>
                        Keep Computer Use running. When Biome source files appear, Ritual parses iPhone foreground app intervals, queues them locally, and syncs them to the backend as the `iPhone Time` habit.
                      </p>
                      {hasSourceFiles && !status?.isConnected && Number(status?.outboxCount || 0) === 0 ? (
                        <p className="rounded-sm border border-[#e7e5dd] bg-white px-3 py-2 text-xs text-[#8a877d]">
                          Source files exist. If no events are queued yet, wait for the watcher scan or restart Computer Use.
                        </p>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="bridge" className="border-[#e7e5dd]">
                    <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Using a different iCloud account?</AccordionTrigger>
                    <AccordionContent className="space-y-4 text-sm leading-6 text-[#69665c]">
                      <p>
                        If your iPhone syncs Biome data into another macOS user account, export from that account and import the file here. Ritual validates rows, dedupes by stable event key, and never deletes the source export.
                      </p>
                      <div className="rounded-sm border border-[#e7e5dd] bg-[#111111] p-3 font-mono text-xs leading-5 text-white">
                        {helperCommand}
                      </div>
                      <button
                        type="button"
                        onClick={handleIphoneTimeImport}
                        disabled={iphoneTimeImporting || iphoneTimeSyncing}
                        className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {iphoneTimeImporting ? 'Importing...' : 'Import Export File'}
                      </button>
                    </AccordionContent>
                  </AccordionItem>

                  {status?.notes?.length ? (
                    <AccordionItem value="diagnostics" className="border-[#e7e5dd]">
                      <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Diagnostics</AccordionTrigger>
                      <AccordionContent>
                        <ul className="space-y-2 text-sm leading-6 text-[#69665c]">
                          {status.notes.map((note: string, index: number) => (
                            <li key={`${index}-${note}`}>{note}</li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ) : null}
                </Accordion>
              </div>
            </ScrollArea>
          </div>
        </div>
      );
    }

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
      // Load data when panel opens
      if (appleWatchConnected && !metricsLoaded) {
        loadMetricCatalogAndPreferences();
      }
      if (appleWatchConnected && !scheduleLoaded) {
        loadExportSchedule();
      }
      if (appleWatchConnected && !historyLoaded) {
        loadExportHistory();
      }

      const tabs = [
        { key: 'overview' as const, label: 'Overview' },
        ...(appleWatchConnected ? [
          { key: 'metrics' as const, label: 'Metrics' },
          { key: 'export' as const, label: 'Export' },
          { key: 'settings' as const, label: 'Settings' },
        ] : []),
      ];

      return (
        <div className="flex h-full flex-col bg-background">
          <div className="border-b border-border px-5 pb-4 pt-5">
            <div className="overflow-hidden rounded-sm border border-border bg-muted/20">
              <div
                className="relative flex h-28 items-center justify-center"
                style={{
                  backgroundImage: 'radial-gradient(circle, rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
                  backgroundSize: '10px 10px',
                }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-sm border border-border bg-[#111] text-white shadow-sm">
                  {renderIntegrationLogo('applewatch', 'panel')}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-start justify-between gap-4 border-b border-border pb-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold leading-tight text-foreground">Apple Watch</h3>
                <p className="mt-1 text-xs text-muted-foreground">Health data • Via Ritual Companion</p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium',
                  appleWatchConnected
                    ? 'border-border bg-muted/40 text-foreground'
                    : 'border-border bg-background text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    appleWatchConnected ? 'bg-foreground' : 'bg-muted-foreground/60',
                  )}
                />
                {appleWatchConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>

            <div className="mt-3 inline-flex items-center rounded-sm border border-border bg-muted/20 p-1">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setDetailsTab(tab.key)}
                  className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-all ${
                    detailsTab === tab.key
                      ? 'border border-border bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="px-5 py-5">
                {detailsTab === 'overview' && (
                  <div className="space-y-5">
                    <section className="rounded-sm border border-border bg-background p-4">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">How it works</p>
                      <div className="mt-4 space-y-4 text-sm text-muted-foreground">
                        <div>
                          <p className="font-medium text-foreground">Companion sync</p>
                          <p className="mt-1 leading-relaxed">
                            Sync health data from your iPhone companion app, including workouts, steps, heart rate, sleep, body measurements, nutrition, vitals, and mobility metrics.
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Selected metrics only</p>
                          <p className="mt-1 leading-relaxed">
                            Choose exactly which Apple Health metrics should create or update habits inside Ritual.
                          </p>
                        </div>
                      </div>
                    </section>

                    {appleWatchConnected && (
                      <>
                        <section className="rounded-sm border border-border bg-background">
                          <div className="border-b border-border px-4 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Sync status</p>
                          </div>
                          <div className="divide-y divide-border">
                            <div className="flex items-center justify-between px-4 py-3">
                              <span className="text-sm text-muted-foreground">Last sync</span>
                              <span className="text-sm text-foreground">{formatRelativeTime(appleWatchLastSync)}</span>
                            </div>
                            <div className="flex items-center justify-between px-4 py-3">
                              <span className="text-sm text-muted-foreground">Tracked metrics</span>
                              <span className="text-sm text-foreground">{selectedMetrics.size} selected</span>
                            </div>
                            <div className="flex items-center justify-between px-4 py-3">
                              <span className="text-sm text-muted-foreground">Device</span>
                              <span className="text-sm text-foreground">{appleWatchStatusData?.deviceName || 'iPhone'}</span>
                            </div>
                          </div>
                        </section>

                        <section className="rounded-sm border border-border bg-background">
                          <button
                            onClick={() => setDetailsTab('metrics')}
                            className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30"
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">Metrics</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">Choose what to track</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => setDetailsTab('export')}
                            className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30"
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">Export</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">Download your data</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => setDetailsTab('settings')}
                            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/30"
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">Settings</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">Control sync behavior</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </section>
                      </>
                    )}

                    {!appleWatchConnected && (
                      <div className="rounded-sm border border-dashed border-border bg-muted/20 p-5 text-center">
                        <p className="text-sm font-medium text-foreground">Not connected</p>
                        <p className="mt-1 text-xs text-muted-foreground">Open the Ritual Companion app on your iPhone to connect.</p>
                      </div>
                    )}
                  </div>
                )}

                {detailsTab === 'metrics' && appleWatchConnected && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Metrics</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        Select which health metrics to sync from your Apple Watch and iPhone.
                      </p>
                    </div>
                    <div className="rounded-sm border border-border bg-background p-4">
                      {metricCatalog.length > 0 ? (
                        <MetricSelectionTree
                          categories={metricCatalog}
                          selected={selectedMetrics}
                          onSave={saveMetricPreferences}
                        />
                      ) : (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                          <BrailleSpinner /> Loading metrics…
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {detailsTab === 'export' && appleWatchConnected && (
                  <div className="space-y-6">
                    <div className="rounded-sm border border-border bg-background p-4">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Export data</p>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Date range</label>
                          <div className="mb-2 flex flex-wrap gap-2">
                            {([['yesterday', 'Yesterday'], ['7d', '7 Days'], ['30d', '30 Days'], ['custom', 'Custom']] as const).map(([key, label]) => (
                              <button
                                key={key}
                                onClick={() => applyExportDatePreset(key)}
                                className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${
                                  exportDatePreset === key
                                    ? 'border-foreground bg-foreground text-background'
                                    : 'border-border bg-background text-muted-foreground hover:bg-muted/30'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          {exportDatePreset === 'custom' ? (
                            <div className="flex items-center gap-2">
                              <Input type="date" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} className="h-8 w-36 text-sm" />
                              <span className="text-xs text-muted-foreground">to</span>
                              <Input type="date" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} className="h-8 w-36 text-sm" />
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">{exportStartDate} &mdash; {exportEndDate}</p>
                          )}
                        </div>

                        <div>
                          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Format</label>
                          <div className="flex gap-2">
                            {([['markdown', 'Markdown'], ['json', 'JSON'], ['csv', 'CSV']] as const).map(([key, label]) => (
                              <button
                                key={key}
                                onClick={() => setExportFormat(key)}
                                className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${
                                  exportFormat === key
                                    ? 'border-foreground bg-foreground text-background'
                                    : 'border-border bg-background text-muted-foreground hover:bg-muted/30'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {isTauri() && (
                          <div>
                            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Write mode</label>
                            <div className="flex flex-wrap gap-2">
                              {([['overwrite', 'Overwrite'], ['append', 'Append'], ['skip', 'Skip existing']] as const).map(([key, label]) => (
                                <button
                                  key={key}
                                  onClick={() => setExportWriteMode(key)}
                                  className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${
                                    exportWriteMode === key
                                      ? 'border-foreground bg-foreground text-background'
                                      : 'border-border bg-background text-muted-foreground hover:bg-muted/30'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {exportWriteMode === 'overwrite' && 'Replace existing file'}
                              {exportWriteMode === 'append' && 'Add to end of existing file'}
                              {exportWriteMode === 'skip' && 'Skip if file already exists'}
                            </p>
                          </div>
                        )}

                        <Button onClick={handleExportNow} disabled={exportLoading} className="w-full">
                          {exportLoading ? (
                            <span className="flex items-center gap-2"><BrailleSpinner /> Exporting…</span>
                          ) : 'Export Now'}
                        </Button>

                        {exportResult ? (
                          <p className={`text-xs ${exportResult.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>{exportResult.message}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-sm border border-border bg-background p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Scheduled export</p>
                        <Switch
                          checked={Boolean(exportSchedule?.enabled)}
                          className={INTEGRATIONS_GREEN_SWITCH_CLASS}
                          onCheckedChange={(checked) => {
                            if (!scheduleLoaded) loadExportSchedule();
                            const updated = {
                              ...(exportSchedule || { enabled: false, frequency: 'daily' as const, format: 'markdown' as const, time: '08:00', day_of_week: null, folder_path: null, include_all_metrics: true, metric_types: null }),
                              enabled: checked,
                            };
                            setExportSchedule(updated);
                            saveExportSchedule(updated);
                          }}
                        />
                      </div>

                      {exportSchedule?.enabled ? (
                        <div className="space-y-3">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Frequency</label>
                            <div className="flex gap-2">
                              {(['daily', 'weekly'] as const).map(freq => (
                                <button key={freq} onClick={() => updateScheduleField('frequency', freq)} className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${exportSchedule.frequency === freq ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted/30'}`}>
                                  {freq.charAt(0).toUpperCase() + freq.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>

                          {exportSchedule.frequency === 'weekly' && (
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Day</label>
                              <div className="flex flex-wrap gap-1">
                                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                                  <button key={day} onClick={() => updateScheduleField('day_of_week', i)} className={`rounded-sm border px-2 py-1 text-xs font-medium transition-colors ${exportSchedule.day_of_week === i ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted/30'}`}>
                                    {day}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Time</label>
                            <Input type="time" value={exportSchedule.time || '08:00'} onChange={e => updateScheduleField('time', e.target.value)} className="h-8 w-32 text-sm" />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Format</label>
                            <div className="flex gap-2">
                              {(['markdown', 'json', 'csv'] as const).map(fmt => (
                                <button key={fmt} onClick={() => updateScheduleField('format', fmt)} className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${exportSchedule.format === fmt ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted/30'}`}>
                                  {fmt === 'markdown' ? 'Markdown' : fmt.toUpperCase()}
                                </button>
                              ))}
                            </div>
                          </div>

                          <Button onClick={() => saveExportSchedule(exportSchedule)} disabled={scheduleSaving} variant="outline" className="w-full text-sm">
                            {scheduleSaving ? (<span className="flex items-center gap-2"><BrailleSpinner /> Saving…</span>) : 'Save schedule'}
                          </Button>

                          <p className="text-xs text-muted-foreground">
                            {exportSchedule.frequency === 'daily'
                              ? `Exports daily at ${exportSchedule.time || '08:00'}`
                              : `Exports every ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][exportSchedule.day_of_week ?? 0]} at ${exportSchedule.time || '08:00'}`}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Turn this on to automatically export Apple Watch data on a schedule.</p>
                      )}
                    </div>

                    <div className="rounded-sm border border-border bg-background p-4">
                      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">History</p>
                      <div className="space-y-2">
                        {exportHistory.length === 0 ? (
                          <p className="py-3 text-center text-sm text-muted-foreground">No exports yet</p>
                        ) : (
                          exportHistory.slice(0, 20).map((entry: any) => (
                            <div key={entry.id} className="flex items-center justify-between rounded-sm border border-border px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-block h-2 w-2 rounded-full ${entry.status === 'success' ? 'bg-green-500' : 'bg-red-400'}`} />
                                  <span className="text-sm font-medium text-foreground">
                                    {entry.start_date === entry.end_date ? entry.start_date : `${entry.start_date} — ${entry.end_date}`}
                                  </span>
                                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{entry.format}</span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                                  <span>{new Date(entry.timestamp).toLocaleString()}</span>
                                  {entry.file_size_bytes != null && <span>{(entry.file_size_bytes / 1024).toFixed(1)} KB</span>}
                                  <span className="capitalize">{entry.triggered_by}</span>
                                </div>
                                {entry.error && <p className="mt-1 text-xs text-red-500">{entry.error}</p>}
                              </div>
                              {entry.status === 'failed' && (
                                <button
                                  onClick={() => { setExportStartDate(entry.start_date); setExportEndDate(entry.end_date); setExportFormat(entry.format as 'markdown' | 'json' | 'csv'); setExportDatePreset('custom'); }}
                                  className="ml-2 shrink-0 rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                                >
                                  Retry
                                </button>
                              )}
                            </div>
                          ))
                        )}
                        {exportHistory.length > 0 && (
                          <button
                            onClick={() => { setExportHistory([]); getToken().then((token: string | null) => { if (!token) return; }); }}
                            className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            Clear history
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {detailsTab === 'settings' && appleWatchConnected && (
                  <div className="space-y-5">
                    <div>
                      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Sync</p>
                      {renderAutoSyncDetails('apple_health', appleHealthConnection, appleWatchLastSync, null)}
                    </div>

                    <div className="rounded-sm border border-border bg-background p-4">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Danger zone</p>
                      <p className="mb-3 text-sm text-muted-foreground">Disconnect this integration. Your synced data will remain in Ritual.</p>
                      <button
                        onClick={handleAppleWatchDisconnect}
                        className="rounded-sm border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50/60"
                      >
                        Disconnect Apple Watch
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
      imessage: 'iMessage',
      raycast: 'Raycast',
      obsidian: 'Obsidian',
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

  const renderAutoSyncDetails = (
    provider: 'whoop' | 'apple_health' | 'oura' | 'garmin',
    connection: any,
    fallbackLastSync?: string | null,
    staleMessage?: string | null,
  ) => renderIntegrationAutoSyncDetails(ctx, provider, connection, fallbackLastSync, staleMessage);

  const renderWhoopSyncDetails = () => renderWhoopSyncDetailsPanel(ctx);

  return { renderIntegrationDetailsPanel };
}
