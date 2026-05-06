'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  checkDesktopForUpdates,
  getDesktopCompatibilityIssue,
  getDesktopRuntimeInfo,
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
const RUNTIME_STATE_CHANGED_EVENT = 'desktop://runtime-state-changed';
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

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Install failed. Please try again or reinstall Ritual if the issue persists.';
}

export function DesktopUpdater() {
  const [availableUpdate, setAvailableUpdate] = useState<UpdateManifest | null>(null);
  const [checking, setChecking] = useState(false);
  const [desktopEnv, setDesktopEnv] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [manualCheckActive, setManualCheckActive] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const manualCheckActiveRef = useRef(false);
  const runtimeInfoRefreshRef = useRef<Promise<void> | null>(null);

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

    void getDesktopRuntimeInfo().then((info) => {
      if (cancelled) return;
      setRuntimeInfo(info);
    });

    return () => {
      cancelled = true;
    };
  }, [isDesktopShell]);

  useEffect(() => {
    if (!shouldEnableUpdater) return;

    let cancelled = false;
    let disposeAvailable: (() => void) | undefined;
    let disposeRuntimeState: (() => void) | undefined;
    let disposeStatus: (() => void) | undefined;

    const refreshRuntimeInfo = async () => {
      if (runtimeInfoRefreshRef.current) {
        await runtimeInfoRefreshRef.current;
        return;
      }

      const nextRefresh = (async () => {
        const nextInfo = await getDesktopRuntimeInfo();
        if (!cancelled) {
          setRuntimeInfo(nextInfo);
        }
      })();

      runtimeInfoRefreshRef.current = nextRefresh;
      try {
        await nextRefresh;
      } finally {
        if (runtimeInfoRefreshRef.current === nextRefresh) {
          runtimeInfoRefreshRef.current = null;
        }
      }
    };

    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        disposeRuntimeState = await listen(RUNTIME_STATE_CHANGED_EVENT, () => {
          void refreshRuntimeInfo();
        });

        disposeAvailable = await listen<UpdateManifest>(UPDATE_AVAILABLE_EVENT, (event) => {
          if (cancelled) return;

          const manifest = normalizeManifest(event.payload);
          setDismissedVersion((current) => (
            current && manifest?.version === current ? current : null
          ));
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
      disposeRuntimeState?.();
      disposeStatus?.();
    };
  }, [shouldEnableUpdater]);

  const pendingUpdate = availableUpdate ?? normalizeManifest(runtimeInfo?.pendingUpdate);
  const effectivePendingUpdate =
    pendingUpdate && pendingUpdate.version !== dismissedVersion ? pendingUpdate : null;
  const hasStatusMessage = Boolean(statusMessage);
  const statusLooksLikeError = Boolean(statusMessage && /(failed|error|signature)/i.test(statusMessage));

  const runManualUpdateCheck = async () => {
    setChecking(true);
    setDismissedVersion(null);
    setManualCheckActive(true);
    setStatusMessage('Checking for the latest Ritual desktop update...');

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
      setStatusMessage('Update check failed. Please try again in a moment.');
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
      setStatusMessage(errorToMessage(error));
    }
  };

  const dismissUpdaterModal = () => {
    if (effectivePendingUpdate?.version) {
      setDismissedVersion(effectivePendingUpdate.version);
    }

    if (!installing) {
      setChecking(false);
      setStatusMessage(null);
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
            Use the button below to check for the latest Ritual desktop update and install it before continuing.
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

  if (!shouldEnableUpdater) {
    return null;
  }

  if (effectivePendingUpdate || hasStatusMessage) {
    const title = statusLooksLikeError
      ? 'Ritual Update Failed'
      : installing
        ? 'Installing Ritual Update'
        : effectivePendingUpdate
          ? 'Ritual Update Ready'
          : 'Ritual Desktop';

    return (
      <div
        aria-modal="true"
        className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/20 px-6 backdrop-blur-[2px]"
        role="dialog"
      >
        <div className="w-full max-w-[460px] rounded-[30px] border border-black/10 bg-white p-8 shadow-[0_36px_90px_rgba(0,0,0,0.24)]">
          <div className="flex items-start gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border border-black/10 bg-[#f7f7f5]">
              <img
                alt=""
                className="h-10 w-10 object-contain"
                src="/images/logo_fix1.svg"
              />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-[22px] font-semibold leading-7 text-[#202124]">{title}</h2>

              {effectivePendingUpdate ? (
                <p className="mt-4 text-[16px] leading-7 text-[#2f3134]">
                  Ritual {effectivePendingUpdate.version} is ready to install.
                </p>
              ) : null}

              {effectivePendingUpdate?.body ? (
                <p className="mt-3 max-h-32 overflow-auto whitespace-pre-line text-[14px] leading-6 text-[#5d636b]">
                  {effectivePendingUpdate.body}
                </p>
              ) : null}

              {statusMessage ? (
                <p
                  className={`mt-4 text-[14px] leading-6 ${
                    statusLooksLikeError ? 'text-[#a13d2d]' : 'text-[#5d636b]'
                  }`}
                >
                  {statusMessage}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-8 flex justify-end gap-3">
            <Button
              disabled={installing}
              onClick={dismissUpdaterModal}
              size="sm"
              variant="outline"
            >
              {effectivePendingUpdate ? 'Later' : 'OK'}
            </Button>
            {effectivePendingUpdate ? (
              <Button disabled={checking || installing} onClick={installUpdateNow} size="sm">
                {installing ? 'Installing...' : 'Install'}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
