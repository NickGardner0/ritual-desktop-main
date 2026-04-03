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

const runtime = isDesktopRuntime() ? 'desktop' : 'web';
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

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    replaysOnErrorSampleRate: 1.0,

    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,

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

    // Filter out some common errors
    ignoreErrors: [
      // Browser extensions
      'Non-Error promise rejection captured',
      'ChunkLoadError',
      // Network errors
      'NetworkError',
      'Failed to fetch',
    ],

    beforeSend(event) {
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
  });
}
