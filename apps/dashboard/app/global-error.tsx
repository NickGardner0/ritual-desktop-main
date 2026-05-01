'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import Link from 'next/link';
import { useDesktopAssetRecovery } from '@/lib/desktop-asset-recovery';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { errorText, isRecoverable, mode } = useDesktopAssetRecovery(error, 'global-error');
  const isRecovering = mode === 'scheduled';
  const recoveryTried = mode === 'cooldown';

  useEffect(() => {
    // Log the error to Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="desktop">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">
                {isRecovering ? 'Refreshing application' : 'Something went wrong!'}
              </h1>
              <p className="text-lg text-gray-600">
                {isRecovering
                  ? 'Ritual detected a stale desktop asset mismatch and is reloading automatically.'
                  : recoveryTried
                    ? 'Ritual already attempted one automatic refresh for a stale desktop asset mismatch. Reload once more if this screen stays here.'
                    : "We've been notified and are working on a fix."}
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && errorText && (
              <div className="mt-4 rounded-lg bg-red-50 p-4 text-left">
                <p className="text-sm font-medium text-red-800">Error Details (dev only):</p>
                <pre className="mt-2 overflow-auto text-xs text-red-700">
                  {errorText}
                </pre>
              </div>
            )}

            <button
              onClick={() => {
                if (isRecoverable) {
                  window.location.reload();
                  return;
                }
                reset();
              }}
              className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {isRecovering ? 'Reload now' : 'Try again'}
            </button>

            <Link
              href="/"
              className="inline-block text-sm text-gray-600 hover:text-gray-900 underline"
            >
              Go back to home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
