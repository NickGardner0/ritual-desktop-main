'use client';

import * as Sentry from '@sentry/nextjs';
import { useState } from 'react';
import { invokeDesktopCommand } from '@/lib/desktop-bridge/commands';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';
import { sentryStructuredLog } from '@/lib/sentry-structured-logger';

type SmokeResult = {
  label: string;
  ok: boolean;
  detail: string;
};

function desktopVersion(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.userAgent.match(/RitualDesktop\/([0-9A-Za-z.\-_]+)/)?.[1];
}

export default function SentrySmokePage() {
  const [results, setResults] = useState<SmokeResult[]>([]);
  const [running, setRunning] = useState(false);
  const runtime = isDesktopTauriRuntime() ? 'desktop' : 'web';

  const append = (result: SmokeResult) => {
    setResults((current) => [result, ...current].slice(0, 12));
  };

  const runClientSmoke = async () => {
    Sentry.setTag('runtime', runtime);
    Sentry.setTag('surface', runtime === 'desktop' ? 'desktop-webview' : 'web-client');
    Sentry.setTag('route', '/sentry-smoke');
    const version = desktopVersion();
    if (version) Sentry.setTag('desktop_version', version);
    sentryStructuredLog('info', 'Sentry smoke structured log: client', {
      smoke_test: true,
      runtime,
      surface: runtime === 'desktop' ? 'desktop-webview' : 'web-client',
      route: '/sentry-smoke',
      desktop_version: version,
    });
    Sentry.captureMessage(`Sentry smoke test: ${runtime}-client`, {
      level: 'info',
      tags: { smoke_test: 'true' },
    });
    await Sentry.flush(2000).catch(() => undefined);
    append({ label: 'Client', ok: true, detail: `${runtime} client event queued` });
  };

  const runNextSmoke = async () => {
    const response = await fetch('/api/sentry-smoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime,
        surface: 'next-route',
        desktop_version: desktopVersion(),
      }),
    });
    append({ label: 'Next.js', ok: response.ok, detail: await response.text() });
  };

  const runBackendSmoke = async () => {
    const response = await fetch('/api/observability/sentry-smoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: 'backend',
        surface: 'fastapi',
        desktop_version: desktopVersion(),
      }),
    });
    append({ label: 'Backend', ok: response.ok, detail: await response.text() });
  };

  const runNativeSmoke = async () => {
    if (!isDesktopTauriRuntime()) {
      append({ label: 'Native desktop', ok: false, detail: 'Not running inside Tauri desktop runtime' });
      return;
    }
    try {
      await invokeDesktopCommand('desktop_capture_sentry_smoke', {});
      append({ label: 'Native desktop', ok: true, detail: 'Native Tauri event queued' });
    } catch (error) {
      append({
        label: 'Native desktop',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const runAll = async () => {
    setRunning(true);
    try {
      await runClientSmoke();
      await runNextSmoke();
      await runBackendSmoke();
      await runNativeSmoke();
    } catch (error) {
      append({
        label: 'Smoke test',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fefefe] px-8 py-10 text-[#111827]">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-neutral-500">Observability</p>
          <h1 className="text-3xl font-semibold tracking-normal">Sentry smoke tests</h1>
          <p className="max-w-2xl text-base text-neutral-600">
            Sends authenticated test events for the web client, Next.js route handler, FastAPI backend,
            and native Tauri desktop shell when available.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runAll}
            disabled={running}
            className="rounded-md border border-neutral-300 bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {running ? 'Sending...' : 'Run all smoke tests'}
          </button>
          <button type="button" onClick={runClientSmoke} className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
            Client
          </button>
          <button type="button" onClick={runNextSmoke} className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
            Next.js
          </button>
          <button type="button" onClick={runBackendSmoke} className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
            Backend
          </button>
          <button type="button" onClick={runNativeSmoke} className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
            Native desktop
          </button>
        </div>

        <div className="divide-y divide-neutral-200 border border-neutral-200">
          {results.length === 0 ? (
            <div className="p-4 text-sm text-neutral-500">No smoke events sent yet.</div>
          ) : (
            results.map((result, index) => (
              <div key={`${result.label}-${index}`} className="grid grid-cols-[140px_80px_1fr] gap-3 p-4 text-sm">
                <div className="font-medium">{result.label}</div>
                <div className={result.ok ? 'text-green-700' : 'text-red-700'}>
                  {result.ok ? 'queued' : 'failed'}
                </div>
                <pre className="overflow-auto whitespace-pre-wrap text-neutral-600">{result.detail}</pre>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
