'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { runWhenIdle } from '@/lib/run-when-idle';

const DeferredChromeSheet = lazy(() => import('./deferred-chrome-sheet'));

function isAuxiliaryDesktopWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get('ritual_sidebar_window') === '1'
    || params.get('ritual_settings_window') === '1'
    || params.get('ritual_voice_hud_window') === '1'
  );
}

export function DeferredChrome() {
  const [ready, setReady] = useState(() => isAuxiliaryDesktopWindow());

  useEffect(() => {
    if (ready) return undefined;
    return runWhenIdle(() => setReady(true));
  }, [ready]);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <DeferredChromeSheet />
    </Suspense>
  );
}
