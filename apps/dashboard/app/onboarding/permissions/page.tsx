'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { invoke } from '@tauri-apps/api/tauri';
import {
  ArrowLeft,
  Check,
  Monitor,
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

type PermissionKey = 'screenRecording' | 'watcherAccessibility' | 'microphone' | 'speechRecognition';

type PermissionState = Record<PermissionKey, boolean>;

const DEFAULT_PERMISSION_STATE: PermissionState = {
  screenRecording: false,
  watcherAccessibility: false,
  microphone: false,
  speechRecognition: false,
};

const permissionCards: Array<{
  key: PermissionKey;
  title: string;
  Icon: LucideIcon;
}> = [
  { key: 'screenRecording', title: 'Screen Recording', Icon: Monitor },
  { key: 'watcherAccessibility', title: 'Accessibility', Icon: Hand },
  { key: 'microphone', title: 'Microphone', Icon: Mic },
  { key: 'speechRecognition', title: 'Speech Recognition', Icon: AudioLines },
];

export default function PermissionsOnboardingPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useUser();
  const [permissionState, setPermissionState] = useState<PermissionState>(DEFAULT_PERMISSION_STATE);
  const [isChecking, setIsChecking] = useState(true);
  const [activeRequest, setActiveRequest] = useState<PermissionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desktopMode, setDesktopMode] = useState(false);

  const checkPermissions = useCallback(async () => {
    if (!desktopMode) {
      setPermissionState({
        screenRecording: true,
        watcherAccessibility: true,
        microphone: true,
        speechRecognition: true,
      });
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    try {
      const [screenRecording, watcherAccessibility, microphone] = await Promise.all([
        invoke<boolean>('check_screen_recording_permission').catch(() => false),
        invoke<boolean>('check_accessibility_permission').catch(() => false),
        invoke<boolean>('check_native_microphone_permission').catch(() => false),
      ]);

      setPermissionState({
        screenRecording,
        watcherAccessibility,
        microphone,
        speechRecognition: microphone,
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

    if (!needsPermissionsOnboarding()) {
      router.replace('/dashboard');
    }
  }, [isLoaded, isSignedIn, router]);

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
        if (permissionKey === 'screenRecording') {
          await invoke('request_screen_recording_permission');
        } else if (permissionKey === 'watcherAccessibility') {
          const granted = await invoke<boolean>('request_accessibility_permission');
          if (!granted) {
            await invoke('open_accessibility_settings');
          }
        } else if (permissionKey === 'microphone') {
          await invoke<boolean>('show_native_microphone_permission_dialog');
        } else {
          await invoke('start_native_speech_recognition');
          await invoke('stop_native_speech_recognition');
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

  const handleContinue = () => {
    if (!allGranted) return;

    markPermissionsOnboardingCompleted();
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
          These macOS permissions let Ritual capture context<br />and automate tracking on this Mac.
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
                      className="inline-flex shrink-0 items-center justify-center border border-black bg-black px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
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
            onClick={handleContinue}
            disabled={!allGranted || isChecking}
            className={`border px-8 py-2.5 text-sm font-medium transition-colors ${
              allGranted && !isChecking
                ? 'border-black bg-black text-white hover:bg-gray-800'
                : 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </footer>
      </main>
    </div>
  );
}
