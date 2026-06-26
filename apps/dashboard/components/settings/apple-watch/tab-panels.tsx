'use client';

import React from 'react';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  getWearableMetricType,
  humanizeWearableMetric,
  type WearableMetricPreferences,
  type WearableMetricSyncMode,
} from '@/lib/wearables-dashboard';
import {
  buildProjectionPriorityOptions,
  formatHour,
  formatProjectionPrioritySummary,
  formatProjectionSource,
  formatRelativeTime,
  type AppleWatchTab,
  type ExportHistoryEntry,
  type ExportSchedule,
  type HabitProjectionPolicy,
  type HabitSummary,
  type MetricEntry,
} from '@/components/apple-watch-settings.helpers';
import { GreenToggle, InfoRow, SegmentButton, SETTINGS_MUTED_TEXT_CLASS } from './ui-components';

export type AppleWatchTabPanelsProps = {
  tab: AppleWatchTab;
  connected: boolean;
  lastSync: string | null | undefined;
  statusData: { deviceName?: string | null; devices?: unknown[] } | undefined;
  enabledMetricCount: number;
  flatMetrics: MetricEntry[];
  lastEnabledSyncModes: Record<string, Exclude<WearableMetricSyncMode, 'off'>>;
  metricSaveStatus: { type: 'success' | 'error'; message: string } | null;
  projectionHabits: HabitSummary[];
  projectionPolicies: Record<string, HabitProjectionPolicy>;
  projectionSaveStatus: Record<string, { type: 'success' | 'error'; message: string }>;
  projectionLoading: boolean;
  exportFormat: 'markdown' | 'json' | 'csv';
  exportWriteMode: 'overwrite' | 'append' | 'skip';
  exportDatePreset: 'yesterday' | '7d' | '30d' | 'custom';
  exportStartDate: string;
  exportEndDate: string;
  exportLoading: boolean;
  exportResult: { type: 'success' | 'error'; message: string } | null;
  exportSchedule: ExportSchedule | null;
  scheduleSaving: boolean;
  exportHistory: ExportHistoryEntry[];
  autoSyncEnabled: boolean;
  syncHour: number;
  getMetricSyncMode: (metricType: string) => WearableMetricSyncMode;
  setExportFormat: React.Dispatch<React.SetStateAction<'markdown' | 'json' | 'csv'>>;
  setExportWriteMode: React.Dispatch<React.SetStateAction<'overwrite' | 'append' | 'skip'>>;
  setExportStartDate: React.Dispatch<React.SetStateAction<string>>;
  setExportEndDate: React.Dispatch<React.SetStateAction<string>>;
  handleMetricModeChange: (metricType: string, syncMode: WearableMetricSyncMode) => Promise<void>;
  handleProjectionPriorityChange: (habit: HabitSummary, nextValue: string) => Promise<void>;
  applyExportDatePreset: (preset: 'yesterday' | '7d' | '30d' | 'custom') => void;
  handleExportNow: () => Promise<void>;
  saveExportSchedule: (schedule: ExportSchedule | null) => Promise<void>;
  updateScheduleField: <K extends keyof ExportSchedule>(field: K, value: ExportSchedule[K]) => void;
  handleSyncSettingsUpdate: (updates: { auto_sync_enabled?: boolean; sync_hour?: number }) => Promise<void>;
  handleDisconnect: () => Promise<void>;
  scheduleLoaded: boolean;
  loadExportSchedule: () => Promise<void>;
  setExportSchedule: React.Dispatch<React.SetStateAction<ExportSchedule | null>>;
  setExportHistory: React.Dispatch<React.SetStateAction<ExportHistoryEntry[]>>;
  setExportDatePreset: React.Dispatch<React.SetStateAction<'yesterday' | '7d' | '30d' | 'custom'>>;
};

export function AppleWatchTabPanels({
  tab,
  connected,
  lastSync,
  statusData,
  enabledMetricCount,
  flatMetrics,
  lastEnabledSyncModes,
  metricSaveStatus,
  projectionHabits,
  projectionPolicies,
  projectionSaveStatus,
  projectionLoading,
  exportFormat,
  exportWriteMode,
  exportDatePreset,
  exportStartDate,
  exportEndDate,
  exportLoading,
  exportResult,
  exportSchedule,
  scheduleSaving,
  exportHistory,
  autoSyncEnabled,
  syncHour,
  getMetricSyncMode,
  setExportFormat,
  setExportWriteMode,
  setExportStartDate,
  setExportEndDate,
  handleMetricModeChange,
  handleProjectionPriorityChange,
  applyExportDatePreset,
  handleExportNow,
  saveExportSchedule,
  updateScheduleField,
  handleSyncSettingsUpdate,
  handleDisconnect,
  scheduleLoaded,
  loadExportSchedule,
  setExportSchedule,
  setExportHistory,
  setExportDatePreset,
}: AppleWatchTabPanelsProps) {
  const { isDesktop } = useDesktopCapabilities();
  return (
    <>
      {tab === 'overview' && (
        <div className="space-y-4">
          {connected ? (
            <div className="divide-y divide-gray-100">
              <InfoRow label="Last sync" value={formatRelativeTime(lastSync)} />
              <InfoRow label="Tracked metrics" value={`${enabledMetricCount} enabled`} />
              <InfoRow label="Device" value={statusData?.deviceName || 'iPhone'} />
            </div>
          ) : (
            <div className="rounded-sm bg-[#F5F5F4] px-5 py-6 text-center">
              <p className="text-sm font-medium text-gray-900">Not connected</p>
              <p className={cn('mt-1.5 text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>
                Open the Ritual Companion app on your iPhone to connect.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* METRICS TAB                                                      */}
      {/* ================================================================ */}
      {tab === 'metrics' && connected && (
        <div className="space-y-3">
          <p className={cn('text-[12px]', SETTINGS_MUTED_TEXT_CLASS)}>
            Overview always stays daily. Granular metrics also show richer detail in Logs and Metrics.
          </p>
          {flatMetrics.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {flatMetrics.map((metric) => {
                const syncMode = getMetricSyncMode(metric.type);
                const metricEnabled = syncMode === 'daily_only' || syncMode === 'granular';
                const preferredEnabledMode = lastEnabledSyncModes[metric.type] || 'daily_only';
                return (
                  <div key={metric.type} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-gray-900 leading-tight">{metric.name}</p>
                      <p className={cn('mt-0.5 text-[11px]', SETTINGS_MUTED_TEXT_CLASS)}>{metric.unit}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <GreenToggle
                        checked={metricEnabled}
                        onChange={(checked) =>
                          handleMetricModeChange(metric.type, checked ? preferredEnabledMode : 'off')
                        }
                        ariaLabel={`${metricEnabled ? 'Disable' : 'Enable'} ${metric.name}`}
                      />
                      {metricEnabled && (
                        <div className="flex items-center gap-1.5">
                          <SegmentButton
                            active={syncMode === 'daily_only'}
                            onClick={() => handleMetricModeChange(metric.type, 'daily_only')}
                            small
                          >
                            Daily
                          </SegmentButton>
                          <SegmentButton
                            active={syncMode === 'granular'}
                            onClick={() => handleMetricModeChange(metric.type, 'granular')}
                            small
                          >
                            Granular
                          </SegmentButton>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={cn('flex items-center gap-2 py-8 justify-center text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>
              <BrailleSpinner /> Loading metrics...
            </div>
          )}

          {metricSaveStatus && (
            <p className={cn('text-xs text-center', metricSaveStatus.type === 'success' ? 'text-green-600' : 'text-red-500')}>
              {metricSaveStatus.message}
            </p>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* EXPORT TAB                                                       */}
      {/* ================================================================ */}
      {tab === 'export' && connected && (
        <div className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900">Date range</label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {([['yesterday', 'Yesterday'], ['7d', '7 Days'], ['30d', '30 Days'], ['custom', 'Custom']] as const).map(([key, label]) => (
                  <SegmentButton key={key} active={exportDatePreset === key} onClick={() => applyExportDatePreset(key)}>
                    {label}
                  </SegmentButton>
                ))}
              </div>
              {exportDatePreset === 'custom' ? (
                <div className="flex items-center gap-2">
                  <Input type="date" value={exportStartDate} onChange={(e) => setExportStartDate(e.target.value)} className="h-8 w-32 text-[13px] rounded-sm" />
                  <span className={cn('text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>to</span>
                  <Input type="date" value={exportEndDate} onChange={(e) => setExportEndDate(e.target.value)} className="h-8 w-32 text-[13px] rounded-sm" />
                </div>
              ) : (
                <p className={cn('text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>{exportStartDate} — {exportEndDate}</p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-900">Format</label>
              <div className="flex gap-1.5">
                {([['markdown', 'Markdown'], ['json', 'JSON'], ['csv', 'CSV']] as const).map(([key, label]) => (
                  <SegmentButton key={key} active={exportFormat === key} onClick={() => setExportFormat(key)}>
                    {label}
                  </SegmentButton>
                ))}
              </div>
            </div>

            {isDesktop && (
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-900">Write mode</label>
                <div className="flex flex-wrap gap-1.5">
                  {([['overwrite', 'Overwrite'], ['append', 'Append'], ['skip', 'Skip existing']] as const).map(([key, label]) => (
                    <SegmentButton key={key} active={exportWriteMode === key} onClick={() => setExportWriteMode(key)}>
                      {label}
                    </SegmentButton>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleExportNow}
              disabled={exportLoading}
              className="inline-flex items-center gap-1.5 rounded-sm bg-gray-900 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              {exportLoading ? (
                <><BrailleSpinner /> Exporting...</>
              ) : 'Export now'}
            </button>

            {exportResult && (
              <p className={cn('text-[13px]', exportResult.type === 'success' ? 'text-green-600' : 'text-red-500')}>
                {exportResult.message}
              </p>
            )}
          </div>

          <div className="border-t border-gray-100" />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">Scheduled export</p>
              <GreenToggle
                checked={Boolean(exportSchedule?.enabled)}
                onChange={(checked) => {
                  if (!scheduleLoaded) loadExportSchedule();
                  const updated: ExportSchedule = {
                    ...(exportSchedule || { enabled: false, frequency: 'daily', format: 'markdown', time: '08:00', day_of_week: null, folder_path: null, include_all_metrics: true, metric_types: null }),
                    enabled: checked,
                  };
                  setExportSchedule(updated);
                  saveExportSchedule(updated);
                }}
                ariaLabel="Scheduled export"
              />
            </div>

            {exportSchedule?.enabled && (
              <div className="space-y-3 rounded-sm border border-gray-200 bg-white p-4">
                <div>
                  <label className={cn('mb-1.5 block text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>Frequency</label>
                  <div className="flex gap-1.5">
                    {(['daily', 'weekly'] as const).map((freq) => (
                      <SegmentButton key={freq} active={exportSchedule.frequency === freq} onClick={() => updateScheduleField('frequency', freq)}>
                        {freq.charAt(0).toUpperCase() + freq.slice(1)}
                      </SegmentButton>
                    ))}
                  </div>
                </div>

                {exportSchedule.frequency === 'weekly' && (
                  <div>
                    <label className={cn('mb-1.5 block text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>Day</label>
                    <div className="flex flex-wrap gap-1">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                        <SegmentButton key={day} active={exportSchedule.day_of_week === i} onClick={() => updateScheduleField('day_of_week', i)} small>
                          {day}
                        </SegmentButton>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className={cn('mb-1.5 block text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>Time</label>
                  <Input type="time" value={exportSchedule.time || '08:00'} onChange={(e) => updateScheduleField('time', e.target.value)} className="h-8 w-28 text-[13px] rounded-sm" />
                </div>

                <div>
                  <label className={cn('mb-1.5 block text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>Format</label>
                  <div className="flex gap-1.5">
                    {(['markdown', 'json', 'csv'] as const).map((fmt) => (
                      <SegmentButton key={fmt} active={exportSchedule.format === fmt} onClick={() => updateScheduleField('format', fmt)}>
                        {fmt === 'markdown' ? 'Markdown' : fmt.toUpperCase()}
                      </SegmentButton>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => saveExportSchedule(exportSchedule)}
                  disabled={scheduleSaving}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-[#F3F3F3] disabled:opacity-50"
                >
                  {scheduleSaving ? (<><BrailleSpinner /> Saving...</>) : 'Save schedule'}
                </button>
              </div>
            )}
          </div>

          {exportHistory.length > 0 && (
            <>
              <div className="border-t border-gray-100" />
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">History</p>
                  <button
                    onClick={() => setExportHistory([])}
                    className={cn('text-[13px] transition-colors hover:text-gray-600', SETTINGS_MUTED_TEXT_CLASS)}
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-2">
                  {exportHistory.slice(0, 20).map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-sm border border-gray-100 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', entry.status === 'success' ? 'bg-[#4e632d]' : 'bg-red-400')} />
                          <span className="text-[13px] font-medium text-gray-900">
                            {entry.start_date === entry.end_date ? entry.start_date : `${entry.start_date} — ${entry.end_date}`}
                          </span>
                          <span className={cn('rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium', SETTINGS_MUTED_TEXT_CLASS)}>{entry.format}</span>
                        </div>
                        <div className={cn('mt-1 flex items-center gap-2 text-[12px]', SETTINGS_MUTED_TEXT_CLASS)}>
                          <span>{new Date(entry.timestamp).toLocaleString()}</span>
                          {entry.file_size_bytes != null && <span>{(entry.file_size_bytes / 1024).toFixed(1)} KB</span>}
                          <span className="capitalize">{entry.triggered_by}</span>
                        </div>
                        {entry.error && <p className="mt-1 text-[12px] text-red-500">{entry.error}</p>}
                      </div>
                      {entry.status === 'failed' && (
                        <button
                          onClick={() => {
                            setExportStartDate(entry.start_date);
                            setExportEndDate(entry.end_date);
                            setExportFormat(entry.format as 'markdown' | 'json' | 'csv');
                            setExportDatePreset('custom');
                          }}
                          className={cn(
                            'ml-3 shrink-0 rounded-sm border border-gray-200 px-2.5 py-1 text-[12px] transition-colors hover:bg-[#F3F3F3] hover:text-gray-700',
                            SETTINGS_MUTED_TEXT_CLASS,
                          )}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* SETTINGS TAB                                                     */}
      {/* ================================================================ */}
      {tab === 'settings' && connected && (
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">Auto sync</p>
              <GreenToggle
                checked={autoSyncEnabled}
                onChange={(checked) => handleSyncSettingsUpdate({ auto_sync_enabled: checked, sync_hour: syncHour })}
                ariaLabel="Auto sync"
              />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-900">Preferred sync time</p>
              <Select
                value={String(syncHour)}
                onValueChange={(value) => handleSyncSettingsUpdate({ auto_sync_enabled: autoSyncEnabled, sync_hour: Number(value) })}
                disabled={!autoSyncEnabled}
              >
                <SelectTrigger className="h-8 w-[120px] text-[13px] rounded-sm">
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

            <div className="mt-4 flex items-center justify-between py-1">
              <span className={cn('text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>Last sync</span>
              <span className="text-[13px] text-gray-900">{formatRelativeTime(lastSync)}</span>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Habit source priority</p>
              <p className={cn('mt-1 text-[12px]', SETTINGS_MUTED_TEXT_CLASS)}>
                Choose which source is allowed to feed each Apple Health-related habit. Overview stays daily; this only changes
                which source projects into the habit totals.
              </p>
            </div>

            {projectionLoading ? (
              <div className={cn('flex items-center gap-2 py-6 text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>
                <BrailleSpinner /> Loading habits...
              </div>
            ) : projectionHabits.length > 0 ? (
              <div className="divide-y divide-gray-100 rounded-sm border border-gray-100 bg-white">
                {projectionHabits.map((habit) => {
                  const policy = projectionPolicies[habit.id];
                  const options = buildProjectionPriorityOptions(habit, policy);
                  const currentPriority = policy?.projection_source_priority || [];
                  const currentValue =
                    options.find((option) => option.value === currentPriority.join('|'))?.value
                    || options[0]?.value
                    || '';
                  const metricType = getWearableMetricType(habit);
                  const saveStatus = projectionSaveStatus[habit.id];

                  return (
                    <div key={habit.id} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-gray-900">{habit.name}</p>
                        <p className={cn('mt-0.5 text-[11px]', SETTINGS_MUTED_TEXT_CLASS)}>
                          {humanizeWearableMetric(metricType)} · Default source {formatProjectionSource(habit.integration_source || 'manual')}
                        </p>
                        <p className={cn('mt-1 text-[11px]', SETTINGS_MUTED_TEXT_CLASS)}>
                          Current priority: {formatProjectionPrioritySummary(currentPriority)}
                        </p>
                        {saveStatus && (
                          <p className={cn('mt-1 text-[11px]', saveStatus.type === 'success' ? 'text-green-600' : 'text-red-500')}>
                            {saveStatus.message}
                          </p>
                        )}
                      </div>

                      <div className="w-[170px] shrink-0">
                        {options.length > 1 ? (
                          <Select value={currentValue} onValueChange={(value) => handleProjectionPriorityChange(habit, value)}>
                            <SelectTrigger className="h-8 text-[13px] rounded-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className={cn('rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 text-[12px]', SETTINGS_MUTED_TEXT_CLASS)}>
                            {options[0]?.label || 'Apple Health only'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={cn('rounded-sm border border-dashed border-gray-200 px-4 py-4 text-[13px]', SETTINGS_MUTED_TEXT_CLASS)}>
                No Apple Health-related habits to configure yet.
              </div>
            )}
          </div>

          <div className="border-t border-gray-100" />

          <button
            onClick={handleDisconnect}
            className="rounded-sm border border-red-200 px-3 py-1.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            Disconnect Apple Watch
          </button>
        </div>
      )}

    </>
  );
}
