"use client";

import { useEffect, useMemo, useState } from 'react';
import { isTauri, showMainWindow } from '@/lib/tauri-utils';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

type BackendStatus = 'checking' | 'ready' | 'error';

type SearchParamsInput =
  | Record<string, string | string[] | undefined>
  | undefined;

function readSingleParam(
  searchParams: SearchParamsInput,
  key: string,
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function buildDesktopTarget(searchParams: SearchParamsInput): string {
  const params = new URLSearchParams();
  const ritualEnv = readSingleParam(searchParams, 'ritual_desktop_env');
  const detachedSidebar = readSingleParam(searchParams, 'ritual_detached_sidebar');
  const mainGlass = readSingleParam(searchParams, 'ritual_main_glass');
  const transparencyProbe = readSingleParam(searchParams, 'ritual_transparency_probe');

  if (ritualEnv) {
    params.set('ritual_desktop_env', ritualEnv);
  }
  if (detachedSidebar === '1') {
    params.set('ritual_detached_sidebar', '1');
  }
  if (mainGlass === '1') {
    params.set('ritual_main_glass', '1');
  }
  if (transparencyProbe === '1') {
    params.set('ritual_transparency_probe', '1');
  }

  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export function DesktopBootstrapClient({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [backendMessage, setBackendMessage] = useState<string>('Checking backend readiness...');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const targetPath = useMemo(
    () => buildDesktopTarget(searchParams),
    [searchParams],
  );

  useEffect(() => {
    if (!isTauri()) {
      window.location.replace('/desktop-only');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4000);

    async function checkBackend() {
      try {
        const response = await fetch(`${PYTHON_API_BASE}/ready`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          setBackendStatus('error');
          setBackendMessage(`Backend readiness returned HTTP ${response.status}.`);
          return;
        }

        setBackendStatus('ready');
        setBackendMessage('Backend reported ready.');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown backend bootstrap failure.';
        setBackendStatus('error');
        setBackendMessage(message);
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void checkBackend();

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!isTauri() || backendStatus !== 'ready' || isNavigating) {
      return;
    }

    setIsNavigating(true);
    const timer = window.setTimeout(() => {
      const nextTarget = new URL('/sign-in', window.location.origin);
      nextTarget.searchParams.set('redirect_url', targetPath);
      window.location.replace(`${nextTarget.pathname}${nextTarget.search}`);
    }, 150);

    return () => window.clearTimeout(timer);
  }, [backendStatus, isNavigating, targetPath]);

  useEffect(() => {
    if (backendStatus === 'ready' || isNavigating) {
      setShowDiagnostics(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowDiagnostics(true);
      void showMainWindow();
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [backendStatus, isNavigating]);

  if (!showDiagnostics) {
    return <main className="min-h-screen bg-transparent" aria-hidden="true" />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f5ee] px-6 py-10 text-[#1d1a16]">
      <div className="w-full max-w-2xl rounded-[28px] border border-black/10 bg-white p-8 shadow-[0_25px_80px_rgba(0,0,0,0.08)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8a6f47]">
          Ritual Desktop Bootstrap
        </p>
        <h1 className="mt-4 text-[30px] font-medium leading-[1.08] tracking-[-0.03em]">
          Ritual is still waiting on startup.
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-[#5a5147]">
          The desktop shell launched, but the hosted app did not finish initializing quickly enough.
          This screen shows the live bootstrap state instead of leaving the window blank.
        </p>

        <dl className="mt-8 space-y-3 text-sm text-[#2e2a25]">
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Tauri detected</dt>
            <dd>{String(typeof window !== 'undefined' ? isTauri() : false)}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Auth handoff</dt>
            <dd>Bootstrap no longer waits on Clerk before redirecting.</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Backend readiness</dt>
            <dd>{backendStatus}: {backendMessage}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Backend API</dt>
            <dd className="break-all">{PYTHON_API_BASE}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Current URL</dt>
            <dd className="break-all">{typeof window !== 'undefined' ? window.location.href : ''}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Next target</dt>
            <dd className="break-all">{targetPath}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">User agent</dt>
            <dd className="break-all">{typeof window !== 'undefined' ? window.navigator.userAgent : ''}</dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-full bg-[#1d1a16] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#2d2720]"
            onClick={() => window.location.reload()}
          >
            Reload bootstrap
          </button>
          <button
            type="button"
            className="rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[#1d1a16] transition hover:bg-black/5"
            onClick={() => {
              setIsNavigating(true);
              window.location.replace(targetPath);
            }}
          >
            Continue anyway
          </button>
        </div>
      </div>
    </main>
  );
}
