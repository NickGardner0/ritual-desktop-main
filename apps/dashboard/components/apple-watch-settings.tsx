'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { cn } from '@/lib/utils';
import {
  getWearableMetricType,
  type WearableMetricPreferences,
  type WearableMetricSyncMode,
} from '@/lib/wearables-dashboard';
import {
  seedLastEnabledSyncModesFromPreferences,
  isAppleProjectionMetric,
  buildProjectionPriorityOptions,
  formatProjectionPrioritySummary,
  type AppleWatchTab,
  type ExportHistoryEntry,
  type ExportSchedule,
  type HabitProjectionPolicy,
  type HabitSummary,
  type MetricCategory,
  type MetricEntry,
} from '@/components/apple-watch-settings.helpers';
import { useAppleWatchStatus, useWearableConnection } from './settings/apple-watch/hooks';
import { SETTINGS_MUTED_TEXT_CLASS } from './settings/apple-watch/ui-components';
import { AppleWatchTabPanels } from './settings/apple-watch/tab-panels';

export function AppleWatchSettings() {
  const { isDesktop } = useDesktopCapabilities();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data: statusData } = useAppleWatchStatus();
  const { data: connection } = useWearableConnection('apple_health');

  const connected = statusData?.connected || false;
  const lastSync = statusData?.lastSyncAt;

  const [tab, setTab] = useState<AppleWatchTab>('overview');

  const [metricCatalog, setMetricCatalog] = useState<MetricCategory[]>([]);
  const [metricPreferences, setMetricPreferences] = useState<WearableMetricPreferences>({});
  const [lastEnabledSyncModes, setLastEnabledSyncModes] = useState<
    Record<string, Exclude<WearableMetricSyncMode, 'off'>>
  >({});
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  const [projectionHabits, setProjectionHabits] = useState<HabitSummary[]>([]);
  const [projectionPolicies, setProjectionPolicies] = useState<Record<string, HabitProjectionPolicy>>({});
  const [projectionLoaded, setProjectionLoaded] = useState(false);
  const [projectionLoading, setProjectionLoading] = useState(false);

  const [metricSaveStatus, setMetricSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const metricSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectionSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [projectionSaveStatus, setProjectionSaveStatus] = useState<
    Record<string, { type: 'success' | 'error'; message: string }>
  >({});

  const [exportFormat, setExportFormat] = useState<'markdown' | 'json' | 'csv'>('markdown');
  const [exportWriteMode, setExportWriteMode] = useState<'overwrite' | 'append' | 'skip'>('overwrite');
  const [exportDatePreset, setExportDatePreset] = useState<'yesterday' | '7d' | '30d' | 'custom'>('7d');
  const [exportStartDate, setExportStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [exportEndDate, setExportEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportLoading, setExportLoading] = useState(false);
  const [exportResult, setExportResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [exportSchedule, setExportSchedule] = useState<ExportSchedule | null>(null);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [exportHistory, setExportHistory] = useState<ExportHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // ------ data loaders ------

  const loadMetricCatalogAndPreferences = useCallback(async () => {
    if (metricsLoaded) return;
    try {
      const token = await getToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const [catalogRes, prefsRes] = await Promise.all([
        fetch('/api/wearables/apple/metric-catalog', { headers }),
        fetch('/api/wearables/apple/metric-preferences', { headers }),
      ]);
      if (catalogRes.ok) {
        const data = await catalogRes.json();
        setMetricCatalog(data.categories || []);
      }
      if (prefsRes.ok) {
        const data = await prefsRes.json();
        const nextPreferences = data.effective_preferences || data.preferences || {};
        setMetricPreferences(nextPreferences);
        setLastEnabledSyncModes((prev) =>
          seedLastEnabledSyncModesFromPreferences(nextPreferences, prev),
        );
      }
      setMetricsLoaded(true);
    } catch (err) {
      console.error('Failed to load metric catalog:', err);
    }
  }, [metricsLoaded, getToken]);

  const loadProjectionPolicies = useCallback(async () => {
    if (projectionLoaded || projectionLoading) return;
    try {
      setProjectionLoading(true);
      const token = await getToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      const habitsRes = await fetch('/api/habits', { headers });
      if (!habitsRes.ok) {
        throw new Error('Failed to fetch habits');
      }

      const habits = ((await habitsRes.json()) as HabitSummary[])
        .filter((habit) => isAppleProjectionMetric(getWearableMetricType(habit)))
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));

      setProjectionHabits(habits);

      if (habits.length === 0) {
        setProjectionPolicies({});
        setProjectionLoaded(true);
        return;
      }

      const policyEntries = await Promise.all(
        habits.map(async (habit) => {
          const res = await fetch(`/api/habits/${habit.id}/projection-policy`, { headers });
          if (!res.ok) {
            throw new Error(`Failed to fetch projection policy for ${habit.name}`);
          }
          const data = (await res.json()) as HabitProjectionPolicy;
          return [habit.id, data] as const;
        }),
      );

      setProjectionPolicies(Object.fromEntries(policyEntries));
      setProjectionLoaded(true);
    } catch (err) {
      console.error('Failed to load habit projection policies:', err);
      setProjectionLoaded(true);
    } finally {
      setProjectionLoading(false);
    }
  }, [getToken, projectionLoaded, projectionLoading]);

  const loadExportSchedule = useCallback(async () => {
    if (scheduleLoaded) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch('/api/wearables/apple/export-schedule', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) setExportSchedule(data.schedule);
      }
    } catch (err) {
      console.error('Failed to load export schedule:', err);
    } finally {
      setScheduleLoaded(true);
    }
  }, [scheduleLoaded, getToken]);

  const loadExportHistory = useCallback(async () => {
    if (historyLoaded) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch('/api/wearables/apple/export-history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setExportHistory(data.history || []);
      }
    } catch (err) {
      console.error('Failed to load export history:', err);
    } finally {
      setHistoryLoaded(true);
    }
  }, [historyLoaded, getToken]);

  useEffect(() => {
    if (!connected) return;
    if (!metricsLoaded) loadMetricCatalogAndPreferences();
    if (!scheduleLoaded) loadExportSchedule();
    if (!historyLoaded) loadExportHistory();
    if (!projectionLoaded && !projectionLoading) loadProjectionPolicies();
  }, [
    connected,
    metricsLoaded,
    scheduleLoaded,
    historyLoaded,
    projectionLoaded,
    projectionLoading,
    loadMetricCatalogAndPreferences,
    loadExportSchedule,
    loadExportHistory,
    loadProjectionPolicies,
  ]);

  useEffect(() => {
    return () => {
      if (metricSaveTimerRef.current) {
        clearTimeout(metricSaveTimerRef.current);
      }
      for (const timer of Object.values(projectionSaveTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  // ------ actions ------

  const enabledMetricCount = Object.values(metricPreferences).filter(
    (preference) => preference?.sync_mode === 'daily_only' || preference?.sync_mode === 'granular',
  ).length;

  const getMetricSyncMode = useCallback(
    (metricType: string): WearableMetricSyncMode => {
      const syncMode = metricPreferences[metricType]?.sync_mode;
      if (syncMode === 'daily_only' || syncMode === 'granular' || syncMode === 'off') {
        return syncMode;
      }
      return 'off';
    },
    [metricPreferences],
  );

  async function saveMetricPreferences(preferences: WearableMetricPreferences) {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch('/api/wearables/apple/metric-preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences }),
    });
    if (!res.ok) throw new Error('Failed to save');
    const data = await res.json();
    const nextPreferences = data.effective_preferences || data.preferences || preferences;
    setMetricPreferences(nextPreferences);
    setLastEnabledSyncModes((prev) =>
      seedLastEnabledSyncModesFromPreferences(nextPreferences, prev),
    );
  }

  async function saveProjectionPolicy(
    habitId: string,
    projectionSourcePriority: string[],
    canonicalMetricType?: string | null,
  ) {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`/api/habits/${habitId}/projection-policy`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canonical_metric_type: canonicalMetricType || null,
        projection_source_priority: projectionSourcePriority,
      }),
    });
    if (!res.ok) throw new Error('Failed to save source priority');
    return (await res.json()) as HabitProjectionPolicy;
  }

  async function handleMetricModeChange(metricType: string, syncMode: WearableMetricSyncMode) {
    const nextPreferences: WearableMetricPreferences = {
      ...metricPreferences,
      [metricType]: { sync_mode: syncMode },
    };
    setMetricPreferences(nextPreferences);
    if (syncMode === 'daily_only' || syncMode === 'granular') {
      setLastEnabledSyncModes((prev) => ({
        ...prev,
        [metricType]: syncMode,
      }));
    }

    try {
      await saveMetricPreferences(nextPreferences);
      const nextEnabledCount = Object.values(nextPreferences).filter(
        (preference) => preference?.sync_mode === 'daily_only' || preference?.sync_mode === 'granular',
      ).length;
      setMetricSaveStatus({ type: 'success', message: `${nextEnabledCount} enabled` });
    } catch {
      setMetricPreferences(metricPreferences);
      setMetricSaveStatus({ type: 'error', message: 'Failed to save' });
    }

    if (metricSaveTimerRef.current) clearTimeout(metricSaveTimerRef.current);
    metricSaveTimerRef.current = setTimeout(() => setMetricSaveStatus(null), 2000);
  }

  async function handleProjectionPriorityChange(habit: HabitSummary, nextValue: string) {
    const options = buildProjectionPriorityOptions(habit, projectionPolicies[habit.id]);
    const selectedOption = options.find((option) => option.value === nextValue);
    if (!selectedOption) return;

    const previousPolicy = projectionPolicies[habit.id];
    const optimisticPolicy: HabitProjectionPolicy = {
      habit_id: habit.id,
      canonical_metric_type:
        previousPolicy?.canonical_metric_type || getWearableMetricType(habit),
      projection_source_priority: selectedOption.priority,
    };

    setProjectionPolicies((prev) => ({
      ...prev,
      [habit.id]: optimisticPolicy,
    }));

    try {
      const savedPolicy = await saveProjectionPolicy(
        habit.id,
        selectedOption.priority,
        optimisticPolicy.canonical_metric_type,
      );
      setProjectionPolicies((prev) => ({
        ...prev,
        [habit.id]: savedPolicy,
      }));
      setProjectionSaveStatus((prev) => ({
        ...prev,
        [habit.id]: { type: 'success', message: formatProjectionPrioritySummary(savedPolicy.projection_source_priority) },
      }));
    } catch (error) {
      console.error('Failed to save habit projection policy:', error);
      setProjectionPolicies((prev) => {
        const next = { ...prev };
        if (previousPolicy) {
          next[habit.id] = previousPolicy;
        } else {
          delete next[habit.id];
        }
        return next;
      });
      setProjectionSaveStatus((prev) => ({
        ...prev,
        [habit.id]: { type: 'error', message: 'Failed to save' },
      }));
    }

    if (projectionSaveTimersRef.current[habit.id]) {
      clearTimeout(projectionSaveTimersRef.current[habit.id]);
    }
    projectionSaveTimersRef.current[habit.id] = setTimeout(() => {
      setProjectionSaveStatus((prev) => {
        const next = { ...prev };
        delete next[habit.id];
        return next;
      });
    }, 2500);
  }

  function applyExportDatePreset(preset: 'yesterday' | '7d' | '30d' | 'custom') {
    setExportDatePreset(preset);
    const today = new Date();
    if (preset === 'yesterday') {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      setExportStartDate(y.toISOString().slice(0, 10));
      setExportEndDate(y.toISOString().slice(0, 10));
    } else if (preset === '7d') {
      const s = new Date(today);
      s.setDate(s.getDate() - 7);
      setExportStartDate(s.toISOString().slice(0, 10));
      setExportEndDate(today.toISOString().slice(0, 10));
    } else if (preset === '30d') {
      const s = new Date(today);
      s.setDate(s.getDate() - 30);
      setExportStartDate(s.toISOString().slice(0, 10));
      setExportEndDate(today.toISOString().slice(0, 10));
    }
  }

  function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function recordExportHistory(entry: Omit<ExportHistoryEntry, 'id' | 'timestamp'>) {
    try {
      const token = await getToken();
      if (!token) return;
      const fullEntry: ExportHistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry,
        file_path: entry.file_path ?? null,
        error: entry.error ?? null,
      };
      await fetch('/api/wearables/apple/export-history', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: fullEntry }),
      });
      setExportHistory((prev) => [fullEntry, ...prev].slice(0, 50));
    } catch (err) {
      console.error('Failed to record export history:', err);
    }
  }

  async function handleExportNow() {
    try {
      setExportLoading(true);
      setExportResult(null);
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const params = new URLSearchParams({
        start_date: exportStartDate,
        end_date: exportEndDate,
        format: exportFormat,
      });

      const res = await fetch(`/api/wearables/apple/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Export failed (${res.status})`);
      }

      const ext = exportFormat === 'json' ? 'json' : exportFormat === 'csv' ? 'csv' : 'md';
      const filename = `ritual-health-${exportStartDate}-to-${exportEndDate}.${ext}`;

      let exportedContent = '';
      let exportedPath: string | null = null;

      if (isDesktop) {
        try {
          const { save } = await import('@tauri-apps/plugin-dialog');
          const { writeTextFile } = await import('@tauri-apps/plugin-fs');
          exportedContent =
            exportFormat === 'json' ? JSON.stringify(await res.json(), null, 2) : await res.text();
          const filePath = await save({
            defaultPath: filename,
            filters: [
              { name: ext.toUpperCase(), extensions: [ext] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
          if (filePath) {
            if (exportWriteMode === 'skip') {
              try {
                const { exists } = await import('@tauri-apps/plugin-fs');
                if (await exists(filePath)) {
                  setExportResult({ type: 'success', message: `Skipped — file already exists: ${filePath}` });
                  return;
                }
              } catch { /* fall through */ }
            }
            if (exportWriteMode === 'append') {
              try {
                const { readTextFile } = await import('@tauri-apps/plugin-fs');
                const existing = await readTextFile(filePath);
                exportedContent = existing + '\n\n' + exportedContent;
              } catch { /* file doesn't exist yet */ }
            }
            await writeTextFile(filePath, exportedContent);
            exportedPath = filePath;
            setExportResult({ type: 'success', message: `Exported to ${filePath}` });
          }
        } catch {
          exportedContent =
            exportFormat === 'json' ? JSON.stringify(await res.clone().json(), null, 2) : await res.clone().text();
          downloadBlob(exportedContent, filename, res.headers.get('content-type') || 'text/plain');
          setExportResult({ type: 'success', message: `Downloaded ${filename}` });
        }
      } else {
        exportedContent =
          exportFormat === 'json' ? JSON.stringify(await res.json(), null, 2) : await res.text();
        downloadBlob(exportedContent, filename, res.headers.get('content-type') || 'text/plain');
        setExportResult({ type: 'success', message: `Downloaded ${filename}` });
      }

      recordExportHistory({
        start_date: exportStartDate,
        end_date: exportEndDate,
        format: exportFormat,
        status: 'success',
        sample_count: exportedContent.length,
        file_size_bytes: new Blob([exportedContent]).size,
        file_path: exportedPath,
        error: null,
        triggered_by: 'manual',
      });
    } catch (err: any) {
      setExportResult({ type: 'error', message: err.message || 'Export failed' });
      recordExportHistory({
        start_date: exportStartDate,
        end_date: exportEndDate,
        format: exportFormat,
        status: 'failed',
        sample_count: 0,
        file_size_bytes: null,
        file_path: null,
        error: err.message || 'Export failed',
        triggered_by: 'manual',
      });
    } finally {
      setExportLoading(false);
    }
  }

  async function saveExportSchedule(schedule: ExportSchedule | null) {
    setScheduleSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch('/api/wearables/apple/export-schedule', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule }),
      });
      if (!res.ok) throw new Error('Failed to save schedule');
      const data = await res.json();
      setExportSchedule(data.schedule);
    } finally {
      setScheduleSaving(false);
    }
  }

  function updateScheduleField<K extends keyof ExportSchedule>(field: K, value: ExportSchedule[K]) {
    setExportSchedule((prev) => {
      const base: ExportSchedule = prev || {
        enabled: false,
        frequency: 'daily',
        format: 'markdown',
        time: '08:00',
        day_of_week: null,
        folder_path: null,
        include_all_metrics: true,
        metric_types: null,
      };
      return { ...base, [field]: value };
    });
  }

  async function handleSyncSettingsUpdate(updates: { auto_sync_enabled?: boolean; sync_hour?: number }) {
    try {
      const token = await getToken();
      if (!token) return;

      const nextEnabled = updates.auto_sync_enabled ?? connection?.auto_sync_enabled ?? false;
      const nextHour = updates.sync_hour ?? connection?.sync_hour ?? 9;

      const response = await fetch('/api/wearables/connections/apple_health/sync-settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_sync_enabled: nextEnabled, sync_hour: nextHour }),
      });
      if (!response.ok) throw new Error('Failed to update sync settings');

      queryClient.invalidateQueries({ queryKey: ['wearable-connections'] });
      queryClient.invalidateQueries({ queryKey: ['integrations-overview'] });
    } catch (error) {
      console.error('Error updating Apple Watch sync settings:', error);
      alert('Failed to update sync settings.');
    }
  }

  async function handleDisconnect() {
    try {
      const token = await getToken();
      if (!token) return;

      if (!confirm('Disconnect Apple Watch? You can reconnect using the Ritual iOS companion app.')) {
        return;
      }

      const devices = statusData?.devices || [];
      if (devices.length === 0) {
        alert('No Apple Watch device found');
        return;
      }

      for (const device of devices) {
        const response = await fetch(`/api/wearables/apple/devices/${device.device_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to disconnect device');
      }

      queryClient.invalidateQueries({ queryKey: ['apple-watch-status'] });
      queryClient.invalidateQueries({ queryKey: ['integrations-overview'] });
      alert('Apple Watch disconnected. Tap Sync in the iOS companion app to reconnect.');
    } catch (error) {
      console.error('Error disconnecting Apple Watch:', error);
      alert(`Failed to disconnect: ${error}`);
    }
  }
  // ------ render ------

  const tabs: { key: AppleWatchTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    ...(connected
      ? [
          { key: 'metrics' as const, label: 'Metrics' },
          { key: 'export' as const, label: 'Export' },
          { key: 'settings' as const, label: 'Settings' },
        ]
      : []),
  ];

  const autoSyncEnabled = connection?.auto_sync_enabled ?? false;
  const syncHour = connection?.sync_hour ?? 9;

  // Flatten all metrics into a single ordered list for the Metrics tab.
  const flatMetrics: MetricEntry[] = metricCatalog.flatMap((cat) => cat.metrics || []);

  return (
    <div className="space-y-5">
      {/* Header: title + connection badge */}
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-gray-900">Apple Watch</h3>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium',
            connected ? 'text-gray-700' : SETTINGS_MUTED_TEXT_CLASS,
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-[#73bf1d]' : 'bg-gray-300')} />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {/* Tab bar — underline style, no card container */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative -mb-px pb-2.5 text-[13px] font-medium transition-colors',
                tab === t.key
                  ? 'text-gray-900'
                  : `${SETTINGS_MUTED_TEXT_CLASS} hover:text-gray-600`,
              )}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute bottom-0 left-0 right-0 h-px bg-gray-900" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ================================================================ */}
      {/* OVERVIEW TAB                                                     */}

      <AppleWatchTabPanels
        tab={tab}
        connected={connected}
        lastSync={lastSync}
        statusData={statusData}
        enabledMetricCount={enabledMetricCount}
        flatMetrics={flatMetrics}
        lastEnabledSyncModes={lastEnabledSyncModes}
        metricSaveStatus={metricSaveStatus}
        projectionHabits={projectionHabits}
        projectionPolicies={projectionPolicies}
        projectionSaveStatus={projectionSaveStatus}
        projectionLoading={projectionLoading}
        exportFormat={exportFormat}
        exportWriteMode={exportWriteMode}
        exportDatePreset={exportDatePreset}
        exportStartDate={exportStartDate}
        exportEndDate={exportEndDate}
        exportLoading={exportLoading}
        exportResult={exportResult}
        exportSchedule={exportSchedule}
        scheduleSaving={scheduleSaving}
        exportHistory={exportHistory}
        autoSyncEnabled={autoSyncEnabled}
        syncHour={syncHour}
        getMetricSyncMode={getMetricSyncMode}
        setExportFormat={setExportFormat}
        setExportWriteMode={setExportWriteMode}
        setExportStartDate={setExportStartDate}
        setExportEndDate={setExportEndDate}
        handleMetricModeChange={handleMetricModeChange}
        handleProjectionPriorityChange={handleProjectionPriorityChange}
        applyExportDatePreset={applyExportDatePreset}
        handleExportNow={handleExportNow}
        saveExportSchedule={saveExportSchedule}
        updateScheduleField={updateScheduleField}
        handleSyncSettingsUpdate={handleSyncSettingsUpdate}
        handleDisconnect={handleDisconnect}
        scheduleLoaded={scheduleLoaded}
        loadExportSchedule={loadExportSchedule}
        setExportSchedule={setExportSchedule}
        setExportHistory={setExportHistory}
        setExportDatePreset={setExportDatePreset}
      />
    </div>
  );
}
