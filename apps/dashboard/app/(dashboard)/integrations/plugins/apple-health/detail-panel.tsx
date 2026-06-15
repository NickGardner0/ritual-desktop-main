'use client';

import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { MetricSelectionTree } from '@/components/metric-selection-tree';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { cn } from '@/lib/utils';
import { INTEGRATIONS_GREEN_SWITCH_CLASS, formatRelativeTime } from '../../integrations-client.shared';
import { renderIntegrationAutoSyncDetails } from '../../integrations-client.wearable-details';
import { renderIntegrationLogo } from '../shared/panel-chrome';
import type { IntegrationRuntimeContext } from '../types';

type AppleHealthExportSchedule = {
  day_of_week?: number | null;
  enabled?: boolean | null;
  format?: string | null;
  frequency?: string | null;
  time?: string | null;
};

export function DetailPanel({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const {
    appleHealthConnection,
    appleWatchConnected,
    appleWatchLastSync,
    appleWatchStatusData,
    applyExportDatePreset,
    detailsTab,
    exportDatePreset,
    exportEndDate,
    exportFormat,
    exportHistory,
    exportLoading,
    exportResult,
    exportSchedule,
    exportStartDate,
    exportWriteMode,
    getToken,
    handleAppleWatchDisconnect,
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
    setDetailsTab,
    setExportDatePreset,
    setExportEndDate,
    setExportFormat,
    setExportHistory,
    setExportSchedule,
    setExportStartDate,
    setExportWriteMode,
    updateScheduleField,
  } = ctx;

  if (appleWatchConnected && !metricsLoaded) {
    (loadMetricCatalogAndPreferences as () => void)();
  }
  if (appleWatchConnected && !scheduleLoaded) {
    (loadExportSchedule as () => void)();
  }
  if (appleWatchConnected && !historyLoaded) {
    (loadExportHistory as () => void)();
  }

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    ...(appleWatchConnected
      ? [
          { key: 'metrics' as const, label: 'Metrics' },
          { key: 'export' as const, label: 'Export' },
          { key: 'settings' as const, label: 'Settings' },
        ]
      : []),
  ];

  const statusData = appleWatchStatusData as { deviceName?: string | null } | undefined;
  const history = (exportHistory as unknown[]) || [];
  const schedule = exportSchedule as AppleHealthExportSchedule | null;

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
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => (setDetailsTab as (tab: string) => void)(tab.key)}
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
                          <span className="text-sm text-foreground">{formatRelativeTime(appleWatchLastSync as string | null | undefined)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3">
                          <span className="text-sm text-muted-foreground">Tracked metrics</span>
                          <span className="text-sm text-foreground">{(selectedMetrics as Set<string>).size} selected</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3">
                          <span className="text-sm text-muted-foreground">Device</span>
                          <span className="text-sm text-foreground">{statusData?.deviceName || 'iPhone'}</span>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-sm border border-border bg-background">
                      <button
                        onClick={() => (setDetailsTab as (tab: string) => void)('metrics')}
                        className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">Metrics</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">Choose what to track</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => (setDetailsTab as (tab: string) => void)('export')}
                        className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">Export</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">Download your data</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => (setDetailsTab as (tab: string) => void)('settings')}
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
                  {(metricCatalog as any[]).length > 0 ? (
                    <MetricSelectionTree
                      categories={metricCatalog as any[]}
                      selected={selectedMetrics as Set<string>}
                      onSave={async (selected: string[]) => {
                        await (saveMetricPreferences as (metrics: Set<string>) => void)(new Set(selected));
                      }}
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
                            onClick={() => (applyExportDatePreset as (preset: string) => void)(key)}
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
                          <Input type="date" value={exportStartDate as string} onChange={(e) => (setExportStartDate as (v: string) => void)(e.target.value)} className="h-8 w-36 text-sm" />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input type="date" value={exportEndDate as string} onChange={(e) => (setExportEndDate as (v: string) => void)(e.target.value)} className="h-8 w-36 text-sm" />
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{exportStartDate as string} &mdash; {exportEndDate as string}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Format</label>
                      <div className="flex gap-2">
                        {([['markdown', 'Markdown'], ['json', 'JSON'], ['csv', 'CSV']] as const).map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => (setExportFormat as (v: string) => void)(key)}
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

                    {ctx.isDesktop && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Write mode</label>
                        <div className="flex flex-wrap gap-2">
                          {([['overwrite', 'Overwrite'], ['append', 'Append'], ['skip', 'Skip existing']] as const).map(([key, label]) => (
                            <button
                              key={key}
                              onClick={() => (setExportWriteMode as (v: string) => void)(key)}
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

                    <Button onClick={handleExportNow as () => void} disabled={Boolean(exportLoading)} className="w-full">
                      {exportLoading ? (
                        <span className="flex items-center gap-2"><BrailleSpinner /> Exporting…</span>
                      ) : 'Export Now'}
                    </Button>

                    {exportResult ? (
                      <p className={`text-xs ${(exportResult as { type: string }).type === 'success' ? 'text-green-600' : 'text-red-500'}`}>{(exportResult as { message: string }).message}</p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-sm border border-border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Scheduled export</p>
                    <Switch
                      checked={Boolean(schedule?.enabled)}
                      className={INTEGRATIONS_GREEN_SWITCH_CLASS}
                      onCheckedChange={(checked) => {
                        if (!scheduleLoaded) (loadExportSchedule as () => void)();
                        const updated = {
                          ...(schedule || { enabled: false, frequency: 'daily' as const, format: 'markdown' as const, time: '08:00', day_of_week: null, folder_path: null, include_all_metrics: true, metric_types: null }),
                          enabled: checked,
                        };
                        (setExportSchedule as (v: unknown) => void)(updated);
                        (saveExportSchedule as (v: unknown) => void)(updated);
                      }}
                    />
                  </div>

                  {schedule?.enabled ? (
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Frequency</label>
                        <div className="flex gap-2">
                          {(['daily', 'weekly'] as const).map((freq) => (
                            <button key={freq} onClick={() => (updateScheduleField as (field: string, value: unknown) => void)('frequency', freq)} className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${schedule.frequency === freq ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted/30'}`}>
                              {freq.charAt(0).toUpperCase() + freq.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {schedule.frequency === 'weekly' && (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Day</label>
                          <div className="flex flex-wrap gap-1">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                              <button key={day} onClick={() => (updateScheduleField as (field: string, value: unknown) => void)('day_of_week', i)} className={`rounded-sm border px-2 py-1 text-xs font-medium transition-colors ${schedule.day_of_week === i ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted/30'}`}>
                                {day}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Time</label>
                        <Input type="time" value={schedule.time || '08:00'} onChange={(e) => (updateScheduleField as (field: string, value: unknown) => void)('time', e.target.value)} className="h-8 w-32 text-sm" />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Format</label>
                        <div className="flex gap-2">
                          {(['markdown', 'json', 'csv'] as const).map((fmt) => (
                            <button key={fmt} onClick={() => (updateScheduleField as (field: string, value: unknown) => void)('format', fmt)} className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${schedule.format === fmt ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted/30'}`}>
                              {fmt === 'markdown' ? 'Markdown' : fmt.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <Button onClick={() => (saveExportSchedule as (v: unknown) => void)(schedule)} disabled={Boolean(scheduleSaving)} variant="outline" className="w-full text-sm">
                        {scheduleSaving ? (<span className="flex items-center gap-2"><BrailleSpinner /> Saving…</span>) : 'Save schedule'}
                      </Button>

                      <p className="text-xs text-muted-foreground">
                        {schedule.frequency === 'daily'
                          ? `Exports daily at ${schedule.time || '08:00'}`
                          : `Exports every ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][schedule.day_of_week ?? 0]} at ${schedule.time || '08:00'}`}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Turn this on to automatically export Apple Watch data on a schedule.</p>
                  )}
                </div>

                <div className="rounded-sm border border-border bg-background p-4">
                  <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">History</p>
                  <div className="space-y-2">
                    {history.length === 0 ? (
                      <p className="py-3 text-center text-sm text-muted-foreground">No exports yet</p>
                    ) : (
                      history.slice(0, 20).map((entry: any) => (
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
                              onClick={() => {
                                (setExportStartDate as (v: string) => void)(entry.start_date);
                                (setExportEndDate as (v: string) => void)(entry.end_date);
                                (setExportFormat as (v: string) => void)(entry.format);
                                (setExportDatePreset as (v: string) => void)('custom');
                              }}
                              className="ml-2 shrink-0 rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      ))
                    )}
                    {history.length > 0 && (
                      <button
                        onClick={() => {
                          (setExportHistory as (v: unknown[]) => void)([]);
                          getToken().then((token: string | null) => { if (!token) return; });
                        }}
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
                  {renderIntegrationAutoSyncDetails(ctx, 'apple_health', appleHealthConnection, appleWatchLastSync as string | null | undefined, null)}
                </div>

                <div className="rounded-sm border border-border bg-background p-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Danger zone</p>
                  <p className="mb-3 text-sm text-muted-foreground">Disconnect this integration. Your synced data will remain in Ritual.</p>
                  <button
                    onClick={handleAppleWatchDisconnect as () => void}
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
