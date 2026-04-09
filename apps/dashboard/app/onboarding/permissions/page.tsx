'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useAuth } from '@clerk/nextjs';
import { invoke } from '@tauri-apps/api/tauri';
import {
  ArrowLeft,
  Check,
  Hand,
  Mic,
  AudioLines,
  type LucideIcon,
} from 'lucide-react';
import {
  markPermissionsOnboardingCompleted,
  needsPermissionsOnboarding,
} from '@/lib/onboarding-flow';
import { isTauri, setOnboardingWindowSize } from '@/lib/tauri-utils';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

type PermissionKey = 'watcherAccessibility' | 'microphone' | 'speechRecognition';

type PermissionState = Record<PermissionKey, boolean>;

const DEFAULT_PERMISSION_STATE: PermissionState = {
  watcherAccessibility: false,
  microphone: false,
  speechRecognition: false,
};

const permissionCards: Array<{
  key: PermissionKey;
  title: string;
  Icon: LucideIcon;
}> = [
  { key: 'watcherAccessibility', title: 'Accessibility', Icon: Hand },
  { key: 'microphone', title: 'Microphone', Icon: Mic },
  { key: 'speechRecognition', title: 'Speech Recognition', Icon: AudioLines },
];

export default function PermissionsOnboardingPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const [permissionState, setPermissionState] = useState<PermissionState>(DEFAULT_PERMISSION_STATE);
  const [isChecking, setIsChecking] = useState(true);
  const [activeRequest, setActiveRequest] = useState<PermissionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desktopMode, setDesktopMode] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const bootstrapRan = useRef(false);

  const checkPermissions = useCallback(async () => {
    if (!desktopMode) {
      setPermissionState({
        watcherAccessibility: true,
        microphone: true,
        speechRecognition: true,
      });
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    try {
      const [watcherAccessibility, microphone, speechRecognition] = await Promise.all([
        invoke<boolean>('check_accessibility_permission').catch(() => false),
        invoke<boolean>('check_native_microphone_permission').catch(() => false),
        invoke<boolean>('check_native_speech_recognition_permission').catch(() => false),
      ]);

      setPermissionState({
        watcherAccessibility,
        microphone,
        speechRecognition,
      });
    } catch (checkError) {
      console.error('Failed to check permissions:', checkError);
      setError('Unable to check one or more permissions. Try refreshing.');
    } finally {
      setIsChecking(false);
    }
  }, [desktopMode]);

  useEffect(() => {
    setDesktopMode(isTauri());
    setOnboardingWindowSize();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      router.replace('/sign-in');
      return;
    }

    if (!needsPermissionsOnboarding(user?.id)) {
      router.replace('/dashboard');
    }
  }, [isLoaded, isSignedIn, router, user?.id]);

  useEffect(() => {
    void checkPermissions();
  }, [checkPermissions]);

  useEffect(() => {
    const onFocus = () => {
      void checkPermissions();
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [checkPermissions]);

  const requestPermission = useCallback(
    async (permissionKey: PermissionKey) => {
      if (!desktopMode) return;

      setActiveRequest(permissionKey);
      setError(null);

      try {
        if (permissionKey === 'watcherAccessibility') {
          const granted = await invoke<boolean>('request_accessibility_permission');
          if (!granted) {
            await invoke('open_accessibility_settings');
          }
        } else if (permissionKey === 'microphone') {
          await invoke<boolean>('show_native_microphone_permission_dialog');
        } else {
          await invoke<boolean>('show_native_speech_recognition_permission_dialog');
        }
      } catch (requestError) {
        console.error(`Failed requesting ${permissionKey}:`, requestError);
        setError('Permission request failed. Please try again.');
      } finally {
        setActiveRequest(null);
        setTimeout(() => {
          void checkPermissions();
        }, 1200);
      }
    },
    [checkPermissions, desktopMode],
  );

  const allGranted = Object.values(permissionState).every(Boolean);

  // Bootstrap the watcher + Computer Time habit when accessibility is granted
  const bootstrapWatcher = useCallback(async () => {
    if (bootstrapRan.current || !desktopMode || !user?.id) return;
    bootstrapRan.current = true;

    try {
      const token = await getToken();
      if (!token) return;

      // 1. Register a watcher device
      const deviceRes = await fetch('/api/watcher/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: 'My Mac', platform: 'macos' }),
      });
      if (!deviceRes.ok) {
        console.error('Failed to register watcher device during onboarding');
        return;
      }
      const { device_id: deviceId } = await deviceRes.json();
      if (!deviceId) return;

      // 2. Build watcher config with sensible defaults
      const config = {
        device_id: deviceId,
        user_id: user.id,
        poll_interval_ms: 5000,
        title_mode: 'full' as const,
        truncate_length: 80,
        excluded_bundle_ids: [] as string[],
        afk_timeout_seconds: 300,
        url_mode: 'domain',
        track_incognito: false,
        browser_heartbeat_port: 8766,
      };

      // 3. Start the watcher and persist config for auto-start
      await invoke('start_watcher', { config });
      await invoke('save_watcher_config_cmd', { config });

      // 4. Create the "Computer Time" habit via backend API
      await fetch(`${PYTHON_API_BASE}/api/habits`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Computer Time',
          category: 'Productivity',
          is_custom: false,
          sensor_type: 'Manual',
          icon: 'lucide:monitor',
          unit_type: 'Hours',
          integration_source: null,
          metric_type: null,
        }),
      });

      // 5. Notify the backend the device is active
      await fetch(`/api/watcher/devices/${deviceId}/start`, { method: 'POST' }).catch(() => {});

      console.log('✅ Watcher bootstrapped during onboarding');
    } catch (err) {
      console.error('Watcher bootstrap error (non-blocking):', err);
    }
  }, [desktopMode, user?.id, getToken]);

  const handleContinue = async () => {
    if (!allGranted) return;

    // If accessibility was granted, bootstrap the watcher before navigating
    if (desktopMode && permissionState.watcherAccessibility) {
      setIsBootstrapping(true);
      await bootstrapWatcher();
      setIsBootstrapping(false);
    }

    markPermissionsOnboardingCompleted(user?.id);
    router.replace('/dashboard');
  };

  const handleBack = () => {
    router.replace('/onboarding');
  };

  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "'FK Grotesk Neue', sans-serif" }}>
      <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-12 z-50" />

      <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col items-center justify-center px-6">
        <img src="/images/eclipse.svg" alt="Ritual" className="h-8 w-8" />

        <h1 className="mt-4 text-lg font-medium text-gray-900">
          Grant permissions
        </h1>
        <p className="mt-1.5 text-center text-sm leading-relaxed text-gray-500">
          These macOS permissions let Ritual capture context<br />and power watcher and voice logging on this Mac.
        </p>

        {/* Permission list */}
        <div className="mt-12 w-full">
          <ul className="space-y-8">
            {permissionCards.map(({ key, title, Icon }) => {
              const granted = permissionState[key];
              const isRequesting = activeRequest === key;

              return (
                <li key={key} className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <Icon className="h-5 w-5 shrink-0 text-gray-400" strokeWidth={1.5} />
                    <span className="text-sm font-medium text-gray-900">{title}</span>
                  </div>

                  {granted ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500">
                      <Check className="h-3.5 w-3.5 text-gray-900" strokeWidth={2} />
                      Granted
                    </span>
                  ) : (
                    <button
                      onClick={() => void requestPermission(key)}
                      disabled={isRequesting}
                      className="inline-flex shrink-0 items-center justify-center border border-black bg-black px-4 py-1.5 text-xs font-medium text-white rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRequesting ? 'Requesting...' : 'Grant'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {error && <p className="mt-4 text-xs text-red-600">{error}</p>}

        {/* Footer */}
        <footer className="mt-14 flex w-full items-center justify-between">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 px-1 py-1 text-sm text-gray-500 transition-colors hover:text-gray-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>

          <button
            onClick={() => void handleContinue()}
            disabled={!allGranted || isChecking || isBootstrapping}
            className={`border px-8 py-2.5 text-sm font-medium transition-colors ${
              allGranted && !isChecking && !isBootstrapping
                ? 'border-black bg-black text-white rounded-sm'
                : 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed'
            }`}
          >
            {isBootstrapping ? 'Setting up...' : 'Continue'}
          </button>
        </footer>
      </main>
    </div>
  );
}
