'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
  RefreshCw,
  Clock,
  Database,
  LogIn,
  Menu,
  Monitor,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '@clerk/nextjs';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { useHabits } from '@/contexts/HabitsContext';
import { ensureComputerTimeHabit } from '@/lib/ensure-computer-time-habit';
import { apiOperationWithAuth } from '@/lib/api/client';
import {
  desktopHasCapability,
  desktopSetComputerTracking,
  desktopSetLaunchAtLogin,
  desktopSetMenuBarVisibility,
  getDesktopResidentRuntimeState,
  type DesktopResidentRuntimeState,
  type DesktopWatcherConfig,
} from '@/lib/native-gateway';
import { cn } from '@/lib/utils';
import {
  attributionHealthStatusClass,
  DiagRow,
  formatDebugTimestamp,
  NativeRow,
  NativeSection,
  NativeToggle,
} from '@/components/computer-tracking-settings.native';
import { useComputerActivitySync } from '@/components/use-computer-activity-sync';
import { resumeComputerTrackingIfStalled } from '@/lib/computerActivity/resume-if-stalled';

type WatcherConfig = DesktopWatcherConfig;

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

interface ProjectTimeAttributionHealth {
  latest_session_ts: number | null;
  session_count: number;
  rollup_count: number;
  unclassified_session_count: number;
  latest_rollup_updated_at: number | null;
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
  showAttributionHealth?: boolean;
  onClose?: () => void;
}

export function ComputerTrackingSettings({ userId, showAttributionHealth = false, onClose }: ComputerTrackingSettingsProps) {
  const { getToken } = useAuth();
  const { habits, createHabit, updateHabit, fetchHabits } = useHabits();
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
  const [afkTimeout, setAfkTimeout] = useState(900);
  const [residentCapability, setResidentCapability] = useState<boolean | null>(null);
  const [residentState, setResidentState] = useState<DesktopResidentRuntimeState | null>(null);
  const [residentBusy, setResidentBusy] = useState(false);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserExtensionDiagnostics | null>(null);
  const [attributionHealth, setAttributionHealth] = useState<ProjectTimeAttributionHealth | null>(null);
  const [attributionHealthLoading, setAttributionHealthLoading] = useState(false);

  // ------ callbacks ------

  const computerSync = useComputerActivitySync(userId);

  useEffect(() => {
    let cancelled = false;
    void desktopHasCapability('desktop-resident-runtime-v1').then((residentSupported) => {
      if (cancelled) return;
      setResidentCapability(residentSupported);
      if (residentSupported) {
        void getDesktopResidentRuntimeState().then((state) => {
          if (!cancelled && state) setResidentState(state);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

      const [accessGranted, status, diagnostics, initialResident] = await Promise.all([
        invoke<boolean>('check_accessibility_permission').catch(() => false),
        invoke<WatcherStatus>('get_watcher_status').catch(() => null),
        invoke<BrowserExtensionDiagnostics>('get_browser_extension_diagnostics').catch(() => null),
        getDesktopResidentRuntimeState().catch(() => null),
      ]);
      let resident = initialResident;
      if (resident?.trackingEnabled && !resident.watcherRunning) {
        const recovered = await resumeComputerTrackingIfStalled().catch(() => false);
        if (recovered) {
          resident = await getDesktopResidentRuntimeState().catch(() => resident);
        }
      }

      setAccessibilityGranted(accessGranted);
      if (status) {
        setIsRunning(status.is_running);
        if (status.is_running) setIsEnabled(true);
      }
      if (resident) {
        setResidentState(resident);
        setIsEnabled(resident.trackingEnabled);
        setIsRunning(resident.watcherRunning);
        if (resident.lastErrorMessage) setError(resident.lastErrorMessage);
      }
      if (diagnostics) setBrowserDiagnostics(diagnostics);
      setIsStatusLoading(false);

      setCachedState({
        isRunning: resident?.watcherRunning ?? status?.is_running ?? false,
        isEnabled: resident?.trackingEnabled ?? status?.is_running ?? false,
        accessibilityGranted: accessGranted,
        deviceId: deviceId,
        titleMode: titleMode
      });

      try {
        const data = await apiOperationWithAuth(
          'list_devices_api_watcher_devices_get', getToken, {}, userId,
        ) as { devices?: Array<{ device_id: string; is_enabled?: boolean; state?: Record<string, any> }> };
        if (data.devices && data.devices.length > 0) {
          const device = data.devices[0];
          setDeviceId(device.device_id);
          if (!resident && !status?.is_running) setIsEnabled(Boolean(device.is_enabled));
          setTitleMode((device.state?.title_mode || 'off') as CachedWatcherState['titleMode']);
          setPollInterval(device.state?.poll_interval_ms || 2000);
          setExcludedApps(device.state?.excluded_bundle_ids || []);
          setAfkTimeout(device.state?.afk_timeout_seconds || 900);

          setCachedState({
            isRunning: resident?.watcherRunning ?? status?.is_running ?? false,
            isEnabled: resident?.trackingEnabled ?? Boolean(status?.is_running || device.is_enabled),
            accessibilityGranted: accessGranted,
            deviceId: device.device_id,
            titleMode: (device.state?.title_mode || 'off') as CachedWatcherState['titleMode'],
          });
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
  }, [getToken, userId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    getBrowserExtensionDiagnostics();
    const interval = setInterval(() => getBrowserExtensionDiagnostics(), 15_000);
    return () => clearInterval(interval);
  }, [getBrowserExtensionDiagnostics]);

  const loadAttributionHealth = useCallback(async () => {
    if (!showAttributionHealth) return;
    setAttributionHealthLoading(true);
    try {
      const backendHealth = await invoke<ProjectTimeAttributionHealth>(
        'get_project_time_attribution_health',
        { origin: 'settings' },
      ).catch(() => null);
      setAttributionHealth(backendHealth);
    } finally {
      setAttributionHealthLoading(false);
    }
  }, [showAttributionHealth]);

  useEffect(() => {
    if (!showAttributionHealth) return;
    void loadAttributionHealth();
    const interval = setInterval(() => void loadAttributionHealth(), 15_000);
    return () => clearInterval(interval);
  }, [loadAttributionHealth, showAttributionHealth]);

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
        const data = await apiOperationWithAuth(
          'register_device_api_watcher_devices_post',
          getToken,
          { body: { device_name: 'My Mac', platform: 'macos' } },
          userId,
        );
        setDeviceId(data.device_id);
      } catch (e) {
        setError('Failed to register device');
        return;
      }
    }

    if (isEnabled) {
      try {
        const resident = residentCapability
          ? await desktopSetComputerTracking({ enabled: false })
          : null;
        if (!residentCapability) {
          await invoke('stop_watcher');
          await invoke('clear_watcher_config_cmd');
        }
        if (resident) {
          setResidentState(resident);
          if (resident.lastErrorMessage) setError(resident.lastErrorMessage);
        }
        setIsRunning(false);
        setIsEnabled(false);
        await getBrowserExtensionDiagnostics();
        setCachedState({ isRunning: false, isEnabled: false, accessibilityGranted, deviceId, titleMode });
        if (deviceId) {
          await apiOperationWithAuth('stop_watcher_api_watcher_devices__device_id__stop_post', getToken, { pathParams: { device_id: deviceId } }, userId).catch(() => null);
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
        const resident = residentCapability
          ? await desktopSetComputerTracking({ enabled: true, config })
          : null;
        if (!residentCapability) {
          await invoke('start_watcher', { config });
          await invoke('save_watcher_config_cmd', { config });
        }
        if (resident) {
          setResidentState(resident);
          if (resident.lastErrorMessage) setError(resident.lastErrorMessage);
        }
        setIsRunning(true);
        setIsEnabled(true);
        await ensureComputerTimeHabit(habits, createHabit, updateHabit).catch((habitError) => {
          console.warn('Could not ensure system-derived Computer Time habit:', habitError);
        });
        void fetchHabits().catch(() => undefined);
        await getBrowserExtensionDiagnostics();
        setCachedState({ isRunning: true, isEnabled: true, accessibilityGranted, deviceId, titleMode });
        if (deviceId) {
          await apiOperationWithAuth('start_watcher_api_watcher_devices__device_id__start_post', getToken, { pathParams: { device_id: deviceId } }, userId).catch(() => null);
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
        await ensureComputerTimeHabit(habits, createHabit, updateHabit);
        await fetchHabits();
      } catch (e) {
        console.warn('Could not ensure Computer Time habit:', e);
      }

      if (!deviceId) return;

      await apiOperationWithAuth(
        'update_watcher_settings_api_watcher_devices__device_id__settings_put',
        getToken,
        {
          pathParams: { device_id: deviceId },
          body: { poll_interval_ms: pollInterval, title_mode: titleMode, excluded_bundle_ids: excludedApps, afk_timeout_seconds: afkTimeout },
        },
        userId,
      );

      if (isRunning) {
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
        if (residentCapability) {
          const resident = await desktopSetComputerTracking({ enabled: true, config });
          if (resident) {
            setResidentState(resident);
            if (resident.lastErrorMessage) setError(resident.lastErrorMessage);
          }
        } else {
          await invoke('stop_watcher');
          await invoke('start_watcher', { config });
          await invoke('save_watcher_config_cmd', { config });
        }
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

  const toggleLaunchAtLogin = async () => {
    if (!residentCapability || !residentState) return;
    setResidentBusy(true);
    setError(null);
    try {
      const state = await desktopSetLaunchAtLogin(!residentState.launchAtLoginRegistered);
      if (state) {
        setResidentState(state);
        if (state.lastErrorMessage) setError(state.lastErrorMessage);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update Launch at Login');
    } finally {
      setResidentBusy(false);
    }
  };

  const toggleMenuBarVisibility = async () => {
    if (!residentCapability || !residentState) return;
    setResidentBusy(true);
    setError(null);
    try {
      const state = await desktopSetMenuBarVisibility(!residentState.showMenuBar);
      if (state) {
        setResidentState(state);
        if (state.lastErrorMessage) setError(state.lastErrorMessage);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update menu-bar visibility');
    } finally {
      setResidentBusy(false);
    }
  };

  // ------ render ------

  return (
    <div className="space-y-[18px]">
      {error && (
        <div className="flex items-center gap-2 rounded-[10px] bg-red-50 px-4 py-3 text-[13px] text-red-600">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <NativeSection title="Tracking">
        <NativeRow
          icon={<Monitor className="h-4 w-4" />}
          title="Screen tracking"
          description={isRunning ? 'Tracking your computer usage' : 'Track which apps you use and for how long'}
          control={(
            <div className="flex items-center gap-2">
              {isRunning && !isStatusLoading && (
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
              {isStatusLoading && !cachedState.current ? (
                <div className="flex h-4 w-[28px] items-center justify-center">
                  <BrailleSpinner className="text-sm text-gray-400" />
                </div>
              ) : (
                <NativeToggle checked={isEnabled} onClick={toggleWatcher} disabled={isStatusLoading} />
              )}
            </div>
          )}
        />

        {residentCapability && residentState && (
          <>
            <NativeRow
              icon={<LogIn className="h-4 w-4" />}
              title="Launch at Login"
              description={residentState.loginPromptState === 'required'
                ? 'Finish setup so Ritual can keep tracking after you restart your Mac.'
                : 'Start Ritual quietly and resume tracking when you sign in.'}
              control={(
                <NativeToggle
                  checked={residentState.launchAtLoginRegistered}
                  onClick={toggleLaunchAtLogin}
                  disabled={residentBusy}
                />
              )}
            />
            <NativeRow
              icon={<Menu className="h-4 w-4" />}
              title="Show in Menu Bar"
              description="Optional controls for opening Ritual, pausing tracking, and quitting completely."
              control={(
                <NativeToggle
                  checked={residentState.showMenuBar}
                  onClick={toggleMenuBarVisibility}
                  disabled={residentBusy}
                />
              )}
            />
          </>
        )}

        {!accessibilityGranted && (
          <NativeRow
            icon={<AlertCircle className="h-4 w-4 text-amber-600" />}
            title="Accessibility permission"
            description="Grant access so Ritual can read window titles."
            control={(
              <button
                onClick={openAccessibilitySettings}
                className="rounded-[10px] bg-white/80 px-3 py-1.5 text-[13px] font-medium text-amber-900 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] transition-colors hover:bg-white"
              >
                Open Settings
              </button>
            )}
          />
        )}

        <NativeRow
          icon={<RefreshCw className={cn('h-4 w-4', computerSync.isSyncing && 'animate-spin')} />}
          title={computerSync.cloudEnabled ? 'Sync computer activity' : 'Local computer statistics'}
          description={computerSync.description}
          control={(
            <button
              onClick={computerSync.sync}
              disabled={computerSync.isSyncing || computerSync.capability !== true}
              className="settings-value-button disabled:opacity-50"
            >
              {computerSync.isSyncing ? computerSync.progressLabel : computerSync.actionLabel}
            </button>
          )}
        />
      </NativeSection>

      <NativeSection title="Privacy">
        <div className="px-[18px] py-3">
          <div className="mb-2.5 flex items-center gap-3">
            {titleMode === 'off' ? (
              <EyeOff className="h-[15px] w-[15px] text-[#7a7a7a]" />
            ) : (
              <Eye className="h-[15px] w-[15px] text-[#7a7a7a]" />
            )}
            <p className="text-[13px] font-medium leading-tight text-[#252525]">Window titles</p>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-[8px] bg-black/[0.06] p-[3px]">
            {TITLE_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setTitleMode(option.value)}
                className={cn(
                  'h-7 rounded-[5px] text-center text-[12px] font-medium transition-all',
                  titleMode === option.value
                    ? 'bg-white text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.06)]'
                    : 'text-[#6f6f6f] hover:text-[#1d1d1f]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-[18px] py-3">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Clock className="h-[15px] w-[15px] text-[#7a7a7a]" />
              <div>
                <p className="text-[13px] font-medium leading-tight text-[#252525]">Idle timeout</p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#8a8a8a]">
                  Longer values capture reading and thinking time.
                </p>
              </div>
            </div>
            <span className="shrink-0 text-[12px] font-medium text-[#6f6f6f]">
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
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#d9d9d7] accent-[#3c7783]"
          />
          <div className="mt-1.5 flex justify-between text-[12px] text-[#8a8a8a]">
            <span>5 min</span>
            <span>15 min</span>
            <span>30 min</span>
            <span>60 min</span>
          </div>
        </div>

        <div className="px-[18px] py-3">
          <div className="mb-3 flex items-center gap-3">
            <Shield className="h-[15px] w-[15px] text-[#7a7a7a]" />
            <p className="text-[13px] font-medium leading-tight text-[#252525]">Excluded apps</p>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2">
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
                      'flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors',
                      isExcluded ? 'border-[#306774] bg-[#306774]' : 'border-black/20 bg-white/75',
                    )}
                  >
                    {isExcluded && <Check className="h-3 w-3 text-white" />}
                  </button>
                  <span className="text-[13px] text-[#4a4a4a]">{app.name}</span>
                </label>
              );
            })}
          </div>
        </div>

        <NativeRow
          title="Cloud rollup replication"
          description="Controlled by Cloud Intelligence and plaintext sync consent in Privacy settings."
          control={(
            <span className="text-[12px] font-medium text-[#6f6f6f]">
              {computerSync.cloudEnabled ? 'Enabled' : 'Off'}
            </span>
          )}
        />
      </NativeSection>

      {/* ================================================================ */}
      {/* Developer-only: Attribution Health diagnostics                   */}
      {/* ================================================================ */}
      {showAttributionHealth && (
        <NativeSection title="Attribution Health">
          <div className="px-[18px] py-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Database className="h-[15px] w-[15px] text-[#7a7a7a]" />
                <p className="text-[13px] font-medium text-[#252525]">Diagnostics</p>
              </div>
              <div className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', attributionHealthStatusClass((attributionHealth?.session_count ?? 0) > 0 ? 'healthy' : 'Unavailable'))}>
                {attributionHealthLoading ? 'Loading...' : ((attributionHealth?.session_count ?? 0) > 0 ? 'Healthy' : 'Unavailable')}
              </div>
            </div>

            {browserDiagnostics && (
              <div className="mb-3 rounded-[12px] border border-black/10 bg-white/55 p-3 space-y-1.5">
                <div className="mb-2 text-[11px] font-medium uppercase text-[#8a8a8a]">Browser Extension</div>
                <DiagRow label="Extension installed" value={browserDiagnostics.extension_installed ? 'Detected' : 'Unknown'} ok={browserDiagnostics.extension_installed} />
                <DiagRow label="Watcher reachable" value={browserDiagnostics.watcher_reachable ? `Yes (${browserDiagnostics.watcher_server_url ?? 'localhost'})` : 'No'} ok={browserDiagnostics.watcher_reachable} />
                <DiagRow label="Listener port / PID" value={`${browserDiagnostics.current_listener_port ?? '-'} / ${browserDiagnostics.watcher_pid ?? '-'}`} />
                <DiagRow label="Heartbeat live" value={browserDiagnostics.heartbeat_live ? `Yes (${browserDiagnostics.seconds_since_browser_extension_heartbeat ?? 0}s ago)` : 'No'} ok={browserDiagnostics.heartbeat_live} />
                <DiagRow label="Duplicate watcher" value={browserDiagnostics.duplicate_watcher_detected ? 'Detected' : 'No'} ok={!browserDiagnostics.duplicate_watcher_detected} />
                <DiagRow label="Port mismatch" value={browserDiagnostics.browser_heartbeat_port_mismatch ? 'Detected' : 'No'} ok={!browserDiagnostics.browser_heartbeat_port_mismatch} />
                <DiagRow label="Context enabled" value={browserDiagnostics.context_enabled ? `Yes (${browserDiagnostics.context_quality})` : (browserDiagnostics.context_quality || 'Unknown')} ok={browserDiagnostics.context_enabled} />
                <DiagRow label="Recent snapshots" value={String(browserDiagnostics.recent_context_snapshot_count ?? 0)} />
                <DiagRow label="Browser / native / fallback" value={`${browserDiagnostics.recent_browser_snapshot_count ?? 0} / ${browserDiagnostics.recent_accessibility_snapshot_count ?? 0} / ${browserDiagnostics.recent_metadata_fallback_count ?? 0}`} />
                {browserDiagnostics.detection_note && <p className="text-[11px] text-[#7a7a7a]">{browserDiagnostics.detection_note}</p>}
                {browserDiagnostics.context_note && <p className="text-[11px] text-[#7a7a7a]">{browserDiagnostics.context_note}</p>}
              </div>
            )}

            <div className="rounded-[12px] border border-black/10 bg-white/55 p-3 space-y-1.5">
              <div className="mb-2 text-[11px] font-medium uppercase text-[#8a8a8a]">Project Time Attribution</div>
              <DiagRow label="Latest session" value={formatDebugTimestamp(attributionHealth?.latest_session_ts)} />
              <DiagRow label="Latest rollup update" value={formatDebugTimestamp(attributionHealth?.latest_rollup_updated_at)} />
              <DiagRow label="Sessions / rollups" value={`${attributionHealth?.session_count ?? 0} / ${attributionHealth?.rollup_count ?? 0}`} />
              <DiagRow label="Unclassified sessions" value={String(attributionHealth?.unclassified_session_count ?? 0)} />
            </div>
          </div>
        </NativeSection>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-[10px] px-4 py-2 text-[13px] font-medium text-[#6f6f6f] transition-colors hover:bg-black/[0.04] hover:text-[#252525]"
          >
            Cancel
          </button>
        )}
        <button
          onClick={saveSettings}
          disabled={isSaving}
          className="flex items-center gap-1.5 rounded-[10px] bg-[#306774] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#285966] disabled:opacity-50"
        >
          {isSaving && <BrailleSpinner className="text-xs text-white" />}
          Save
        </button>
      </div>

    </div>
  );
}
