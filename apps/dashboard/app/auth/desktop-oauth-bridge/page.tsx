'use client'

import { Suspense, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { BrailleSpinner } from '@/components/ui/braille-spinner';

function buildDeepLink(searchParams: URLSearchParams): string {
  const copiedParams = new URLSearchParams(searchParams.toString());
  return copiedParams.toString()
    ? `ritual://auth/callback?${copiedParams.toString()}`
    : 'ritual://auth/callback';
}

function DesktopOAuthBridgePageInner() {
  const searchParams = useSearchParams();
  const deepLink = useMemo(() => buildDeepLink(searchParams), [searchParams]);

  useEffect(() => {
    window.location.replace(deepLink);
  }, [deepLink]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <BrailleSpinner className="mx-auto text-2xl text-gray-900" />
        <h1 className="mt-6 text-2xl font-medium text-gray-900">
          Returning to Ritual…
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Your browser finished Apple or Google sign-in. Ritual should reopen automatically to complete authentication.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href={deepLink}
            className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Open Ritual
          </a>
          <Link
            href="/desktop-only"
            className="rounded-sm border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
          >
            Need help?
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function DesktopOAuthBridgePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-white px-6">
          <div className="text-center text-gray-900">
            <BrailleSpinner className="mx-auto text-2xl text-gray-900" />
            <p className="mt-4 text-sm text-gray-600">Preparing Ritual sign-in…</p>
          </div>
        </main>
      }
    >
      <DesktopOAuthBridgePageInner />
    </Suspense>
  );
}
