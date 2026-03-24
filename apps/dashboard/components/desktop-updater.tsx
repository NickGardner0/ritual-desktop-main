'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  checkDesktopForUpdates,
  desktopFrontendReady,
  getDesktopCompatibilityIssue,
  installDesktopUpdate,
  type DesktopRuntimeInfo,
  type UpdateManifest,
} from '@/lib/desktop-runtime';
import { isTauri } from '@/lib/tauri-utils';

type UpdateStatusPayload = {
  error?: string | null;
  status?: string | null;
};

const DESKTOP_ENV_QUERY_PARAM = 'ritual_desktop_env';
const UPDATE_AVAILABLE_EVENT = 'tauri://update-available';
const UPDATE_STATUS_EVENT = 'tauri://update-status';

function normalizeManifest(manifest: UpdateManifest | null | undefined): UpdateManifest | null {
  if (!manifest?.version) {
    return null;
  }

  return {
    body: manifest.body ?? null,
    date: manifest.date ?? null,
    version: manifest.version,
  };
}

export function DesktopUpdater() {
  const [availableUpdate, setAvailableUpdate] = useState<UpdateManifest | null>(null);
  const [checking, setChecking] = useState(false);
  const [desktopEnv, setDesktopEnv] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [manualCheckActive, setManualCheckActive] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const manualCheckActiveRef = useRef(false);

  useEffect(() => {
    manualCheckActiveRef.current = manualCheckActive;
  }, [manualCheckActive]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const queryEnv = params.get(DESKTOP_ENV_QUERY_PARAM);
    if (queryEnv) {
      window.sessionStorage.setItem(DESKTOP_ENV_QUERY_PARAM, queryEnv);
      setDesktopEnv(queryEnv);
      return;
    }

    setDesktopEnv(window.sessionStorage.getItem(DESKTOP_ENV_QUERY_PARAM));
  }, []);

  const isDesktopShell =
    isTauri() &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('ritual_sidebar_window') !== '1';

  const shouldEnableUpdater =
    isDesktopShell && (desktopEnv === 'production' || desktopEnv === 'prod');

  const compatibilityIssue = useMemo(
    () => getDesktopCompatibilityIssue(runtimeInfo),
    [runtimeInfo],
  );

  useEffect(() => {
    if (!isDesktopShell) return;

    let cancelled = false;

    void desktopFrontendReady().then((info) => {
      if (cancelled) return;
      setRuntimeInfo(info);
      setAvailableUpdate(normalizeManifest(info?.pendingUpdate));
    });

    return () => {
      cancelled = true;
    };
  }, [isDesktopShell]);

  useEffect(() => {
    if (!shouldEnableUpdater) return;

    let cancelled = false;
    let disposeAvailable: (() => void) | undefined;
    let disposeStatus: (() => void) | undefined;

    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        disposeAvailable = await listen<UpdateManifest>(UPDATE_AVAILABLE_EVENT, (event) => {
          if (cancelled) return;

          const manifest = normalizeManifest(event.payload);
          setAvailableUpdate(manifest);
          setRuntimeInfo((current) => (
            current
              ? {
                  ...current,
                  pendingUpdate: manifest,
                }
              : current
          ));
          setStatusMessage(null);
          setChecking(false);
          setManualCheckActive(false);
        });

        disposeStatus = await listen<UpdateStatusPayload>(UPDATE_STATUS_EVENT, (event) => {
          if (cancelled) return;

          const payload = event.payload || {};
          const status = (payload.status || '').toUpperCase();

          if (status === 'PENDING') {
            setInstalling(true);
            setStatusMessage('Downloading and installing the latest Ritual desktop build...');
            return;
          }

          if (status === 'DONE') {
            setStatusMessage('Update installed. Relaunching Ritual...');
            return;
          }

          if (status === 'UPTODATE') {
            setChecking(false);
            setInstalling(false);
            setAvailableUpdate(null);
            setRuntimeInfo((current) => (
              current
                ? {
                    ...current,
                    pendingUpdate: null,
                  }
                : current
            ));
            setStatusMessage(
              manualCheckActiveRef.current ? 'You already have the latest Ritual desktop build.' : null,
            );
            setManualCheckActive(false);
            return;
          }

          if (status === 'ERROR') {
            setChecking(false);
            setInstalling(false);
            setStatusMessage(payload.error || 'Update failed. Reopen the tray menu and try again.');
            setManualCheckActive(false);
          }
        });
      })
      .catch((error) => {
        console.warn('Unable to bind native desktop updater listeners:', error);
      });

    return () => {
      cancelled = true;
      disposeAvailable?.();
      disposeStatus?.();
    };
  }, [shouldEnableUpdater]);

  const effectivePendingUpdate = availableUpdate ?? normalizeManifest(runtimeInfo?.pendingUpdate);

  const runManualUpdateCheck = async () => {
    setChecking(true);
    setManualCheckActive(true);
    setStatusMessage('Checking GitHub Releases for a new Ritual build...');

    try {
      const nextRuntimeInfo = await checkDesktopForUpdates();
      setRuntimeInfo(nextRuntimeInfo);
      setAvailableUpdate(normalizeManifest(nextRuntimeInfo?.pendingUpdate));
      if (!nextRuntimeInfo?.pendingUpdate) {
        setChecking(false);
      }
    } catch (error) {
      console.error('Desktop updater check failed:', error);
      setChecking(false);
      setManualCheckActive(false);
      setStatusMessage('Update check failed. Confirm the GitHub release includes latest.json and signed updater artifacts.');
    }
  };

  const installUpdateNow = async () => {
    setInstalling(true);
    setStatusMessage('Downloading and installing the latest Ritual desktop build...');

    try {
      await installDesktopUpdate();
    } catch (error) {
      console.error('Desktop updater install failed:', error);
      setInstalling(false);
      setStatusMessage('Install failed. Close Ritual and reinstall from the latest GitHub Release if this persists.');
    }
  };

  if (!isDesktopShell) {
    return null;
  }

  if (compatibilityIssue) {
    const requiredCapabilities =
      compatibilityIssue.kind === 'capability'
        ? compatibilityIssue.missingCapabilities.join(', ')
        : null;

    return (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-[rgba(9,9,11,0.58)] px-6">
        <div className="w-full max-w-xl rounded-[32px] border border-black/10 bg-white p-8 shadow-[0_40px_100px_rgba(0,0,0,0.28)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8a6f47]">
            Ritual Desktop Update Required
          </p>
          <h2 className="mt-4 text-[30px] font-medium leading-[1.08] tracking-[-0.03em] text-[#1d1a16]">
            This Ritual web release needs a newer desktop shell.
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-[#5a5147]">
            {compatibilityIssue.kind === 'version'
              ? `Required desktop version: ${compatibilityIssue.requiredVersion}. Current version: ${compatibilityIssue.currentVersion ?? 'unknown'}.`
              : `This page needs desktop capabilities your installed shell does not expose yet: ${requiredCapabilities}.`}
          </p>
          <p className="mt-3 text-[14px] leading-6 text-[#6a6157]">
            Use the button below to check for the latest signed desktop release and install it before continuing.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {effectivePendingUpdate ? (
              <Button disabled={installing} onClick={installUpdateNow} size="sm">
                {installing ? 'Installing…' : `Install ${effectivePendingUpdate.version ?? 'update'}`}
              </Button>
            ) : (
              <Button disabled={checking || !shouldEnableUpdater} onClick={runManualUpdateCheck} size="sm">
                {checking ? 'Checking…' : 'Check for update'}
              </Button>
            )}
            {statusMessage ? (
              <Button
                disabled={checking || installing}
                onClick={() => setStatusMessage(null)}
                size="sm"
                variant="outline"
              >
                Dismiss
              </Button>
            ) : null}
          </div>

          {statusMessage ? (
            <p className="mt-4 text-sm leading-6 text-[#5a5147]">{statusMessage}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!shouldEnableUpdater || (!effectivePendingUpdate && !statusMessage)) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[1000] flex w-[360px] max-w-[calc(100vw-2rem)] justify-end">
      <div className="pointer-events-auto rounded-2xl border border-black/10 bg-white/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {effectivePendingUpdate ? 'Ritual update ready' : 'Desktop updater'}
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-600">
              {effectivePendingUpdate
                ? `Version ${effectivePendingUpdate.version ?? 'new'} is available from GitHub Releases.`
                : statusMessage}
            </p>
          </div>
          <button
            className="text-xs font-medium text-gray-400 transition hover:text-gray-700"
            onClick={() => {
              setAvailableUpdate(null);
              setStatusMessage(null);
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>

        {effectivePendingUpdate?.body ? (
          <p className="mt-3 line-clamp-3 text-xs leading-5 text-gray-500">
            {effectivePendingUpdate.body}
          </p>
        ) : null}

        {effectivePendingUpdate ? (
          <div className="mt-4 flex gap-2">
            <Button disabled={installing} onClick={installUpdateNow} size="sm">
              {installing ? 'Installing…' : 'Install update'}
            </Button>
            <Button
              disabled={checking || installing}
              onClick={() => {
                setAvailableUpdate(null);
                setStatusMessage('You can reopen the tray menu and use Check for Updates at any time.');
              }}
              size="sm"
              variant="outline"
            >
              Later
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
