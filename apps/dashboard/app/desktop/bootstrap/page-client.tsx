"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { recordDesktopShellEvent, recordLaunchMilestone, showMainWindow } from '@/lib/native-gateway';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { apiFetch } from '@/lib/api/client';

const BFF_API_BASE = 'BFF /api';

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
  return query ? `/dashboard?${query}` : '/dashboard';
}

export function DesktopBootstrapClient({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const { isDesktop } = useDesktopCapabilities();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [backendMessage, setBackendMessage] = useState<string>('Checking backend readiness...');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationStartedRef = useRef(false);

  const targetPath = useMemo(
    () => buildDesktopTarget(searchParams),
    [searchParams],
  );

  useEffect(() => {
    recordLaunchMilestone('shell_bootstrap', { desktop: isDesktop });
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop) {
      window.location.replace('/desktop-only');
    }
  }, [isDesktop]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4000);

    async function checkBackend() {
      try {
        const response = await apiFetch('/api/ready', { signal: controller.signal });

        if (!response.ok) {
          setBackendStatus('error');
          setBackendMessage(`Backend readiness returned HTTP ${response.status}.`);
          void recordDesktopShellEvent('desktop.bootstrap.backend_not_ready', 'warn', {
            status: response.status,
            backendBase: BFF_API_BASE,
          });
          return;
        }

        setBackendStatus('ready');
        setBackendMessage('Backend reported ready.');
        void recordDesktopShellEvent('desktop.bootstrap.backend_ready', 'info', {
          backendBase: BFF_API_BASE,
          targetPath,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown backend bootstrap failure.';
        setBackendStatus('error');
        setBackendMessage(message);
        void recordDesktopShellEvent('desktop.bootstrap.backend_check_failed', 'warn', {
          backendBase: BFF_API_BASE,
          error: message,
        });
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
    if (!isDesktop || navigationStartedRef.current) {
      return;
    }

    navigationStartedRef.current = true;
    setIsNavigating(true);
    const timer = window.setTimeout(() => {
      const nextTarget = new URL(targetPath, window.location.origin);
      void recordDesktopShellEvent('desktop.bootstrap.redirect_dashboard', 'info', {
        targetPath,
        redirectUrl: `${nextTarget.pathname}${nextTarget.search}`,
        backendStatus: 'not_waited',
      });
      window.location.replace(`${nextTarget.pathname}${nextTarget.search}`);
    }, 25);

    return () => window.clearTimeout(timer);
  }, [targetPath]);

  useEffect(() => {
    if (backendStatus === 'ready') {
      setShowDiagnostics(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowDiagnostics(true);
      void recordDesktopShellEvent('desktop.bootstrap.diagnostics_shown', 'warn', {
        backendStatus,
        backendMessage,
        targetPath,
      });
      void showMainWindow();
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [backendMessage, backendStatus, targetPath]);

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
            <dd>{String(typeof window !== 'undefined' ? isDesktop : false)}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Auth handoff</dt>
            <dd>Bootstrap no longer waits on Clerk before redirecting.</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Dashboard redirect</dt>
            <dd>Bootstrap redirects immediately; backend readiness is diagnostics-only.</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Backend readiness</dt>
            <dd>{backendStatus}: {backendMessage}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
            <dt className="min-w-[170px] font-medium text-[#8a6f47]">Backend API</dt>
            <dd className="break-all">{BFF_API_BASE}</dd>
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
            onClick={() => {
              void recordDesktopShellEvent('desktop.bootstrap.reload_clicked', 'info', {
                backendStatus,
              });
              window.location.reload();
            }}
          >
            Reload bootstrap
          </button>
          <button
            type="button"
            className="rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[#1d1a16] transition hover:bg-black/5"
            onClick={() => {
              setIsNavigating(true);
              void recordDesktopShellEvent('desktop.bootstrap.continue_anyway', 'warn', {
                backendStatus,
                targetPath,
              });
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
