'use client';

import { lazy, Suspense, useEffect, useState } from 'react';

const DeferredFontSheet = lazy(() => import('./deferred-font-sheet'));

export function DeferredFonts() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const idle = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback.bind(window)
      : (callback: () => void) => window.setTimeout(callback, 1);
    const cancel = typeof window.cancelIdleCallback === 'function'
      ? window.cancelIdleCallback.bind(window)
      : (handle: number) => window.clearTimeout(handle);
    const handle = idle(() => setReady(true));
    return () => {
      cancel(handle);
    };
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <DeferredFontSheet />
    </Suspense>
  );
}
