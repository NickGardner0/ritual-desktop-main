'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  Shield,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
  RefreshCw,
  Clock,
  Database,
  Monitor,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { useHabits } from '@/contexts/HabitsContext';
import { ensureComputerTimeHabit } from '@/lib/ensure-computer-time-habit';
import { cn } from '@/lib/utils';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

interface WatcherConfig {
  device_id: string;
  user_id: string;
  poll_interval_ms: number;
  title_mode: 'off' | 'full' | 'truncate' | 'hash';
  truncate_length: number;
  excluded_bundle_ids: string[];
  afk_timeout_seconds?: number;
  url_mode?: string;
  track_incognito?: boolean;
  browser_heartbeat_port?: number;
}

interface WatcherStatus {
  is_running: boolean;
  pid: number | null;
  device_id: string | null;
}

interface BrowserExtensionDiagnostics {
  extension_installed: boolean;
  watcher_reachable: boolean;
  heartbeat_live: boolean;
  watcher_server_url: string | null;
  current_listener_port: number | null;
  watcher_pid: number | null;
  duplicate_watcher_detected: boolean;
  browser_heartbeat_port_mismatch: boolean;
  last_browser_extension_heartbeat_ts: number | null;
  seconds_since_browser_extension_heartbeat: number | null;
  context_enabled: boolean;
  context_quality: string;
  recent_context_snapshot_count: number;
  recent_browser_snapshot_count: number;
  recent_accessibility_snapshot_count: number;
  recent_metadata_fallback_count: number;
  last_context_snapshot_ts: number | null;
  seconds_since_context_snapshot: number | null;
  context_note: string;
  detection_note: string;
}

interface LocalRetrievalHealth {
  latest_context_snapshots_ts: number | null;
  latest_session_retrieval_docs_ts: number | null;
  context_snapshot_count: number;
  session_retrieval_doc_count: number;
  memory_upload_outbox: {
    pending: number;
    uploading: number;
    failed: number;
    uploaded: number;
    total: number;
  };
}

interface RetrievalHealth {
  latest_context_snapshots_ts: number | null;
  latest_session_retrieval_docs_ts: number | null;
  memory_upload_outbox?: {
    pending?: number;
    uploading?: number;
    failed?: number;
  };
  cloud_embedding_freshness?: {
    latest_cloud_chunk_ts?: number | null;
  };
  cloud_index?: {
    current_user_chunk_count?: number;
    current_user_embedded_chunk_count?: number;
  };
  lane_readiness?: {
    semantic_ready?: boolean;
  };
  summary?: {
    overall_status?: string;
    primary_source_selected?: string;
    degradation_reasons?: string[];
  };
}

const TITLE_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'truncate', label: 'Truncated' },
  { value: 'hash', label: 'Hashed' },
  { value: 'full', label: 'Full' },
] as const;

const SENSITIVE_APPS = [
  { bundle_id: 'com.1password', name: '1Password' },
  { bundle_id: 'com.lastpass', name: 'LastPass' },
  { bundle_id: 'com.bitwarden', name: 'Bitwarden' },
  { bundle_id: 'com.apple.keychainaccess', name: 'Keychain Access' },
  { bundle_id: 'com.apple.MobileSMS', name: 'Messages' },
];

const WATCHER_CACHE_KEY = 'ritual_watcher_state';

interface CachedWatcherState {
  isRunning: boolean;
  isEnabled: boolean;
  accessibilityGranted: boolean;
  deviceId: string | null;
  titleMode: 'off' | 'full' | 'truncate' | 'hash';
  timestamp: number;
}

function getCachedState(): CachedWatcherState | null {
  try {
    const cached = localStorage.getItem(WATCHER_CACHE_KEY);
    if (cached) {
      const state = JSON.parse(cached) as CachedWatcherState;
      if (Date.now() - state.timestamp < 60 * 60 * 1000) {
        return state;
      }
    }
  } catch (e) {
    console.warn('Failed to read cached watcher state:', e);
  }
  return null;
}

function setCachedState(state: Omit<CachedWatcherState, 'timestamp'>) {
  try {
    localStorage.setItem(WATCHER_CACHE_KEY, JSON.stringify({
      ...state,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('Failed to cache watcher state:', e);
  }
}

interface ComputerTrackingSettingsProps {
  userId: string;
  showRetrievalHealth?: boolean;
  onClose?: () => void;
}

export function ComputerTrackingSettings({ userId, showRetrievalHealth = false, onClose }: ComputerTrackingSettingsProps) {
  const { getToken } = useAuth();
  const { habits, createHabit, fetchHabits } = useHabits();
  const cachedState = useRef(getCachedState());

  const [isLoading, setIsLoading] = useState(true);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Watcher state
  const [isEnabled, setIsEnabled] = useState(cachedState.current?.isEnabled ?? false);
  const [isRunning, setIsRunning] = useState(cachedState.current?.isRunning ?? false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(cachedState.current?.accessibilityGranted ?? false);
  const [deviceId, setDeviceId] = useState<string | null>(cachedState.current?.deviceId ?? null);

  // Settings
  const [titleMode, setTitleMode] = useState<'off' | 'full' | 'truncate' | 'hash'>(cachedState.current?.titleMode ?? 'off');
  const [pollInterval, setPollInterval] = useState(2000);
  const [excludedApps, setExcludedApps] = useState<string[]>([]);
  const [syncAnalytics, setSyncAnalytics] = useState(false);
  const [afkTimeout, setAfkTimeout] = useState(900);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserExtensionDiagnostics | null>(null);
  const [localRetrievalHealth, setLocalRetrievalHealth] = useState<LocalRetrievalHealth | null>(null);
  const [retrievalHealth, setRetrievalHealth] = useState<RetrievalHealth | null>(null);
  const [retrievalHealthLoading, setRetrievalHealthLoading] = useState(false);

  // ------ callbacks ------

  const syncToHabit = useCallback(async () => {
    try {
      setIsSyncing(true);
      const response = await fetch('/api/watcher/sync-to-habit', { method: 'POST' });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.synced) {
          setLastSyncTime(new Date());
        }
      }
    } catch (e) {
      console.error('Failed to sync to habit:', e);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!isRunning || !isEnabled) return;
    syncToHabit();
    const interval = setInterval(() => syncToHabit(), 3600000);
    return () => clearInterval(interval);
  }, [isRunning, isEnabled, syncToHabit]);

  const checkAccessibility = useCallback(async () => {
    try {
      const granted = await invoke<boolean>('check_accessibility_permission');
      setAccessibilityGranted(granted);
      return granted;
    } catch (e) {
      console.error('Failed to check accessibility:', e);
      return false;
    }
  }, []);

  const getStatus = useCallback(async () => {
    try {
      const status = await invoke<WatcherStatus>('get_watcher_status');
      setIsRunning(status.is_running);
      if (status.is_running) setIsEnabled(true);
      return status;
    } catch (e) {
      console.error('Failed to get watcher status:', e);
      return null;
    }
  }, []);

  const getBrowserExtensionDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await invoke<BrowserExtensionDiagnostics>('get_browser_extension_diagnostics');
      setBrowserDiagnostics(diagnostics);
      return diagnostics;
    } catch (e) {
      console.error('Failed to get browser extension diagnostics:', e);
      return null;
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [accessGranted, status, diagnostics] = await Promise.all([
        invoke<boolean>('check_accessibility_permission').catch(() => false),
        invoke<WatcherStatus>('get_watcher_status').catch(() => null),
        invoke<BrowserExtensionDiagnostics>('get_browser_extension_diagnostics').catch(() => null)
      ]);

      setAccessibilityGranted(accessGranted);
      if (status) {
        setIsRunning(status.is_running);
        if (status.is_running) setIsEnabled(true);
      }
      if (diagnostics) setBrowserDiagnostics(diagnostics);
      setIsStatusLoading(false);

      setCachedState({
        isRunning: status?.is_running ?? false,
        isEnabled: status?.is_running ?? false,
        accessibilityGranted: accessGranted,
        deviceId: deviceId,
        titleMode: titleMode
      });

      try {
        const response = await fetch(`/api/watcher/devices`);
        if (response.ok) {
          const data = await response.json();
          if (data.devices && data.devices.length > 0) {
            const device = data.devices[0];
            setDeviceId(device.device_id);
            if (!status?.is_running) setIsEnabled(device.is_enabled);
            setTitleMode(device.state?.title_mode || 'off');
            setPollInterval(device.state?.poll_interval_ms || 2000);
            setExcludedApps(device.state?.excluded_bundle_ids || []);
            setSyncAnalytics(device.state?.sync_analytics || false);
            setAfkTimeout(device.state?.afk_timeout_seconds || 900);

            setCachedState({
              isRunning: status?.is_running ?? false,
              isEnabled: status?.is_running || device.is_enabled,
              accessibilityGranted: accessGranted,
              deviceId: device.device_id,
              titleMode: device.state?.title_mode || 'off'
            });
          }
        }
      } catch (fetchErr) {
        console.log('Could not fetch watcher devices (using local state):', fetchErr);
      }
    } catch (e) {
      console.error('Failed to initialize watcher settings:', e);
    } finally {
      setIsLoading(false);
      setIsStatusLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    getBrowserExtensionDiagnostics();
    const interval = setInterval(() => getBrowserExtensionDiagnostics(), 15_000);
    return () => clearInterval(interval);
  }, [getBrowserExtensionDiagnostics]);

  const loadRetrievalHealth = useCallback(async () => {
    if (!showRetrievalHealth) return;
    setRetrievalHealthLoading(true);
    try {
      const [localHealth, backendHealth] = await Promise.all([
        invoke<LocalRetrievalHealth>('get_local_retrieval_health').catch(() => null),
        (async () => {
          try {
            const token = await getToken();
            const response = await fetch(`${PYTHON_API_BASE}/api/memory/diagnostics`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!response.ok) throw new Error(`Diagnostics failed: ${response.status}`);
            const payload = await response.json();
            return (payload?.retrieval_health ?? null) as RetrievalHealth | null;
          } catch { return null; }
        })(),
      ]);
      setLocalRetrievalHealth(localHealth);
      setRetrievalHealth(backendHealth);
    } finally {
      setRetrievalHealthLoading(false);
    }
  }, [getToken, showRetrievalHealth]);

  useEffect(() => {
    if (!showRetrievalHealth) return;
    void loadRetrievalHealth();
    const interval = setInterval(() => void loadRetrievalHealth(), 15_000);
    return () => clearInterval(interval);
  }, [loadRetrievalHealth, showRetrievalHealth]);

  const requestAccessibility = async () => {
    try {
      await invoke('request_accessibility_permission');
      setTimeout(async () => { await checkAccessibility(); }, 1000);
    } catch (e) {
      console.error('Failed to request accessibility:', e);
    }
  };

  const openAccessibilitySettings = async () => {
    try {
      await invoke('open_accessibility_settings');
    } catch (e) {
      console.error('Failed to open settings:', e);
    }
  };

  const toggleWatcher = async () => {
    if (!deviceId && !isEnabled) {
      try {
        const response = await fetch('/api/watcher/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_name: 'My Mac', platform: 'macos' })
        });
        if (!response.ok) throw new Error('Failed to register device');
        const data = await response.json();
        setDeviceId(data.device_id);
      } catch (e) {
        setError('Failed to register device');
        return;
      }
    }

    if (isEnabled) {
      try {
        await invoke('stop_watcher');
        await invoke('clear_watcher_config_cmd');
        setIsRunning(false);
        setIsEnabled(false);
        await getBrowserExtensionDiagnostics();
        setCachedState({ isRunning: false, isEnabled: false, accessibilityGranted, deviceId, titleMode });
        if (deviceId) {
          await fetch(`/api/watcher/devices/${deviceId}/stop`, { method: 'POST' });
        }
      } catch (e) {
        console.error('Failed to stop watcher:', e);
        setError('Failed to stop watcher');
      }
    } else {
      if (!accessibilityGranted) {
        requestAccessibility();
        return;
      }
      try {
        const config: WatcherConfig = {
          device_id: deviceId || '',
          user_id: userId,
          poll_interval_ms: pollInterval,
          title_mode: titleMode,
          truncate_length: 80,
          excluded_bundle_ids: excludedApps,
          afk_timeout_seconds: afkTimeout,
          url_mode: 'domain',
          track_incognito: false,
          browser_heartbeat_port: 8766,
        };
        await invoke('start_watcher', { config });
        await invoke('save_watcher_config_cmd', { config });
        setIsRunning(true);
        setIsEnabled(true);
        await getBrowserExtensionDiagnostics();
        setCachedState({ isRunning: true, isEnabled: true, accessibilityGranted, deviceId, titleMode });
        if (deviceId) {
          await fetch(`/api/watcher/devices/${deviceId}/start`, { method: 'POST' });
        }
      } catch (e) {
        console.error('Failed to start watcher:', e);
        setError('Failed to start watcher');
      }
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      try {
        await ensureComputerTimeHabit(habits, createHabit);
        await fetchHabits();
      } catch (e) {
        console.warn('Could not ensure Computer Time habit:', e);
      }

      if (!deviceId) return;

      const response = await fetch(`/api/watcher/devices/${deviceId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poll_interval_ms: pollInterval,
          title_mode: titleMode,
          excluded_bundle_ids: excludedApps,
          sync_analytics: syncAnalytics,
          afk_timeout_seconds: afkTimeout
        })
      });
      if (!response.ok) throw new Error('Failed to save settings');

      if (isRunning) {
        await invoke('stop_watcher');
        const config: WatcherConfig = {
          device_id: deviceId,
          user_id: userId,
          poll_interval_ms: pollInterval,
          title_mode: titleMode,
          truncate_length: 80,
          excluded_bundle_ids: excludedApps,
          afk_timeout_seconds: afkTimeout,
          url_mode: 'domain',
          track_incognito: false,
          browser_heartbeat_port: 8766,
        };
        await invoke('start_watcher', { config });
        await invoke('save_watcher_config_cmd', { config });
      }
    } catch (e) {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAppExclusion = (bundleId: string) => {
    if (excludedApps.includes(bundleId)) {
      setExcludedApps(excludedApps.filter(id => id !== bundleId));
    } else {
      setExcludedApps([...excludedApps, bundleId]);
    }
  };

  // ------ render ------

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-[13px] text-red-600">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Enable Watcher — hero toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900">Screen tracking</p>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {isRunning ? 'Tracking your computer usage' : 'Track which apps you use and for how long'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && !isStatusLoading && (
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          )}
          {isStatusLoading && !cachedState.current ? (
            <div className="flex h-[22px] w-[40px] items-center justify-center">
              <BrailleSpinner className="text-sm text-gray-400" />
            </div>
          ) : (
            <button
              onClick={toggleWatcher}
              disabled={isStatusLoading}
              className={cn(
                'relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
                isEnabled ? 'bg-gray-900' : 'bg-gray-200',
                isStatusLoading && 'opacity-50',
              )}
            >
              <span
                className={cn(
                  'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200',
                  isEnabled ? 'translate-x-[20px]' : 'translate-x-[2px]',
                )}
              />
            </button>
          )}
        </div>
      </div>

      {/* Accessibility — only show if not granted */}
      {!accessibilityGranted && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-[13px] font-medium text-amber-900">Accessibility permission required</p>
            <p className="mt-0.5 text-[13px] text-amber-700">Grant access so Ritual can read window titles.</p>
          </div>
          <button
            onClick={openAccessibilitySettings}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[13px] font-medium text-amber-900 transition-colors hover:bg-amber-50"
          >
            Open Settings
          </button>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Sync to Habit */}
      {isEnabled && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <RefreshCw className={cn('h-4 w-4 text-gray-400', isSyncing && 'animate-spin')} />
            <div>
              <p className="text-sm text-gray-900">Sync to habit</p>
              {lastSyncTime && (
                <p className="text-[13px] text-gray-400">
                  Last synced {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={syncToHabit}
            disabled={isSyncing}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}

      {/* Window Titles */}
      <div>
        <div className="mb-2.5 flex items-center gap-2.5">
          {titleMode === 'off' ? (
            <EyeOff className="h-4 w-4 text-gray-400" />
          ) : (
            <Eye className="h-4 w-4 text-gray-400" />
          )}
          <p className="text-sm font-medium text-gray-900">Window titles</p>
        </div>
        <div className="flex gap-1.5">
          {TITLE_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setTitleMode(option.value)}
              className={cn(
                'flex-1 rounded-lg border py-2 text-center text-[13px] font-medium transition-all',
                titleMode === option.value
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Idle Timeout */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-gray-400" />
            <p className="text-sm font-medium text-gray-900">Idle timeout</p>
          </div>
          <span className="text-[13px] text-gray-500">
            {afkTimeout >= 60 ? `${Math.round(afkTimeout / 60)} min` : `${afkTimeout} sec`}
          </span>
        </div>
        <input
          type="range"
          min="300"
          max="3600"
          step="60"
          value={afkTimeout}
          onChange={(e) => setAfkTimeout(parseInt(e.target.value))}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-900"
        />
        <div className="mt-1.5 flex justify-between text-[12px] text-gray-400">
          <span>5 min</span>
          <span>15 min</span>
          <span>30 min</span>
          <span>60 min</span>
        </div>
        <p className="mt-2 text-[13px] text-gray-500">
          Time without input before marking as idle. Longer = captures reading/thinking time.
        </p>
      </div>

      {/* Excluded Apps */}
      <div>
        <div className="mb-2.5 flex items-center gap-2.5">
          <Shield className="h-4 w-4 text-gray-400" />
          <p className="text-sm font-medium text-gray-900">Excluded apps</p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {SENSITIVE_APPS.map((app) => {
            const isExcluded = excludedApps.includes(app.bundle_id);
            return (
              <label
                key={app.bundle_id}
                className="flex cursor-pointer items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => toggleAppExclusion(app.bundle_id)}
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                    isExcluded ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white',
                  )}
                >
                  {isExcluded && <Check className="h-3 w-3 text-white" />}
                </button>
                <span className="text-[13px] text-gray-700">{app.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Sync Analytics */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-900">Sync analytics to cloud</p>
        <button
          onClick={() => setSyncAnalytics(!syncAnalytics)}
          className={cn(
            'relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
            syncAnalytics ? 'bg-gray-900' : 'bg-gray-200',
          )}
        >
          <span
            className={cn(
              'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200',
              syncAnalytics ? 'translate-x-[20px]' : 'translate-x-[2px]',
            )}
          />
        </button>
      </div>

      {/* ================================================================ */}
      {/* Developer-only: Retrieval Health diagnostics                     */}
      {/* ================================================================ */}
      {showRetrievalHealth && (
        <>
          <div className="border-t border-gray-100" />
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Database className="h-4 w-4 text-gray-400" />
                <p className="text-sm font-medium text-gray-900">Retrieval Health</p>
              </div>
              <div className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', retrievalHealthStatusClass(retrievalHealth?.summary?.overall_status))}>
                {retrievalHealthLoading ? 'Loading...' : (retrievalHealth?.summary?.overall_status || 'Unavailable')}
              </div>
            </div>

            {/* Browser Extension diagnostics (dev only) */}
            {browserDiagnostics && (
              <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Browser Extension</div>
                <DiagRow label="Extension installed" value={browserDiagnostics.extension_installed ? 'Detected' : 'Unknown'} ok={browserDiagnostics.extension_installed} />
                <DiagRow label="Watcher reachable" value={browserDiagnostics.watcher_reachable ? `Yes (${browserDiagnostics.watcher_server_url ?? 'localhost'})` : 'No'} ok={browserDiagnostics.watcher_reachable} />
                <DiagRow label="Listener port / PID" value={`${browserDiagnostics.current_listener_port ?? '-'} / ${browserDiagnostics.watcher_pid ?? '-'}`} />
                <DiagRow label="Heartbeat live" value={browserDiagnostics.heartbeat_live ? `Yes (${browserDiagnostics.seconds_since_browser_extension_heartbeat ?? 0}s ago)` : 'No'} ok={browserDiagnostics.heartbeat_live} />
                <DiagRow label="Duplicate watcher" value={browserDiagnostics.duplicate_watcher_detected ? 'Detected' : 'No'} ok={!browserDiagnostics.duplicate_watcher_detected} />
                <DiagRow label="Port mismatch" value={browserDiagnostics.browser_heartbeat_port_mismatch ? 'Detected' : 'No'} ok={!browserDiagnostics.browser_heartbeat_port_mismatch} />
                <DiagRow label="Context enabled" value={browserDiagnostics.context_enabled ? `Yes (${browserDiagnostics.context_quality})` : (browserDiagnostics.context_quality || 'Unknown')} ok={browserDiagnostics.context_enabled} />
                <DiagRow label="Recent snapshots" value={String(browserDiagnostics.recent_context_snapshot_count ?? 0)} />
                <DiagRow label="Browser / native / fallback" value={`${browserDiagnostics.recent_browser_snapshot_count ?? 0} / ${browserDiagnostics.recent_accessibility_snapshot_count ?? 0} / ${browserDiagnostics.recent_metadata_fallback_count ?? 0}`} />
                {browserDiagnostics.detection_note && <p className="text-[11px] text-gray-500">{browserDiagnostics.detection_note}</p>}
                {browserDiagnostics.context_note && <p className="text-[11px] text-gray-500">{browserDiagnostics.context_note}</p>}
              </div>
            )}

            <div className="space-y-2.5">
              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Local Capture</div>
                <DiagRow label="Latest context capture" value={formatDebugTimestamp(localRetrievalHealth?.latest_context_snapshots_ts)} />
                <DiagRow label="Latest session doc" value={formatDebugTimestamp(localRetrievalHealth?.latest_session_retrieval_docs_ts)} />
                <DiagRow label="Local session docs" value={String(localRetrievalHealth?.session_retrieval_doc_count ?? 0)} />
                <DiagRow label="Upload outbox" value={`${localRetrievalHealth?.memory_upload_outbox?.pending ?? 0} pending / ${localRetrievalHealth?.memory_upload_outbox?.total ?? 0} total`} />
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Backend / Cloud</div>
                <DiagRow label="Latest backend context" value={formatDebugTimestamp(retrievalHealth?.latest_context_snapshots_ts)} />
                <DiagRow label="Latest backend session doc" value={formatDebugTimestamp(retrievalHealth?.latest_session_retrieval_docs_ts)} />
                <DiagRow label="Latest cloud chunk" value={formatDebugTimestamp(retrievalHealth?.cloud_embedding_freshness?.latest_cloud_chunk_ts)} />
                <DiagRow label="Cloud embedded docs" value={`${retrievalHealth?.cloud_index?.current_user_embedded_chunk_count ?? 0} / ${retrievalHealth?.cloud_index?.current_user_chunk_count ?? 0}`} />
                <DiagRow label="Primary source" value={String(retrievalHealth?.summary?.primary_source_selected || 'unknown')} />
                <DiagRow label="Fail-open mode" value={retrievalHealth?.lane_readiness?.semantic_ready ? 'Cloud primary' : 'Cloud degraded'} />
                {retrievalHealthMismatchNote(localRetrievalHealth, retrievalHealth) && (
                  <p className="text-[11px] text-amber-700">
                    {retrievalHealthMismatchNote(localRetrievalHealth, retrievalHealth)}
                  </p>
                )}
                {Array.isArray(retrievalHealth?.summary?.degradation_reasons) && retrievalHealth.summary.degradation_reasons.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Degradation reasons</div>
                    <div className="flex flex-wrap gap-1">
                      {retrievalHealth.summary.degradation_reasons.map((reason) => (
                        <span key={reason} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Save / Cancel */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[13px] text-gray-500 transition-colors hover:text-gray-700"
          >
            Cancel
          </button>
        )}
        <button
          onClick={saveSettings}
          disabled={isSaving}
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
        >
          {isSaving && <BrailleSpinner className="text-xs text-white" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function DiagRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={cn('text-right', ok === true ? 'text-green-700' : ok === false ? 'text-red-700' : 'text-gray-900')}>
        {value}
      </span>
    </div>
  );
}

function formatDebugTimestamp(value: unknown): string {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return 'Unavailable';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function retrievalHealthStatusClass(status?: string): string {
  if (status === 'Healthy') return 'border-green-200 bg-green-50 text-green-700';
  if (status === 'Catching up') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'Degraded but usable') return 'border-orange-200 bg-orange-50 text-orange-700';
  return 'border-red-200 bg-red-50 text-red-700';
}

function retrievalHealthMismatchNote(
  localRetrievalHealth: LocalRetrievalHealth | null,
  retrievalHealth: RetrievalHealth | null,
): string | null {
  const localTs = Number(localRetrievalHealth?.latest_session_retrieval_docs_ts || 0);
  const backendTs = Number(retrievalHealth?.latest_session_retrieval_docs_ts || 0);
  if (!localTs) return null;
  if (!backendTs) {
    return 'Local capture is active, but the backend/cloud pipeline has not observed any recent session docs yet.';
  }
  if (localTs - backendTs > 5 * 60 * 1000) {
    return 'Local capture is newer than backend/cloud ingestion. The backend pipeline is still catching up.';
  }
  return null;
}
