'use client';

/**
 * Apple Watch Settings — self-contained component for the tabbed settings modal.
 *
 * Extracted from integrations-client.tsx so all Apple Watch configuration lives
 * in one place: metrics selection, data export (manual + scheduled), sync
 * settings, and disconnect.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isTauri } from '@/lib/tauri-utils';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${period}`;
}

function formatRelativeTime(dateValue: string | null | undefined): string {
  if (!dateValue) return 'Never';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppleWatchTab = 'overview' | 'metrics' | 'export' | 'settings';

interface ExportSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  format: 'markdown' | 'json' | 'csv';
  time: string;
  day_of_week: number | null;
  folder_path: string | null;
  include_all_metrics: boolean;
  metric_types: string[] | null;
}

interface ExportHistoryEntry {
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
}

interface MetricEntry {
  type: string;
  name: string;
  unit: string;
}

interface MetricCategory {
  category: string;
  metrics: MetricEntry[];
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useAppleWatchStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['apple-watch-status', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch('/api/wearables/apple/devices', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch Apple Watch status');
      const data = await response.json();
      const activeDevices = (data.devices || []).filter(
        (d: any) => d.is_active && d.platform === 'ios',
      );
      return {
        connected: activeDevices.length > 0,
        devices: activeDevices,
        lastSyncAt: activeDevices[0]?.last_sync_at || null,
        deviceName: activeDevices[0]?.device_name || null,
      };
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!user?.id,
  });
}

function useWearableConnection(provider: string) {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['wearable-connections', user?.id, provider],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/api/wearables/connections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const connections = data.connections || [];
      return connections.find((c: any) => c.provider === provider) || null;
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!user?.id,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppleWatchSettings() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data: statusData } = useAppleWatchStatus();
  const { data: connection } = useWearableConnection('apple_health');

  const connected = statusData?.connected || false;
  const lastSync = statusData?.lastSyncAt;

  const [tab, setTab] = useState<AppleWatchTab>('overview');

  const [metricCatalog, setMetricCatalog] = useState<MetricCategory[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set());
  const [metricsLoaded, setMetricsLoaded] = useState(false);

  const [metricSaveStatus, setMetricSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const metricSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setSelectedMetrics(new Set(data.selected_metrics || []));
      }
      setMetricsLoaded(true);
    } catch (err) {
      console.error('Failed to load metric catalog:', err);
    }
  }, [metricsLoaded, getToken]);

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
  }, [connected, metricsLoaded, scheduleLoaded, historyLoaded, loadMetricCatalogAndPreferences, loadExportSchedule, loadExportHistory]);

  // ------ actions ------

  async function saveMetricPreferences(selected: string[]) {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch('/api/wearables/apple/metric-preferences', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_metrics: selected }),
    });
    if (!res.ok) throw new Error('Failed to save');
    setSelectedMetrics(new Set(selected));
  }

  async function handleMetricToggle(metricType: string, enabled: boolean) {
    const next = new Set(selectedMetrics);
    if (enabled) {
      next.add(metricType);
    } else {
      next.delete(metricType);
    }
    setSelectedMetrics(next);

    try {
      await saveMetricPreferences(Array.from(next));
      setMetricSaveStatus({ type: 'success', message: `${next.size} selected` });
    } catch {
      setSelectedMetrics(selectedMetrics);
      setMetricSaveStatus({ type: 'error', message: 'Failed to save' });
    }

    if (metricSaveTimerRef.current) clearTimeout(metricSaveTimerRef.current);
    metricSaveTimerRef.current = setTimeout(() => setMetricSaveStatus(null), 2000);
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

      if (isTauri()) {
        try {
          const { save } = await import('@tauri-apps/api/dialog');
          const { writeTextFile } = await import('@tauri-apps/api/fs');
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
                const { exists } = await import('@tauri-apps/api/fs');
                if (await exists(filePath)) {
                  setExportResult({ type: 'success', message: `Skipped — file already exists: ${filePath}` });
                  return;
                }
              } catch { /* fall through */ }
            }
            if (exportWriteMode === 'append') {
              try {
                const { readTextFile } = await import('@tauri-apps/api/fs');
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

      const response = await fetch(`${API_BASE_URL}/api/wearables/connections/apple_health/sync-settings`, {
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
        const response = await fetch(`${API_BASE_URL}/api/wearables/apple/devices/${device.device_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to disconnect device');
      }

      queryClient.invalidateQueries({ queryKey: ['apple-watch-status'] });
      queryClient.invalidateQueries({ queryKey: ['integrations-overview'] });
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
            connected ? 'text-gray-700' : 'text-gray-400',
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-green-500' : 'bg-gray-300')} />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 rounded-sm border border-gray-200 bg-[#F5F5F4] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 rounded-sm px-3 py-1.5 text-[13px] font-medium transition-all',
              tab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* OVERVIEW TAB                                                     */}
      {/* ================================================================ */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {connected ? (
            <div className="divide-y divide-gray-100">
              <InfoRow label="Last sync" value={formatRelativeTime(lastSync)} />
              <InfoRow label="Tracked metrics" value={`${selectedMetrics.size} selected`} />
              <InfoRow label="Device" value={statusData?.deviceName || 'iPhone'} />
            </div>
          ) : (
            <div className="rounded-sm bg-[#F5F5F4] px-5 py-6 text-center">
              <p className="text-sm font-medium text-gray-900">Not connected</p>
              <p className="mt-1.5 text-[13px] text-gray-500">
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
          {flatMetrics.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {flatMetrics.map((metric) => {
                const isEnabled = selectedMetrics.has(metric.type);
                return (
                  <div key={metric.type} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-gray-900 leading-tight">{metric.name}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">{metric.unit}</p>
                    </div>
                    <GreenToggle
                      checked={isEnabled}
                      onChange={(next) => handleMetricToggle(metric.type, next)}
                      ariaLabel={metric.name}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-8 justify-center text-[13px] text-gray-400">
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
                  <span className="text-[13px] text-gray-400">to</span>
                  <Input type="date" value={exportEndDate} onChange={(e) => setExportEndDate(e.target.value)} className="h-8 w-32 text-[13px] rounded-sm" />
                </div>
              ) : (
                <p className="text-[13px] text-gray-400">{exportStartDate} — {exportEndDate}</p>
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

            {isTauri() && (
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

            <Button onClick={handleExportNow} disabled={exportLoading} className="w-full h-9 text-[13px] rounded-sm font-medium">
              {exportLoading ? (
                <span className="flex items-center gap-2"><BrailleSpinner /> Exporting...</span>
              ) : 'Export now'}
            </Button>

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
                  <label className="mb-1.5 block text-[13px] text-gray-500">Frequency</label>
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
                    <label className="mb-1.5 block text-[13px] text-gray-500">Day</label>
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
                  <label className="mb-1.5 block text-[13px] text-gray-500">Time</label>
                  <Input type="time" value={exportSchedule.time || '08:00'} onChange={(e) => updateScheduleField('time', e.target.value)} className="h-8 w-28 text-[13px] rounded-sm" />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] text-gray-500">Format</label>
                  <div className="flex gap-1.5">
                    {(['markdown', 'json', 'csv'] as const).map((fmt) => (
                      <SegmentButton key={fmt} active={exportSchedule.format === fmt} onClick={() => updateScheduleField('format', fmt)}>
                        {fmt === 'markdown' ? 'Markdown' : fmt.toUpperCase()}
                      </SegmentButton>
                    ))}
                  </div>
                </div>

                <Button onClick={() => saveExportSchedule(exportSchedule)} disabled={scheduleSaving} variant="outline" className="w-full text-[13px] h-9 rounded-sm">
                  {scheduleSaving ? (<span className="flex items-center gap-2"><BrailleSpinner /> Saving...</span>) : 'Save schedule'}
                </Button>
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
                    className="text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-2">
                  {exportHistory.slice(0, 20).map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-sm border border-gray-100 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', entry.status === 'success' ? 'bg-green-500' : 'bg-red-400')} />
                          <span className="text-[13px] font-medium text-gray-900">
                            {entry.start_date === entry.end_date ? entry.start_date : `${entry.start_date} — ${entry.end_date}`}
                          </span>
                          <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">{entry.format}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[12px] text-gray-400">
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
                          className="ml-3 shrink-0 rounded-sm border border-gray-200 px-2.5 py-1 text-[12px] text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
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
              <span className="text-[13px] text-gray-500">Last sync</span>
              <span className="text-[13px] text-gray-900">{formatRelativeTime(lastSync)}</span>
            </div>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className="text-[13px] text-gray-900">{value}</span>
    </div>
  );
}

function SegmentButton({ children, active, onClick, small }: { children: React.ReactNode; active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-sm border text-[13px] font-medium transition-all',
        small ? 'px-2 py-1' : 'px-3 py-1.5',
        active
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Pill toggle that turns green when on. Used for every on/off switch in this
 * panel so the visual language is consistent regardless of underlying primitive.
 */
function GreenToggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-green-500' : 'bg-gray-200',
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
