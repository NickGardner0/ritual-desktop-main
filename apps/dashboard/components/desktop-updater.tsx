'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  checkDesktopForUpdates,
  getDesktopCompatibilityIssue,
  getDesktopRuntimeInfo,
  installDesktopUpdate,
  type DesktopRuntimeInfo,
  type UpdateManifest,
} from '@/lib/desktop-runtime';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';

type UpdateStatusPayload = {
  error?: string | null;
  status?: string | null;
};

type RecoveryAction = {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
};

const DESKTOP_ENV_QUERY_PARAM = 'ritual_desktop_env';
const NATIVE_UPDATE_PROMPT_CAPABILITY = 'native-update-prompt-v1';
const RITUAL_APP_ICON_SRC = '/brand/ritual-app-icon.png';
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

function RecoveryNotice({
  actions,
  details,
  message,
  title,
  tone = 'info',
}: {
  actions: RecoveryAction[];
  details?: string | null;
  message: string;
  title: string;
  tone?: 'info' | 'error';
}) {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[1300] w-[min(390px,calc(100vw-40px))] rounded-[12px] border border-black/15 bg-[#f6f6f7]/95 p-4 text-[#1d1d1f] shadow-[0_16px_48px_rgba(0,0,0,0.22)] backdrop-blur-xl"
      role="status"
    >
      <div className="flex items-start gap-3">
        <img
          alt=""
          className="h-11 w-11 shrink-0 rounded-[10px] object-contain shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
          src={RITUAL_APP_ICON_SRC}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-5 text-[#1d1d1f]">{title}</h2>
          <p
            className={`mt-1 text-[13px] leading-5 ${
              tone === 'error' ? 'text-[#9a3b2d]' : 'text-[#555960]'
            }`}
          >
            {message}
          </p>
          {details ? (
            <p className="mt-1 max-h-20 overflow-auto whitespace-pre-line text-[12px] leading-5 text-[#70747b]">
              {details}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {actions.map((action) => (
          <button
            className={
              action.variant === 'primary'
                ? 'h-8 min-w-[82px] rounded-[7px] bg-[#007aff] px-3 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition hover:bg-[#006ee6] disabled:cursor-not-allowed disabled:bg-[#a2a7b0]'
                : 'h-8 min-w-[72px] rounded-[7px] border border-black/15 bg-white px-3 text-[13px] font-medium text-[#1d1d1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:bg-[#fbfbfc] disabled:cursor-not-allowed disabled:opacity-50'
            }
            disabled={action.disabled}
            key={action.label}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DesktopUpdater() {
  const { isDesktop } = useDesktopCapabilities();
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
    isDesktop &&
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
  const supportsNativeUpdatePrompt = Boolean(
    runtimeInfo?.capabilities.includes(NATIVE_UPDATE_PROMPT_CAPABILITY),
  );

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
      <RecoveryNotice
        actions={[
          effectivePendingUpdate
            ? {
                disabled: installing,
                label: installing ? 'Installing...' : `Install ${effectivePendingUpdate.version ?? 'update'}`,
                onClick: installUpdateNow,
                variant: 'primary',
              }
            : {
                disabled: checking || !shouldEnableUpdater,
                label: checking ? 'Checking...' : 'Check Update',
                onClick: runManualUpdateCheck,
                variant: 'primary',
              },
          ...(statusMessage
            ? [{
                disabled: checking || installing,
                label: 'Dismiss',
                onClick: () => setStatusMessage(null),
                variant: 'secondary' as const,
              }]
            : []),
        ]}
        details={statusMessage}
        message={
          compatibilityIssue.kind === 'version'
            ? `Required desktop version: ${compatibilityIssue.requiredVersion}. Current version: ${compatibilityIssue.currentVersion ?? 'unknown'}.`
            : `Missing desktop capability: ${requiredCapabilities}.`
        }
        title="Desktop update required"
      />
    );
  }

  if (!shouldEnableUpdater) {
    return null;
  }

  if (effectivePendingUpdate || hasStatusMessage) {
    if (supportsNativeUpdatePrompt && !statusLooksLikeError) {
      return null;
    }

    if (!runtimeInfo && effectivePendingUpdate && !statusLooksLikeError) {
      return null;
    }

    const title = statusLooksLikeError
      ? 'Ritual Update Failed'
      : installing
        ? 'Installing Ritual Update'
        : effectivePendingUpdate && !supportsNativeUpdatePrompt
          ? 'Desktop update recovery'
          : effectivePendingUpdate
            ? 'Ritual Update Ready'
          : 'Ritual Desktop';

    return (
      <RecoveryNotice
        actions={[
          {
            disabled: installing,
            label: effectivePendingUpdate ? 'Later' : 'OK',
            onClick: dismissUpdaterModal,
            variant: 'secondary',
          },
          ...(effectivePendingUpdate
            ? [{
                disabled: checking || installing,
                label: installing ? 'Installing...' : 'Install',
                onClick: installUpdateNow,
                variant: 'primary' as const,
              }]
            : []),
        ]}
        details={effectivePendingUpdate?.body}
        message={
          statusMessage
            ? statusMessage
            : effectivePendingUpdate && !supportsNativeUpdatePrompt
              ? `Ritual ${effectivePendingUpdate.version} is ready. This installed shell is too old to show the native macOS updater prompt, so this recovery notice can install it.`
              : effectivePendingUpdate
                ? `Ritual ${effectivePendingUpdate.version} is ready to install.`
                : 'Ritual desktop update status changed.'
        }
        title={title}
        tone={statusLooksLikeError ? 'error' : 'info'}
      />
    );
  }

  return null;
}
