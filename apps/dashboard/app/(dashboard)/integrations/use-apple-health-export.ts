'use client';

import { useState } from 'react';
import { isTauri } from '@/lib/tauri-utils';

type ExportFormat = 'markdown' | 'json' | 'csv';
type ExportWriteMode = 'overwrite' | 'append' | 'skip';
type ExportDatePreset = 'yesterday' | '7d' | '30d' | 'custom';

type ExportSchedule = {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  format: ExportFormat;
  time: string;
  day_of_week: number | null;
  folder_path: string | null;
  include_all_metrics: boolean;
  metric_types: string[] | null;
} | null;

type ExportHistoryEntry = {
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

interface UseAppleHealthExportParams {
  getToken: () => Promise<string | null>;
}

export function useAppleHealthExport({ getToken }: UseAppleHealthExportParams) {
// Export state
const [exportFormat, setExportFormat] = useState<'markdown' | 'json' | 'csv'>('markdown');
const [exportWriteMode, setExportWriteMode] = useState<'overwrite' | 'append' | 'skip'>('overwrite');
const [exportDatePreset, setExportDatePreset] = useState<'yesterday' | '7d' | '30d' | 'custom'>('7d');
const [exportStartDate, setExportStartDate] = useState(() => {
  const d = new Date(); d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
});
const [exportEndDate, setExportEndDate] = useState(() => new Date().toISOString().slice(0, 10));
const [exportLoading, setExportLoading] = useState(false);
const [exportResult, setExportResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
// Metric selection state
const [metricCatalog, setMetricCatalog] = useState<any[]>([]);
const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set());
const [metricsLoaded, setMetricsLoaded] = useState(false);
// Export schedule state
const [exportSchedule, setExportSchedule] = useState<{
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  format: 'markdown' | 'json' | 'csv';
  time: string;
  day_of_week: number | null;
  folder_path: string | null;
  include_all_metrics: boolean;
  metric_types: string[] | null;
} | null>(null);
const [scheduleLoaded, setScheduleLoaded] = useState(false);
const [scheduleSaving, setScheduleSaving] = useState(false);
// Export history state
const [exportHistory, setExportHistory] = useState<Array<{
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
}>>([]);
const [historyLoaded, setHistoryLoaded] = useState(false);
// ── Apple Health Metric Selection ────────────────────────────────
async function loadMetricCatalogAndPreferences() {
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
}

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

// ── Apple Health Export ───────────────────────────────────────────
function applyExportDatePreset(preset: 'yesterday' | '7d' | '30d' | 'custom') {
  setExportDatePreset(preset);
  const today = new Date();
  if (preset === 'yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    setExportStartDate(y.toISOString().slice(0, 10));
    setExportEndDate(y.toISOString().slice(0, 10));
  } else if (preset === '7d') {
    const s = new Date(today); s.setDate(s.getDate() - 7);
    setExportStartDate(s.toISOString().slice(0, 10));
    setExportEndDate(today.toISOString().slice(0, 10));
  } else if (preset === '30d') {
    const s = new Date(today); s.setDate(s.getDate() - 30);
    setExportStartDate(s.toISOString().slice(0, 10));
    setExportEndDate(today.toISOString().slice(0, 10));
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
      // Desktop: use Tauri save dialog
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        exportedContent = exportFormat === 'json' ? JSON.stringify(await res.json(), null, 2) : await res.text();
        const filePath = await save({
          defaultPath: filename,
          filters: [
            { name: ext.toUpperCase(), extensions: [ext] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (filePath) {
          if (exportWriteMode === 'skip') {
            // Check if file exists first
            try {
              const { exists } = await import('@tauri-apps/plugin-fs');
              if (await exists(filePath)) {
                setExportResult({ type: 'success', message: `Skipped — file already exists: ${filePath}` });
                return;
              }
            } catch {
              // exists() may not be available, fall through to write
            }
          }
          if (exportWriteMode === 'append') {
            try {
              const { readTextFile } = await import('@tauri-apps/plugin-fs');
              const existing = await readTextFile(filePath);
              exportedContent = existing + '\n\n' + exportedContent;
            } catch {
              // File doesn't exist yet, write fresh
            }
          }
          await writeTextFile(filePath, exportedContent);
          exportedPath = filePath;
          setExportResult({ type: 'success', message: `Exported to ${filePath}` });
        }
      } catch (tauriErr) {
        // Fallback to browser download if Tauri API unavailable
        exportedContent = exportFormat === 'json' ? JSON.stringify(await res.clone().json(), null, 2) : await res.clone().text();
        downloadBlob(exportedContent, filename, res.headers.get('content-type') || 'text/plain');
        setExportResult({ type: 'success', message: `Downloaded ${filename}` });
      }
    } else {
      // Browser: trigger download
      exportedContent = exportFormat === 'json' ? JSON.stringify(await res.json(), null, 2) : await res.text();
      downloadBlob(exportedContent, filename, res.headers.get('content-type') || 'text/plain');
      setExportResult({ type: 'success', message: `Downloaded ${filename}` });
    }

    // Record export history
    recordExportHistory({
      start_date: exportStartDate,
      end_date: exportEndDate,
      format: exportFormat,
      status: 'success',
      sample_count: exportedContent.length,
      file_size_bytes: new Blob([exportedContent]).size,
      file_path: exportedPath,
      triggered_by: 'manual',
    });
  } catch (err: any) {
    setExportResult({ type: 'error', message: err.message || 'Export failed' });
    // Record failed export
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

// ── Export Schedule ──────────────────────────────────────────────
async function loadExportSchedule() {
  if (scheduleLoaded) return;
  try {
    const token = await getToken();
    if (!token) return;
    const res = await fetch('/api/wearables/apple/export-schedule', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.schedule) {
        setExportSchedule(data.schedule);
      }
    }
  } catch (err) {
    console.error('Failed to load export schedule:', err);
  } finally {
    setScheduleLoaded(true);
  }
}

async function saveExportSchedule(schedule: typeof exportSchedule) {
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

function updateScheduleField<K extends keyof NonNullable<typeof exportSchedule>>(
  field: K,
  value: NonNullable<typeof exportSchedule>[K],
) {
  setExportSchedule(prev => {
    const base = prev || {
      enabled: false,
      frequency: 'daily' as const,
      format: 'markdown' as const,
      time: '08:00',
      day_of_week: null,
      folder_path: null,
      include_all_metrics: true,
      metric_types: null,
    };
    return { ...base, [field]: value };
  });
}

// ── Export History ─────────────────────────────────────────────────
async function loadExportHistory() {
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
}

async function recordExportHistory(entry: {
  start_date: string;
  end_date: string;
  format: string;
  status: 'success' | 'failed';
  sample_count: number;
  file_size_bytes: number | null;
  file_path?: string | null;
  error?: string | null;
  triggered_by: 'manual' | 'scheduled';
}) {
  try {
    const token = await getToken();
    if (!token) return;
    const fullEntry = {
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
    // Refresh history
    setExportHistory(prev => [fullEntry, ...prev].slice(0, 50));
  } catch (err) {
    console.error('Failed to record export history:', err);
  }
}


  return {
    applyExportDatePreset,
    exportDatePreset,
    exportEndDate,
    exportFormat,
    exportHistory,
    exportLoading,
    exportResult,
    exportSchedule,
    exportStartDate,
    exportWriteMode,
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
    setExportDatePreset,
    setExportEndDate,
    setExportFormat,
    setExportHistory,
    setExportStartDate,
    setExportWriteMode,
    updateScheduleField,
  };
}
