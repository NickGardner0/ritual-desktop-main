// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

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
