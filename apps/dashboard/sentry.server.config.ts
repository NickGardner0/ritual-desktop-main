// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    // Filter out some common errors
    ignoreErrors: [
      'Non-Error promise rejection captured',
      'NetworkError',
      'Failed to fetch',
    ],

    beforeSend(event, hint) {
      // Log errors to console in development (but still send to Sentry for testing)
      if (process.env.NODE_ENV === 'development') {
        console.error('Sentry event (dev mode):', event);
      }
      return event;
    },
  });
} else {
  console.log('Sentry DSN not configured. Error tracking is disabled.');
}

