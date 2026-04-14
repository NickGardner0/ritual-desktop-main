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
import { ChevronRight, ChevronDown } from 'lucide-react';
import { isTauri } from '@/lib/tauri-utils';
import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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

  // Data queries
  const { data: statusData } = useAppleWatchStatus();
  const { data: connection } = useWearableConnection('apple_health');

  const connected = statusData?.connected || false;
  const lastSync = statusData?.lastSyncAt;

  // Tab
  const [tab, setTab] = useState<AppleWatchTab>('overview');

  // Metric selection
  const [metricCatalog, setMetricCatalog] = useState<any[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set());
  const [metricsLoaded, setMetricsLoaded] = useState(false);

  // Metric save feedback
  const [metricSaveStatus, setMetricSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const metricSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Export
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

  // Schedule
  const [exportSchedule, setExportSchedule] = useState<ExportSchedule | null>(null);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // History
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

  // Auto-load data when connected
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
    // Optimistically update the local set
    const next = new Set(selectedMetrics);
    if (enabled) {
      next.add(metricType);
    } else {
      next.delete(metricType);
    }
    setSelectedMetrics(next);

    // Auto-save
    try {
      await saveMetricPreferences(Array.from(next));
      setMetricSaveStatus({ type: 'success', message: `${next.size} metrics selected` });
    } catch {
      // Revert on failure
      setSelectedMetrics(selectedMetrics);
      setMetricSaveStatus({ type: 'error', message: 'Failed to save' });
    }

    // Clear status after a short delay
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

      // Invalidate queries to refresh data
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

      if (!confirm('Are you sure you want to disconnect Apple Watch? You can reconnect using the Ritual iOS companion app.')) {
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
      alert('Apple Watch disconnected successfully. You can reconnect using the Ritual iOS companion app.');
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

  return (
    <div className="space-y-4">
      {/* Connection status badge */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900">Apple Watch</span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium',
            connected
              ? 'border-gray-200 bg-gray-50 text-gray-900'
              : 'border-gray-200 bg-white text-gray-500',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-gray-900' : 'bg-gray-400')} />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {/* Tab bar */}
      <div className="inline-flex items-center rounded-sm border border-gray-200 bg-gray-50 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
              tab === t.key
                ? 'border border-gray-200 bg-white text-gray-900'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <section className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">How it works</p>
            <div className="mt-3 space-y-3 text-sm text-gray-500">
              <div>
                <p className="font-medium text-gray-900">Companion sync</p>
                <p className="mt-0.5 text-xs leading-relaxed">
                  Sync health data from your iPhone companion app, including workouts, steps, heart rate, sleep, body measurements, nutrition, vitals, and mobility metrics.
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-900">Selected metrics only</p>
                <p className="mt-0.5 text-xs leading-relaxed">
                  Choose exactly which Apple Health metrics should create or update habits inside Ritual.
                </p>
              </div>
            </div>
          </section>

          {connected && (
            <>
              <section className="rounded-sm border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">Sync status</p>
                </div>
                <div className="divide-y divide-gray-100">
                  <Row label="Last sync" value={formatRelativeTime(lastSync)} />
                  <Row label="Tracked metrics" value={`${selectedMetrics.size} selected`} />
                  <Row label="Device" value={statusData?.deviceName || 'iPhone'} />
                </div>
              </section>

              <section className="rounded-sm border border-gray-200 bg-white">
                <NavRow label="Metrics" description="Choose what to track" onClick={() => setTab('metrics')} />
                <NavRow label="Export" description="Download your data" onClick={() => setTab('export')} border />
                <NavRow label="Settings" description="Control sync behavior" onClick={() => setTab('settings')} last />
              </section>
            </>
          )}

          {!connected && (
            <div className="rounded-sm border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
              <p className="text-sm font-medium text-gray-900">Not connected</p>
              <p className="mt-1 text-xs text-gray-500">Open the Ritual Companion app on your iPhone to connect.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'metrics' && connected && (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">Metrics</p>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
              Toggle which health metrics to sync from your Apple Watch and iPhone.
            </p>
          </div>

          {metricCatalog.length > 0 ? (
            metricCatalog.map((category: any) => (
              <MetricCategoryCard
                key={category.category}
                category={category}
                selected={selectedMetrics}
                onToggle={handleMetricToggle}
              />
            ))
          ) : (
            <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
              <BrailleSpinner /> Loading metrics…
            </div>
          )}

          {metricSaveStatus && (
            <p className={cn('text-[11px] text-center', metricSaveStatus.type === 'success' ? 'text-green-600' : 'text-red-500')}>
              {metricSaveStatus.message}
            </p>
          )}
        </div>
      )}

      {tab === 'export' && connected && (
        <div className="space-y-4">
          {/* Manual export */}
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">Export data</p>
            <div className="mt-3 space-y-3">
              {/* Date range */}
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Date range</label>
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {([['yesterday', 'Yesterday'], ['7d', '7 Days'], ['30d', '30 Days'], ['custom', 'Custom']] as const).map(([key, label]) => (
                    <PillButton key={key} active={exportDatePreset === key} onClick={() => applyExportDatePreset(key)}>
                      {label}
                    </PillButton>
                  ))}
                </div>
                {exportDatePreset === 'custom' ? (
                  <div className="flex items-center gap-2">
                    <Input type="date" value={exportStartDate} onChange={(e) => setExportStartDate(e.target.value)} className="h-7 w-32 text-xs" />
                    <span className="text-xs text-gray-400">to</span>
                    <Input type="date" value={exportEndDate} onChange={(e) => setExportEndDate(e.target.value)} className="h-7 w-32 text-xs" />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">{exportStartDate} &mdash; {exportEndDate}</p>
                )}
              </div>

              {/* Format */}
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Format</label>
                <div className="flex gap-1.5">
                  {([['markdown', 'Markdown'], ['json', 'JSON'], ['csv', 'CSV']] as const).map(([key, label]) => (
                    <PillButton key={key} active={exportFormat === key} onClick={() => setExportFormat(key)}>
                      {label}
                    </PillButton>
                  ))}
                </div>
              </div>

              {/* Write mode (Tauri) */}
              {isTauri() && (
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Write mode</label>
                  <div className="flex flex-wrap gap-1.5">
                    {([['overwrite', 'Overwrite'], ['append', 'Append'], ['skip', 'Skip existing']] as const).map(([key, label]) => (
                      <PillButton key={key} active={exportWriteMode === key} onClick={() => setExportWriteMode(key)}>
                        {label}
                      </PillButton>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {exportWriteMode === 'overwrite' && 'Replace existing file'}
                    {exportWriteMode === 'append' && 'Add to end of existing file'}
                    {exportWriteMode === 'skip' && 'Skip if file already exists'}
                  </p>
                </div>
              )}

              <Button onClick={handleExportNow} disabled={exportLoading} className="w-full text-xs h-8">
                {exportLoading ? (
                  <span className="flex items-center gap-2"><BrailleSpinner /> Exporting…</span>
                ) : 'Export Now'}
              </Button>

              {exportResult && (
                <p className={cn('text-xs', exportResult.type === 'success' ? 'text-green-600' : 'text-red-500')}>
                  {exportResult.message}
                </p>
              )}
            </div>
          </div>

          {/* Scheduled export */}
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">Scheduled export</p>
              <Switch
                checked={Boolean(exportSchedule?.enabled)}
                onCheckedChange={(checked) => {
                  if (!scheduleLoaded) loadExportSchedule();
                  const updated: ExportSchedule = {
                    ...(exportSchedule || { enabled: false, frequency: 'daily', format: 'markdown', time: '08:00', day_of_week: null, folder_path: null, include_all_metrics: true, metric_types: null }),
                    enabled: checked,
                  };
                  setExportSchedule(updated);
                  saveExportSchedule(updated);
                }}
              />
            </div>

            {exportSchedule?.enabled ? (
              <div className="space-y-2.5">
                <div>
                  <label className="mb-0.5 block text-[10px] text-gray-500">Frequency</label>
                  <div className="flex gap-1.5">
                    {(['daily', 'weekly'] as const).map((freq) => (
                      <PillButton key={freq} active={exportSchedule.frequency === freq} onClick={() => updateScheduleField('frequency', freq)}>
                        {freq.charAt(0).toUpperCase() + freq.slice(1)}
                      </PillButton>
                    ))}
                  </div>
                </div>

                {exportSchedule.frequency === 'weekly' && (
                  <div>
                    <label className="mb-0.5 block text-[10px] text-gray-500">Day</label>
                    <div className="flex flex-wrap gap-1">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                        <PillButton key={day} active={exportSchedule.day_of_week === i} onClick={() => updateScheduleField('day_of_week', i)} small>
                          {day}
                        </PillButton>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-0.5 block text-[10px] text-gray-500">Time</label>
                  <Input type="time" value={exportSchedule.time || '08:00'} onChange={(e) => updateScheduleField('time', e.target.value)} className="h-7 w-28 text-xs" />
                </div>

                <div>
                  <label className="mb-0.5 block text-[10px] text-gray-500">Format</label>
                  <div className="flex gap-1.5">
                    {(['markdown', 'json', 'csv'] as const).map((fmt) => (
                      <PillButton key={fmt} active={exportSchedule.format === fmt} onClick={() => updateScheduleField('format', fmt)}>
                        {fmt === 'markdown' ? 'Markdown' : fmt.toUpperCase()}
                      </PillButton>
                    ))}
                  </div>
                </div>

                <Button onClick={() => saveExportSchedule(exportSchedule)} disabled={scheduleSaving} variant="outline" className="w-full text-xs h-8">
                  {scheduleSaving ? (<span className="flex items-center gap-2"><BrailleSpinner /> Saving…</span>) : 'Save schedule'}
                </Button>

                <p className="text-[10px] text-gray-400">
                  {exportSchedule.frequency === 'daily'
                    ? `Exports daily at ${exportSchedule.time || '08:00'}`
                    : `Exports every ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][exportSchedule.day_of_week ?? 0]} at ${exportSchedule.time || '08:00'}`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Turn this on to automatically export Apple Watch data on a schedule.</p>
            )}
          </div>

          {/* History */}
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">History</p>
            <div className="space-y-1.5">
              {exportHistory.length === 0 ? (
                <p className="py-2 text-center text-xs text-gray-500">No exports yet</p>
              ) : (
                exportHistory.slice(0, 20).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-sm border border-gray-100 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', entry.status === 'success' ? 'bg-green-500' : 'bg-red-400')} />
                        <span className="text-xs font-medium text-gray-900">
                          {entry.start_date === entry.end_date ? entry.start_date : `${entry.start_date} — ${entry.end_date}`}
                        </span>
                        <span className="rounded-sm bg-gray-100 px-1 py-0.5 text-[9px] font-medium uppercase text-gray-500">{entry.format}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
                        <span>{new Date(entry.timestamp).toLocaleString()}</span>
                        {entry.file_size_bytes != null && <span>{(entry.file_size_bytes / 1024).toFixed(1)} KB</span>}
                        <span className="capitalize">{entry.triggered_by}</span>
                      </div>
                      {entry.error && <p className="mt-0.5 text-[10px] text-red-500">{entry.error}</p>}
                    </div>
                    {entry.status === 'failed' && (
                      <button
                        onClick={() => {
                          setExportStartDate(entry.start_date);
                          setExportEndDate(entry.end_date);
                          setExportFormat(entry.format as 'markdown' | 'json' | 'csv');
                          setExportDatePreset('custom');
                        }}
                        className="ml-2 shrink-0 rounded-sm border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))
              )}
              {exportHistory.length > 0 && (
                <button
                  onClick={() => setExportHistory([])}
                  className="mt-1 text-[10px] text-gray-400 underline hover:text-gray-600"
                >
                  Clear history
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'settings' && connected && (
        <div className="space-y-3">
          {/* Auto sync */}
          <div className="rounded-sm border border-gray-200 bg-white">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">Auto sync</p>
                <p className="mt-0.5 text-xs text-gray-900">Keep Apple Watch updated automatically.</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={autoSyncEnabled}
                  onCheckedChange={(checked) => handleSyncSettingsUpdate({ auto_sync_enabled: checked, sync_hour: syncHour })}
                />
                <span className="text-xs text-gray-700">{autoSyncEnabled ? 'On' : 'Off'}</span>
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 px-3 py-3">
              <div>
                <p className="text-xs text-gray-900">Preferred sync time</p>
                <p className="mt-0.5 text-[10px] text-gray-500">Choose the hour for background refreshes.</p>
              </div>
              <Select
                value={String(syncHour)}
                onValueChange={(value) => handleSyncSettingsUpdate({ auto_sync_enabled: autoSyncEnabled, sync_hour: Number(value) })}
                disabled={!autoSyncEnabled}
              >
                <SelectTrigger className="h-7 w-[120px] text-xs">
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

            <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">Last sync</span>
              <span className="text-xs text-gray-900">{formatRelativeTime(lastSync)}</span>
            </div>
          </div>

          {/* Danger zone */}
          <div className="rounded-sm border border-gray-200 bg-white p-3">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">Danger zone</p>
            <p className="mb-2 text-xs text-gray-500">Disconnect this integration. Your synced data will remain in Ritual.</p>
            <button
              onClick={handleDisconnect}
              className="rounded-sm border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50/60"
            >
              Disconnect Apple Watch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-900">{value}</span>
    </div>
  );
}

function NavRow({ label, description, onClick, border, last }: { label: string; description: string; onClick: () => void; border?: boolean; last?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-gray-50',
        !last && 'border-b border-gray-100',
      )}
    >
      <div>
        <p className="text-xs font-medium text-gray-900">{label}</p>
        <p className="mt-0.5 text-[10px] text-gray-500">{description}</p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
    </button>
  );
}

function PillButton({ children, active, onClick, small }: { children: React.ReactNode; active: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-sm border text-xs font-medium transition-colors',
        small ? 'px-1.5 py-0.5' : 'px-2.5 py-1',
        active
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Granola-style metric toggle cards
// ---------------------------------------------------------------------------

/** Icons for metric categories — maps category name to an emoji/symbol */
const CATEGORY_ICONS: Record<string, string> = {
  Activity: '🏃',
  'Body Measurements': '📐',
  'Heart & Vitals': '❤️',
  Heart: '❤️',
  Vitals: '🫀',
  Sleep: '😴',
  Nutrition: '🍎',
  Mobility: '🦿',
  Mindfulness: '🧘',
  Reproductive: '🩺',
  Workouts: '💪',
  Other: '📊',
};

function getCategoryIcon(category: string): string {
  // Exact match first, then partial match
  if (CATEGORY_ICONS[category]) return CATEGORY_ICONS[category];
  const lower = category.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (lower.includes(key.toLowerCase())) return icon;
  }
  return '📊';
}

function MetricCategoryCard({
  category,
  selected,
  onToggle,
}: {
  category: { category: string; metrics: { type: string; name: string; unit: string }[] };
  selected: Set<string>;
  onToggle: (metricType: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const metrics = category.metrics || [];
  const enabledCount = metrics.filter((m) => selected.has(m.type)).length;
  const icon = getCategoryIcon(category.category);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Category header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-gray-50/50 transition-colors"
      >
        <span className="text-base leading-none">{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-gray-900">{category.category}</span>
          <span className="ml-1.5 text-[11px] text-gray-400">{enabledCount}/{metrics.length}</span>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-gray-400 transition-transform duration-200',
            !expanded && '-rotate-90',
          )}
        />
      </button>

      {/* Metric rows */}
      {expanded && (
        <div className="border-t border-dashed border-gray-200">
          {metrics.map((metric, i) => {
            const isEnabled = selected.has(metric.type);
            return (
              <div
                key={metric.type}
                className={cn(
                  'flex items-center gap-3 px-3.5 py-2.5',
                  i < metrics.length - 1 && 'border-b border-dashed border-gray-100',
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-900 leading-tight">{metric.name}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">{metric.unit}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  onClick={() => onToggle(metric.type, !isEnabled)}
                  className={cn(
                    'relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
                    isEnabled ? 'bg-[#4a4a2e]' : 'bg-gray-200',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200',
                      isEnabled ? 'translate-x-[20px]' : 'translate-x-[2px]',
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
