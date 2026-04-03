// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
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

    initialScope: {
      tags: {
        runtime: 'web',
        surface: 'next-edge',
      },
    },
  });
}
