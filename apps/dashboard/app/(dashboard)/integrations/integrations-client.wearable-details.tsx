'use client';

import { Button } from '@/components/ui/button';
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
import {
  INTEGRATIONS_GREEN_SWITCH_CLASS,
  MAX_CUSTOM_WHOOP_DAYS,
  WHOOP_SYNC_PRESETS,
  formatHour,
  formatRelativeTime,
} from './integrations-client.shared';

export function renderIntegrationAutoSyncDetails(
  ctx: Record<string, any>,
  provider: 'whoop' | 'apple_health' | 'oura' | 'garmin',
  connection: any,
  fallbackLastSync?: string | null,
  staleMessage?: string | null,
) {
  const { handleWearableSyncSettingsUpdate, whoopSyncHour } = ctx;
  const autoSyncEnabled = connection?.auto_sync_enabled ?? (provider !== 'apple_health');
  const syncHour = connection?.sync_hour ?? (provider === 'whoop' ? whoopSyncHour : 9);
  const lastSyncValue = fallbackLastSync || connection?.last_sync_at || connection?.last_successful_sync_at || null;
  const note = connection?.auto_sync_note;
  const providerLabel = provider === 'apple_health'
    ? 'Apple Watch'
    : provider === 'whoop'
      ? 'Whoop'
      : provider === 'oura'
        ? 'Oura'
        : 'Garmin';

  return (
    <div className="rounded-sm border border-border bg-background">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Auto sync</p>
          <p className="mt-1 text-sm text-foreground">Keep {providerLabel} updated automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={autoSyncEnabled}
            className={INTEGRATIONS_GREEN_SWITCH_CLASS}
            onCheckedChange={(checked) =>
              handleWearableSyncSettingsUpdate(provider, {
                auto_sync_enabled: checked,
                sync_hour: syncHour,
              })
            }
          />
          <span className="text-sm text-foreground">{autoSyncEnabled ? 'On' : 'Off'}</span>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 px-4 py-4">
        <div>
          <p className="text-sm text-foreground">Preferred sync time</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the hour for background refreshes.</p>
        </div>
        <Select
          value={String(syncHour)}
          onValueChange={(value) =>
            handleWearableSyncSettingsUpdate(provider, {
              auto_sync_enabled: autoSyncEnabled,
              sync_hour: Number(value),
            })
          }
          disabled={!autoSyncEnabled}
        >
          <SelectTrigger className="h-9 w-[136px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 24 }, (_, hour) => (
              <SelectItem key={hour} value={String(hour)}>
                {formatHour(hour)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Last sync</span>
        <span className="text-sm text-foreground">{formatRelativeTime(lastSyncValue)}</span>
      </div>
      {note ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs leading-5 text-muted-foreground">{note}</p>
        </div>
      ) : null}
      {staleMessage ? (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs leading-5 text-muted-foreground">{staleMessage}</p>
        </div>
      ) : null}
    </div>
  );
}

export function renderWhoopSyncDetailsPanel(ctx: Record<string, any>) {
  const {
    handleWearableSyncSettingsUpdate,
    handleWhoopSync,
    setWhoopCustomDaysBack,
    setWhoopSyncMode,
    syncing,
    whoopConnection,
    whoopCustomDaysBack,
    whoopStatusData,
    whoopSyncFeedback,
    whoopSyncHour,
    whoopSyncMode,
  } = ctx;
  const autoSyncEnabled = whoopConnection?.auto_sync_enabled ?? true;
  const syncHour = whoopConnection?.sync_hour ?? whoopSyncHour ?? 9;
  const lastSyncValue = whoopStatusData?.last_sync_at || whoopConnection?.last_sync_at || whoopConnection?.last_successful_sync_at || null;
  const note = whoopConnection?.auto_sync_note;
  const staleMessage = whoopStatusData?.stale_message || whoopConnection?.stale_message || null;
  const sleepStatusMessage = whoopStatusData?.sleep_status_message || null;
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
              className={INTEGRATIONS_GREEN_SWITCH_CLASS}
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
        {sleepStatusMessage ? <p className="mt-2 text-xs leading-5 text-[#69665c]">{sleepStatusMessage}</p> : null}
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
        {whoopSyncFeedback ? (
          <p
            className={cn(
              'mt-3 text-sm leading-5',
              whoopSyncFeedback.type === 'error'
                ? 'text-[#9a3412]'
                : whoopSyncFeedback.type === 'success'
                  ? 'text-[#3f6f13]'
                  : 'text-[#69665c]'
            )}
          >
            {whoopSyncFeedback.message}
          </p>
        ) : null}

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
}
