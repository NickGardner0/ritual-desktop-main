'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  checkDesktopForUpdates,
  clearDesktopRuntimeInfoCache,
  getDesktopCompatibilityIssue,
  getDesktopRuntimeInfo,
  installDesktopUpdate,
  type DesktopRuntimeInfo,
  type UpdateManifest,
} from '@/lib/desktop-runtime';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  clearDesktopUpdatePreferencesForNewVersion,
  remindAboutDesktopUpdateLater,
  shouldSuppressDesktopUpdate,
  skipDesktopUpdateVersion,
} from '@/lib/desktop-update-preferences';

export type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'relaunching'
  | 'error';

export type DesktopUpdaterSnapshot = {
  contentLength: number;
  downloaded: number;
  enabled: boolean;
  error: string | null;
  manifest: UpdateManifest | null;
  percentage: number;
  phase: DesktopUpdatePhase;
  runtimeInfo: DesktopRuntimeInfo | null;
};

type UpdateStatusPayload = {
  contentLength?: number | null;
  downloaded?: number | null;
  error?: string | null;
  percentage?: number | null;
  status?: string | null;
};

const DESKTOP_ENV_QUERY_PARAM = 'ritual_desktop_env';
const RUNTIME_STATE_CHANGED_EVENT = 'desktop://runtime-state-changed';
const UPDATE_AVAILABLE_EVENT = 'tauri://update-available';
const UPDATE_STATUS_EVENT = 'tauri://update-status';

const INITIAL_SNAPSHOT: DesktopUpdaterSnapshot = {
  contentLength: 0,
  downloaded: 0,
  enabled: false,
  error: null,
  manifest: null,
  percentage: 0,
  phase: 'idle',
  runtimeInfo: null,
};

let snapshot = INITIAL_SNAPSHOT;
let dismissedVersion: string | null = null;
const subscribers = new Set<() => void>();

function publish(next: Partial<DesktopUpdaterSnapshot>) {
  snapshot = { ...snapshot, ...next };
  subscribers.forEach((subscriber) => subscriber());
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function normalizeManifest(manifest: UpdateManifest | null | undefined): UpdateManifest | null {
  if (!manifest?.version) return null;

  return {
    body: manifest.body ?? null,
    date: manifest.date ?? null,
    version: manifest.version,
  };
}

function updaterEnabled(info: DesktopRuntimeInfo | null, fallbackEnvironment: string | null) {
  const environment = info?.environment || fallbackEnvironment;
  return Boolean(
    info?.updaterActive && (environment === 'production' || environment === 'prod'),
  );
}

function visibleManifest(manifest: UpdateManifest | null) {
  if (!manifest?.version) return null;

  clearDesktopUpdatePreferencesForNewVersion({ version: manifest.version });
  if (
    manifest.version === dismissedVersion ||
    shouldSuppressDesktopUpdate({ version: manifest.version })
  ) {
    return null;
  }

  return manifest;
}

function syncRuntimeInfo(info: DesktopRuntimeInfo | null, fallbackEnvironment: string | null) {
  const manifest = visibleManifest(normalizeManifest(info?.pendingUpdate));
  const compatibilityIssue = getDesktopCompatibilityIssue(info);
  const compatibilityError = compatibilityIssue
    ? compatibilityIssue.kind === 'version'
      ? `Desktop update required. Install Ritual ${compatibilityIssue.requiredVersion} or newer.`
      : 'Desktop update required. This build is missing required desktop capabilities.'
    : null;
  const busy = ['downloading', 'installing', 'relaunching'].includes(snapshot.phase);

  publish({
    enabled:
      updaterEnabled(info, fallbackEnvironment) ||
      Boolean(
        compatibilityIssue &&
          (info?.environment === 'production' ||
            info?.environment === 'prod' ||
            fallbackEnvironment === 'production' ||
            fallbackEnvironment === 'prod'),
      ),
    runtimeInfo: info,
    ...(busy
      ? {}
      : {
          manifest,
          phase: manifest ? 'available' : compatibilityError ? 'error' : 'idle',
          error: manifest ? null : compatibilityError,
          percentage: 0,
          contentLength: 0,
          downloaded: 0,
        }),
  });
}

function errorToMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Update failed. Please try again.';
}

export function useDesktopUpdaterSnapshot() {
  return useSyncExternalStore(subscribe, () => snapshot, () => INITIAL_SNAPSHOT);
}

export async function requestDesktopUpdateInstall() {
  if (!snapshot.manifest || ['downloading', 'installing', 'relaunching'].includes(snapshot.phase)) {
    return;
  }

  publish({
    phase: 'downloading',
    percentage: 0,
    contentLength: 0,
    downloaded: 0,
    error: null,
  });

  try {
    await installDesktopUpdate();
  } catch (error) {
    publish({ phase: 'error', error: errorToMessage(error) });
  }
}

export async function requestDesktopUpdateCheck() {
  if (!snapshot.enabled || ['checking', 'downloading', 'installing'].includes(snapshot.phase)) return;

  dismissedVersion = null;
  publish({ phase: 'checking', error: null });

  try {
    const info = await checkDesktopForUpdates();
    clearDesktopRuntimeInfoCache();
    syncRuntimeInfo(info, info?.environment ?? null);
  } catch (error) {
    publish({ phase: 'error', error: errorToMessage(error) });
  }
}

export function dismissDesktopUpdate() {
  if (snapshot.manifest?.version) dismissedVersion = snapshot.manifest.version;
  publish({ manifest: null, phase: 'idle', error: null, percentage: 0 });
}

export function remindAboutCurrentDesktopUpdate() {
  if (!snapshot.manifest?.version) return;
  remindAboutDesktopUpdateLater({ version: snapshot.manifest.version });
  publish({ manifest: null, phase: 'idle', error: null, percentage: 0 });
}

export function skipCurrentDesktopUpdate() {
  if (!snapshot.manifest?.version) return;
  skipDesktopUpdateVersion({ version: snapshot.manifest.version });
  publish({ manifest: null, phase: 'idle', error: null, percentage: 0 });
}

export function DesktopUpdater() {
  const { isDesktop } = useDesktopCapabilities();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const previewPhase = params.get('ritual_update_preview') as DesktopUpdatePhase | null;
    if (
      process.env.NODE_ENV === 'development' &&
      previewPhase &&
      ['available', 'downloading', 'installing', 'relaunching', 'error'].includes(previewPhase)
    ) {
      publish({
        enabled: true,
        error: previewPhase === 'error' ? 'The update signature could not be verified.' : null,
        manifest: { version: '0.2.0', body: 'Updater preview release notes.', date: null },
        percentage: previewPhase === 'downloading' ? 64 : previewPhase === 'installing' ? 100 : 0,
        phase: previewPhase,
      });
      return;
    }

    if (!isDesktop) return;

    if (
      params.get('ritual_sidebar_window') === '1' ||
      params.get('ritual_settings_window') === '1'
    ) {
      return;
    }

    const queryEnvironment = params.get(DESKTOP_ENV_QUERY_PARAM);
    if (queryEnvironment) {
      window.sessionStorage.setItem(DESKTOP_ENV_QUERY_PARAM, queryEnvironment);
    }
    const fallbackEnvironment =
      queryEnvironment || window.sessionStorage.getItem(DESKTOP_ENV_QUERY_PARAM);

    let cancelled = false;
    let disposeAvailable: (() => void) | undefined;
    let disposeRuntimeState: (() => void) | undefined;
    let disposeStatus: (() => void) | undefined;

    const refreshRuntimeInfo = async () => {
      clearDesktopRuntimeInfoCache();
      const info = await getDesktopRuntimeInfo();
      if (!cancelled) syncRuntimeInfo(info, fallbackEnvironment);
    };

    void refreshRuntimeInfo();

    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        disposeRuntimeState = await listen(RUNTIME_STATE_CHANGED_EVENT, () => {
          void refreshRuntimeInfo();
        });

        disposeAvailable = await listen<UpdateManifest>(UPDATE_AVAILABLE_EVENT, (event) => {
          if (cancelled) return;
          dismissedVersion = null;
          const manifest = visibleManifest(normalizeManifest(event.payload));
          publish({
            manifest,
            phase: manifest ? 'available' : 'idle',
            error: null,
            percentage: 0,
          });
        });

        disposeStatus = await listen<UpdateStatusPayload>(UPDATE_STATUS_EVENT, (event) => {
          if (cancelled) return;

          const payload = event.payload || {};
          const status = (payload.status || '').toUpperCase();

          if (status === 'AVAILABLE') {
            dismissedVersion = null;
            void refreshRuntimeInfo();
            return;
          }

          if (status === 'PENDING' || status === 'DOWNLOADING') {
            publish({
              phase: 'downloading',
              contentLength: payload.contentLength ?? snapshot.contentLength,
              downloaded: payload.downloaded ?? snapshot.downloaded,
              percentage: Math.max(0, Math.min(100, payload.percentage ?? 0)),
              error: null,
            });
            return;
          }

          if (status === 'INSTALLING') {
            publish({ phase: 'installing', percentage: 100, error: null });
            return;
          }

          if (status === 'DONE') {
            publish({ phase: 'relaunching', percentage: 100, error: null });
            return;
          }

          if (status === 'UPTODATE') {
            publish({
              manifest: null,
              phase: 'idle',
              percentage: 0,
              contentLength: 0,
              downloaded: 0,
              error: null,
            });
            return;
          }

          if (status === 'ERROR') {
            publish({ phase: 'error', error: payload.error || 'Update failed. Please try again.' });
          }
        });
      })
      .catch((error) => {
        console.warn('Unable to bind desktop updater listeners:', error);
      });

    return () => {
      cancelled = true;
      disposeAvailable?.();
      disposeRuntimeState?.();
      disposeStatus?.();
    };
  }, [isDesktop]);

  return null;
}
