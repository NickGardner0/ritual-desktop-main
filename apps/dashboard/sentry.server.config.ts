// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN =
  process.env.SENTRY_WEB_DSN?.trim()
  || process.env.NEXT_PUBLIC_SENTRY_WEB_DSN?.trim()
  || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

const environment =
  process.env.SENTRY_ENVIRONMENT?.trim()
  || process.env.VERCEL_ENV?.trim()
  || process.env.NODE_ENV;

const release =
  process.env.SENTRY_RELEASE?.trim()
  || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  || undefined;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment,
    release,

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    // Filter out extension/noisy promise errors only. Network/fetch failures are
    // operational signals for Ritual and should be visible in Sentry.
    ignoreErrors: [
      'Non-Error promise rejection captured',
    ],

    initialScope: {
      tags: {
        runtime: 'web',
        surface: 'next-server',
      },
    },

    beforeSend(event, hint) {
      // Log errors to console in development (but still send to Sentry for testing)
      if (process.env.NODE_ENV === 'development') {
        console.error('Sentry event (dev mode):', event);
      }
      return event;
    },
  });
}
