// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown };
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return Boolean(w.__TAURI__ || w.__TAURI_IPC__ || userAgent.includes('RitualDesktop/'));
}

function getDesktopVersion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const match = navigator.userAgent.match(/RitualDesktop\/([0-9A-Za-z.\-_]+)/);
  return match?.[1] ?? null;
}

function isSmokeTestEnabled(currentRuntime: 'desktop' | 'web'): boolean {
  if (currentRuntime === 'desktop') {
    return process.env.NEXT_PUBLIC_SENTRY_SMOKE_TEST_DESKTOP === '1';
  }
  return process.env.NEXT_PUBLIC_SENTRY_SMOKE_TEST_WEB === '1';
}

function emitSmokeTestEvent(currentRuntime: 'desktop' | 'web') {
  if (typeof window === 'undefined' || !isSmokeTestEnabled(currentRuntime)) return;

  const sessionKey = `ritual-sentry-smoke:${currentRuntime}`;
  try {
    if (window.sessionStorage.getItem(sessionKey) === '1') {
      return;
    }
    window.sessionStorage.setItem(sessionKey, '1');
  } catch {
    // Ignore storage failures and continue attempting the smoke event.
  }

  const desktopVersion = getDesktopVersion();
  window.setTimeout(() => {
    Sentry.captureMessage(`Sentry smoke test: ${currentRuntime}`, {
      level: 'info',
      tags: {
        runtime: currentRuntime,
        surface: currentRuntime === 'desktop' ? 'desktop-webview' : 'web-client',
        smoke_test: 'true',
        ...(desktopVersion ? { desktop_version: desktopVersion } : {}),
      },
      extra: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    });

    void Sentry.flush(2000).catch(() => {
      // Non-fatal; the event may still be sent by the transport later.
    });
  }, 0);
}

function installDesktopPerformanceDebugging(currentRuntime: 'desktop' | 'web', enabled: boolean) {
  if (typeof window === 'undefined' || currentRuntime !== 'desktop' || !enabled) return;

  const installKey = '__ritual_sentry_desktop_perf_debug_installed__';
  const globalWindow = window as unknown as Window & Record<string, unknown>;
  if (globalWindow[installKey]) return;
  globalWindow[installKey] = true;

  if (typeof PerformanceObserver === 'undefined') return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = Number(entry.duration || 0);
        if (!Number.isFinite(duration) || duration < 120) continue;

        Sentry.addBreadcrumb({
          category: 'desktop.performance.longtask',
          level: duration >= 500 ? 'warning' : 'info',
          message: `Desktop long task detected (${duration.toFixed(1)}ms)`,
          data: {
            duration_ms: Number(duration.toFixed(1)),
            entry_name: entry.name,
            entry_type: entry.entryType,
            path: window.location.pathname,
          },
        });

        if (duration >= 500) {
          Sentry.captureMessage('Desktop long task detected', {
            level: 'warning',
            tags: {
              runtime: 'desktop',
              surface: 'desktop-webview',
              perf_debug: 'true',
            },
            extra: {
              duration_ms: Number(duration.toFixed(1)),
              entry_name: entry.name,
              entry_type: entry.entryType,
              path: window.location.pathname,
            },
          });
        }
      }
    });

    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Long task observer is not available in all runtimes.
  }
}

function getEventText(event: Sentry.Event): string {
  const exceptionText = event.exception?.values
    ?.map((value) => `${value.type || ''} ${value.value || ''}`)
    .join(' ');
  return [
    event.message,
    exceptionText,
    event.request?.url,
  ].filter(Boolean).join(' ');
}

function isKnownNetworkNoise(event: Sentry.Event): boolean {
  const text = getEventText(event);
  return (
    /AbortError/i.test(text)
    || /The operation was aborted/i.test(text)
    || /cancelled/i.test(text)
    || /chrome-extension:\/\//i.test(text)
    || /moz-extension:\/\//i.test(text)
  );
}

const runtime = isDesktopRuntime() ? 'desktop' : 'web';
const forceDesktopPerfSampling =
  runtime === 'desktop' &&
  (
    process.env.NEXT_PUBLIC_SENTRY_DESKTOP_DEBUG_PERF === '1'
    || process.env.NEXT_PUBLIC_SENTRY_SMOKE_TEST_DESKTOP === '1'
  );
const SENTRY_DSN = runtime === 'desktop'
  ? process.env.NEXT_PUBLIC_SENTRY_DESKTOP_DSN?.trim()
    || process.env.NEXT_PUBLIC_SENTRY_WEB_DSN?.trim()
    || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  : process.env.NEXT_PUBLIC_SENTRY_WEB_DSN?.trim()
    || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
    || process.env.NEXT_PUBLIC_SENTRY_DESKTOP_DSN?.trim();

const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim()
  || process.env.VERCEL_ENV?.trim()
  || process.env.NODE_ENV;

const release =
  process.env.NEXT_PUBLIC_SENTRY_RELEASE?.trim()
  || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.trim()
  || undefined;

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment,
    release,
    enableLogs: true,

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: forceDesktopPerfSampling ? 1.0 : (process.env.NODE_ENV === 'production' ? 0.1 : 1.0),

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    replaysOnErrorSampleRate: 1.0,

    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: forceDesktopPerfSampling ? 1.0 : (process.env.NODE_ENV === 'production' ? 0.1 : 0.0),

    // You can remove this option if you're not planning to use the Sentry Session Replay feature:
    integrations: [
      Sentry.replayIntegration({
        // Additional Replay configuration goes in here, for example:
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    initialScope: {
      tags: {
        runtime,
        surface: runtime === 'desktop' ? 'desktop-webview' : 'web-client',
        ...(getDesktopVersion() ? { desktop_version: getDesktopVersion() as string } : {}),
      },
    },

    // Filter out some common errors. Do not globally suppress fetch/network
    // failures; those often indicate real Railway/Vercel/backend availability
    // regressions for Ritual.
    ignoreErrors: [
      // Browser extensions
      'Non-Error promise rejection captured',
      'ChunkLoadError',
    ],

    beforeSend(event) {
      if (isKnownNetworkNoise(event)) {
        return null;
      }
      // Avoid console.error here — Next.js dev overlay treats it as a runtime error.
      // Opt-in: NEXT_PUBLIC_SENTRY_DEBUG=1
      if (
        process.env.NODE_ENV === 'development' &&
        process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1'
      ) {
        console.debug('Sentry event (dev mode):', event);
      }
      return event;
    },
    beforeSendLog(log) {
      if (process.env.NODE_ENV === 'production' && log.level === 'debug') {
        return null;
      }
      return log;
    },
  });

  emitSmokeTestEvent(runtime);
  installDesktopPerformanceDebugging(runtime, forceDesktopPerfSampling);
}
