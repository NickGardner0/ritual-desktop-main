'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Monitor, 
  Shield, 
  Eye, 
  EyeOff, 
  ChevronRight, 
  AlertCircle,
  Check,
  X,
  RefreshCw,
  Settings2,
  Lock,
  Unlock,
  Activity,
  Clock
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

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

interface DeviceState {
  device_id: string;
  is_enabled: boolean;
  poll_interval_ms: number;
  accessibility_status: 'unknown' | 'granted' | 'denied';
  title_mode: 'off' | 'full' | 'truncate' | 'hash';
  excluded_bundle_ids: string[];
  sync_analytics: boolean;
  afk_timeout_seconds: number;
}

const TITLE_MODE_OPTIONS = [
  { value: 'off', label: 'Off', description: 'Only track app usage, not window titles' },
  { value: 'truncate', label: 'Truncated', description: 'Store first 80 characters of window titles' },
  { value: 'hash', label: 'Hashed', description: 'Store privacy-preserving hash of titles' },
  { value: 'full', label: 'Full', description: 'Store complete window titles' },
] as const;

const SENSITIVE_APPS = [
  { bundle_id: 'com.1password', name: '1Password' },
  { bundle_id: 'com.lastpass', name: 'LastPass' },
  { bundle_id: 'com.bitwarden', name: 'Bitwarden' },
  { bundle_id: 'com.apple.keychainaccess', name: 'Keychain Access' },
  { bundle_id: 'com.apple.MobileSMS', name: 'Messages' },
];

// LocalStorage key for caching watcher state
const WATCHER_CACHE_KEY = 'ritual_watcher_state';

interface CachedWatcherState {
  isRunning: boolean;
  isEnabled: boolean;
  accessibilityGranted: boolean;
  deviceId: string | null;
  titleMode: 'off' | 'full' | 'truncate' | 'hash';
  timestamp: number;
}

// Helper to get cached state from localStorage
function getCachedState(): CachedWatcherState | null {
  try {
    const cached = localStorage.getItem(WATCHER_CACHE_KEY);
    if (cached) {
      const state = JSON.parse(cached) as CachedWatcherState;
      // Only use cache if less than 1 hour old
      if (Date.now() - state.timestamp < 60 * 60 * 1000) {
        return state;
      }
    }
  } catch (e) {
    console.warn('Failed to read cached watcher state:', e);
  }
  return null;
}

// Helper to save state to localStorage
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
  onClose?: () => void;
}

export function ComputerTrackingSettings({ userId, onClose }: ComputerTrackingSettingsProps) {
  // Load initial state from cache for instant display
  const cachedState = useRef(getCachedState());
  
  const [isLoading, setIsLoading] = useState(true);
  const [isStatusLoading, setIsStatusLoading] = useState(true); // Separate loading for toggle
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Watcher state - initialize from cache if available
  const [isEnabled, setIsEnabled] = useState(cachedState.current?.isEnabled ?? false);
  const [isRunning, setIsRunning] = useState(cachedState.current?.isRunning ?? false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(cachedState.current?.accessibilityGranted ?? false);
  const [deviceId, setDeviceId] = useState<string | null>(cachedState.current?.deviceId ?? null);
  
  // Settings - initialize from cache if available
  const [titleMode, setTitleMode] = useState<'off' | 'full' | 'truncate' | 'hash'>(cachedState.current?.titleMode ?? 'off');
  const [pollInterval, setPollInterval] = useState(2000);
  const [excludedApps, setExcludedApps] = useState<string[]>([]);
  const [syncAnalytics, setSyncAnalytics] = useState(false);
  const [afkTimeout, setAfkTimeout] = useState(900); // 15 minutes default
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserExtensionDiagnostics | null>(null);

  // Sync watcher data to "Computer Use" habit
  const syncToHabit = useCallback(async () => {
    try {
      setIsSyncing(true);
      const response = await fetch('/api/watcher/sync-to-habit', {
        method: 'POST',
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.synced) {
          console.log(`✅ Synced computer time: ${result.amount} ${result.unit}`);
          setLastSyncTime(new Date());
        } else if (result.error) {
          console.log('⚠️ Sync skipped:', result.error);
        }
      }
    } catch (e) {
      console.error('Failed to sync to habit:', e);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Set up hourly sync when watcher is running
  useEffect(() => {
    if (!isRunning || !isEnabled) return;

    // Sync immediately when watcher starts
    syncToHabit();

    // Then sync every hour (3600000ms)
    const interval = setInterval(() => {
      console.log('⏰ Hourly sync triggered');
      syncToHabit();
    }, 3600000); // 1 hour

    return () => {
      clearInterval(interval);
    };
  }, [isRunning, isEnabled, syncToHabit]);

  // Check accessibility permission
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

  // Get watcher status - this is a fast local Tauri call
  const getStatus = useCallback(async () => {
    try {
      const status = await invoke<WatcherStatus>('get_watcher_status');
      setIsRunning(status.is_running);
      // Also set isEnabled if watcher is running (they should match)
      if (status.is_running) {
        setIsEnabled(true);
      }
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

  // OPTIMIZED: Load settings with fast local checks FIRST, then backend
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // STEP 1: Fast local checks (Tauri IPC) - run in parallel
      // These are instant and give us the most important info
      const [accessGranted, status, diagnostics] = await Promise.all([
        invoke<boolean>('check_accessibility_permission').catch(() => false),
        invoke<WatcherStatus>('get_watcher_status').catch(() => null),
        invoke<BrowserExtensionDiagnostics>('get_browser_extension_diagnostics').catch(() => null)
      ]);
      
      // Update UI immediately with local state
      setAccessibilityGranted(accessGranted);
      if (status) {
        setIsRunning(status.is_running);
        if (status.is_running) {
          setIsEnabled(true);
        }
      }
      if (diagnostics) {
        setBrowserDiagnostics(diagnostics);
      }
      setIsStatusLoading(false); // Toggle can now show accurate state
      
      // Cache the local state immediately
      setCachedState({
        isRunning: status?.is_running ?? false,
        isEnabled: status?.is_running ?? false,
        accessibilityGranted: accessGranted,
        deviceId: deviceId,
        titleMode: titleMode
      });
      
      // STEP 2: Backend call (slower network request) - non-blocking for UX
      try {
        const response = await fetch(`/api/watcher/devices`);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.devices && data.devices.length > 0) {
            const device = data.devices[0];
            setDeviceId(device.device_id);
            // Only update isEnabled from backend if watcher isn't running locally
            // (local state is more accurate for running status)
            if (!status?.is_running) {
              setIsEnabled(device.is_enabled);
            }
            setTitleMode(device.state?.title_mode || 'off');
            setPollInterval(device.state?.poll_interval_ms || 2000);
            setExcludedApps(device.state?.excluded_bundle_ids || []);
            setSyncAnalytics(device.state?.sync_analytics || false);
            setAfkTimeout(device.state?.afk_timeout_seconds || 900);
            
            // Update cache with backend data
            setCachedState({
              isRunning: status?.is_running ?? false,
              isEnabled: status?.is_running || device.is_enabled,
              accessibilityGranted: accessGranted,
              deviceId: device.device_id,
              titleMode: device.state?.title_mode || 'off'
            });
          }
        } else {
          console.log('No watcher devices found or backend unavailable');
        }
      } catch (fetchErr) {
        // Network error or backend unavailable - this is okay, we have local state
        console.log('Could not fetch watcher devices (using local state):', fetchErr);
      }
    } catch (e) {
      console.error('Failed to initialize watcher settings:', e);
    } finally {
      setIsLoading(false);
      setIsStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    getBrowserExtensionDiagnostics();

    const interval = setInterval(() => {
      getBrowserExtensionDiagnostics();
    }, 15_000);

    return () => clearInterval(interval);
  }, [getBrowserExtensionDiagnostics]);

  // Watchdog: Periodically check if watcher is hung and auto-restart
  useEffect(() => {
    if (!isEnabled || !isRunning) return;
    
    const watchdogInterval = setInterval(async () => {
      try {
        // Check if watcher is hung (heartbeat stale > 60 seconds) and auto-restart
        const wasRestarted = await invoke<boolean>('check_and_restart_watcher_if_hung', { 
          maxStaleSeconds: 60 
        });
        
        if (wasRestarted) {
          console.log('🔄 Watcher was auto-restarted due to hang detection');
          // Refresh status after restart
          await getStatus();
        }
      } catch (e) {
        // Silently ignore - watchdog is best-effort
        console.debug('Watchdog check failed:', e);
      }
    }, 60_000); // Check every 60 seconds
    
    return () => clearInterval(watchdogInterval);
  }, [isEnabled, isRunning, getStatus]);

  // Request accessibility permission
  const requestAccessibility = async () => {
    try {
      await invoke('request_accessibility_permission');
      // Wait a bit then check again
      setTimeout(async () => {
        await checkAccessibility();
      }, 1000);
    } catch (e) {
      console.error('Failed to request accessibility:', e);
    }
  };

  // Open system preferences
  const openAccessibilitySettings = async () => {
    try {
      await invoke('open_accessibility_settings');
    } catch (e) {
      console.error('Failed to open settings:', e);
    }
  };

  // Toggle watcher
  const toggleWatcher = async () => {
    if (!deviceId && !isEnabled) {
      // Register new device first
      try {
        const response = await fetch('/api/watcher/devices', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            device_name: 'My Mac',
            platform: 'macos'
          })
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
      // Stop watcher
      try {
        await invoke('stop_watcher');
        
        // Clear config to disable auto-start
        await invoke('clear_watcher_config_cmd');
        
        setIsRunning(false);
        setIsEnabled(false);
        await getBrowserExtensionDiagnostics();
        
        // Cache the new state
        setCachedState({
          isRunning: false,
          isEnabled: false,
          accessibilityGranted,
          deviceId,
          titleMode
        });
        
        // Update backend
        if (deviceId) {
          await fetch(`/api/watcher/devices/${deviceId}/stop`, {
            method: 'POST'
          });
        }
      } catch (e) {
        console.error('Failed to stop watcher:', e);
        setError('Failed to stop watcher');
      }
    } else {
      // Start watcher
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
          // V2 settings
          afk_timeout_seconds: afkTimeout,
          url_mode: 'domain',
          track_incognito: false,
          browser_heartbeat_port: 8766,
        };
        
        await invoke('start_watcher', { config });
        
        // Save config for auto-start on next app launch
        await invoke('save_watcher_config_cmd', { config });
        
        setIsRunning(true);
        setIsEnabled(true);
        await getBrowserExtensionDiagnostics();
        
        // Cache the new state
        setCachedState({
          isRunning: true,
          isEnabled: true,
          accessibilityGranted,
          deviceId,
          titleMode
        });
        
        // Update backend
        if (deviceId) {
          await fetch(`/api/watcher/devices/${deviceId}/start`, {
            method: 'POST'
          });
        }
      } catch (e) {
        console.error('Failed to start watcher:', e);
        setError('Failed to start watcher');
      }
    }
  };

  // Save settings
  const saveSettings = async () => {
    if (!deviceId) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/watcher/devices/${deviceId}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          poll_interval_ms: pollInterval,
          title_mode: titleMode,
          excluded_bundle_ids: excludedApps,
          sync_analytics: syncAnalytics,
          afk_timeout_seconds: afkTimeout
        })
      });
      
      if (!response.ok) throw new Error('Failed to save settings');
      
      // Restart watcher if running to apply new settings
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
        
        // Save config for auto-start
        await invoke('save_watcher_config_cmd', { config });
      }
    } catch (e) {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle app exclusion
  const toggleAppExclusion = (bundleId: string) => {
    if (excludedApps.includes(bundleId)) {
      setExcludedApps(excludedApps.filter(id => id !== bundleId));
    } else {
      setExcludedApps([...excludedApps, bundleId]);
    }
  };

  // Custom square checkbox component
  const SquareCheckbox = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
      type="button"
      onClick={onChange}
      className={`w-4 h-4 border flex items-center justify-center transition-colors ${
        checked ? 'bg-black border-black' : 'bg-white border-gray-300'
      }`}
    >
      {checked && <Check className="w-3 h-3 text-white" />}
    </button>
  );

  return (
    <div className="space-y-0">
      {error && (
        <div className="py-2 flex items-center gap-2 text-red-500 text-sm border-b border-gray-200/50">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Accessibility Permission */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">Accessibility Permission</span>
        </div>
        {accessibilityGranted ? (
          <span className="text-sm text-gray-500">Granted</span>
        ) : (
          <button
            onClick={openAccessibilitySettings}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Open Settings
          </button>
        )}
      </div>

      {/* Enable Watcher */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">Enable Watcher</span>
          {isRunning && !isStatusLoading && (
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" title="Watcher is running" />
          )}
        </div>
        {isStatusLoading && !cachedState.current ? (
          // Show loading spinner only if we don't have cached state
          <div className="h-5 w-9 flex items-center justify-center">
            <BrailleSpinner className="text-sm text-gray-400" />
          </div>
        ) : (
          <button
            onClick={toggleWatcher}
            disabled={isStatusLoading}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
              isEnabled ? 'bg-black' : 'bg-gray-300'
            } ${isStatusLoading ? 'opacity-50' : ''}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                isEnabled ? 'translate-x-[18px]' : 'translate-x-1'
              }`}
            />
          </button>
        )}
      </div>

      {/* Sync to Habit - Only show when watcher is enabled */}
      {isEnabled && (
        <div className="py-2.5 border-b border-gray-200/50">
          <div className="flex items-center gap-2 mb-1.5">
            <Monitor className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-900">Browser Extension Status</span>
          </div>
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex items-center justify-between">
              <span>Extension installed</span>
              <span className={browserDiagnostics?.extension_installed ? 'text-green-700' : 'text-amber-700'}>
                {browserDiagnostics?.extension_installed ? 'Detected' : 'Unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Watcher reachable</span>
              <span className={browserDiagnostics?.watcher_reachable ? 'text-green-700' : 'text-red-700'}>
                {browserDiagnostics?.watcher_reachable
                  ? `Yes (${browserDiagnostics.watcher_server_url ?? 'localhost'})`
                  : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Listener port / PID</span>
              <span className="text-gray-700">
                {browserDiagnostics?.current_listener_port ?? '-'}
                {' / '}
                {browserDiagnostics?.watcher_pid ?? '-'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Heartbeat live</span>
              <span className={browserDiagnostics?.heartbeat_live ? 'text-green-700' : 'text-red-700'}>
                {browserDiagnostics?.heartbeat_live
                  ? `Yes (${browserDiagnostics.seconds_since_browser_extension_heartbeat ?? 0}s ago)`
                  : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Duplicate watcher</span>
              <span className={browserDiagnostics?.duplicate_watcher_detected ? 'text-red-700' : 'text-green-700'}>
                {browserDiagnostics?.duplicate_watcher_detected ? 'Detected' : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Port mismatch</span>
              <span className={browserDiagnostics?.browser_heartbeat_port_mismatch ? 'text-amber-700' : 'text-green-700'}>
                {browserDiagnostics?.browser_heartbeat_port_mismatch ? 'Detected' : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Context enabled</span>
              <span className={browserDiagnostics?.context_enabled ? 'text-green-700' : 'text-amber-700'}>
                {browserDiagnostics?.context_enabled
                  ? `Yes (${browserDiagnostics.context_quality})`
                  : browserDiagnostics?.context_quality || 'Unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Recent snapshots</span>
              <span className="text-gray-700">
                {browserDiagnostics?.recent_context_snapshot_count ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Browser / native / fallback</span>
              <span className="text-gray-700">
                {(browserDiagnostics?.recent_browser_snapshot_count ?? 0)}
                {' / '}
                {(browserDiagnostics?.recent_accessibility_snapshot_count ?? 0)}
                {' / '}
                {(browserDiagnostics?.recent_metadata_fallback_count ?? 0)}
              </span>
            </div>
            {browserDiagnostics?.detection_note && (
              <p className="text-[11px] text-gray-500">{browserDiagnostics.detection_note}</p>
            )}
            {browserDiagnostics?.context_note && (
              <p className="text-[11px] text-gray-500">{browserDiagnostics.context_note}</p>
            )}
          </div>
        </div>
      )}

      {isEnabled && (
        <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isSyncing ? (
              <BrailleSpinner className="text-sm text-gray-400" />
            ) : (
              <RefreshCw className="w-4 h-4 text-gray-400" />
            )}
            <div>
              <span className="text-sm text-gray-900">Sync to Habit</span>
              {lastSyncTime && (
                <span className="text-xs text-gray-400 ml-2">
                  Last: {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={syncToHabit}
            disabled={isSyncing}
            className="px-2.5 py-1 text-xs text-gray-700 border border-gray-300 rounded-sm hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}

      {/* Window Title Mode */}
      <div className="py-2.5 border-b border-gray-200/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {titleMode === 'off' ? (
              <EyeOff className="w-4 h-4 text-gray-400" />
            ) : (
              <Eye className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-sm text-gray-900">Window Titles</span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {TITLE_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setTitleMode(option.value)}
              className={`py-1.5 px-2 text-xs text-center border rounded-sm transition-colors ${
                titleMode === option.value
                  ? 'border-gray-900 bg-gray-100 text-gray-900'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* AFK Timeout */}
      <div className="py-2.5 border-b border-gray-200/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-900">Idle Timeout</span>
          </div>
          <span className="text-sm text-gray-500">
            {afkTimeout >= 60 ? `${Math.round(afkTimeout / 60)} min` : `${afkTimeout} sec`}
          </span>
        </div>
        <div className="space-y-1.5">
          <input
            type="range"
            min="300"
            max="3600"
            step="60"
            value={afkTimeout}
            onChange={(e) => setAfkTimeout(parseInt(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-black"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>5 min</span>
            <span>15 min</span>
            <span>30 min</span>
            <span>60 min</span>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          Time without input before marking as idle. Longer = captures reading/thinking time.
        </p>
      </div>

      {/* Excluded Apps */}
      <div className="py-2.5 border-b border-gray-200/50">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-900">Excluded Apps</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {SENSITIVE_APPS.map((app) => (
            <label
              key={app.bundle_id}
              className="flex items-center gap-2 cursor-pointer py-0.5"
            >
              <SquareCheckbox
                checked={excludedApps.includes(app.bundle_id)}
                onChange={() => toggleAppExclusion(app.bundle_id)}
              />
              <span className="text-sm text-gray-700">{app.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Sync Analytics */}
      <div className="py-2.5 border-b border-gray-200/50 flex items-center justify-between">
        <span className="text-sm text-gray-900">Sync Analytics to Cloud</span>
        <button
          onClick={() => setSyncAnalytics(!syncAnalytics)}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
            syncAnalytics ? 'bg-black' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              syncAnalytics ? 'translate-x-[18px]' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-2 pt-3">
        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={saveSettings}
          disabled={isSaving}
          className="px-3 py-1.5 text-sm text-white bg-black rounded-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {isSaving && <BrailleSpinner className="text-xs text-white" />}
          Save
        </button>
      </div>
    </div>
  );
}
