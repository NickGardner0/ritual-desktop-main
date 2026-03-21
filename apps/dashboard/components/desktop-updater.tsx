'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isTauri } from '@/lib/tauri-utils';

type UpdateManifest = {
  body?: string;
  date?: string;
  version?: string;
};

const CHECK_UPDATES_EVENT = 'ritual://check-for-updates';
const DESKTOP_ENV_QUERY_PARAM = 'ritual_desktop_env';

export function DesktopUpdater() {
  const [availableUpdate, setAvailableUpdate] = useState<UpdateManifest | null>(null);
  const [checking, setChecking] = useState(false);
  const [desktopEnv, setDesktopEnv] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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

  const shouldEnableUpdater =
    isTauri() &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('ritual_sidebar_window') !== '1' &&
    (desktopEnv === 'production' || desktopEnv === 'prod');

  useEffect(() => {
    if (!shouldEnableUpdater) return;

    let cancelled = false;
    let inFlight = false;
    let unlisten: (() => void) | undefined;

    const runCheck = async (manual = false) => {
      if (cancelled || inFlight) return;

      inFlight = true;
      setChecking(true);
      if (manual) {
        setStatusMessage('Checking GitHub Releases for a new Ritual build...');
      }

      try {
        const { checkUpdate } = await import('@tauri-apps/api/updater');
        const result = await checkUpdate();
        if (cancelled) return;

        if (result.shouldUpdate) {
          setAvailableUpdate(result.manifest ?? {});
          setStatusMessage(null);
        } else {
          setAvailableUpdate(null);
          setStatusMessage(manual ? 'You already have the latest Ritual desktop build.' : null);
        }
      } catch (error) {
        if (cancelled) return;
        console.warn('Desktop updater check failed:', error);
        setStatusMessage(
          manual ? 'Update check failed. Confirm the GitHub release includes latest.json and signed updater artifacts.' : null
        );
      } finally {
        inFlight = false;
        if (!cancelled) {
          setChecking(false);
        }
      }
    };

    const timer = window.setTimeout(() => {
      void runCheck(false);
    }, 6_000);

    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen(CHECK_UPDATES_EVENT, () => runCheck(true)))
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn('Unable to bind desktop updater event listener:', error);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [shouldEnableUpdater]);

  const installUpdateNow = async () => {
    setInstalling(true);
    setStatusMessage('Downloading and installing the latest Ritual desktop build...');

    try {
      const [{ installUpdate }, { relaunch }] = await Promise.all([
        import('@tauri-apps/api/updater'),
        import('@tauri-apps/api/process'),
      ]);

      await installUpdate();
      await relaunch();
    } catch (error) {
      console.error('Desktop updater install failed:', error);
      setStatusMessage('Install failed. Close Ritual and reinstall from the latest GitHub Release if this persists.');
      setInstalling(false);
    }
  };

  if (!shouldEnableUpdater || (!availableUpdate && !statusMessage)) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[1000] flex w-[360px] max-w-[calc(100vw-2rem)] justify-end">
      <div className="pointer-events-auto rounded-2xl border border-black/10 bg-white/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.18)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {availableUpdate ? 'Ritual update ready' : 'Desktop updater'}
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-600">
              {availableUpdate
                ? `Version ${availableUpdate.version ?? 'new'} is available from GitHub Releases.`
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

        {availableUpdate?.body ? (
          <p className="mt-3 line-clamp-3 text-xs leading-5 text-gray-500">
            {availableUpdate.body}
          </p>
        ) : null}

        {availableUpdate ? (
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
