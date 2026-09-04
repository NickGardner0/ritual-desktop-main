'use client';

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { runWhenIdle } from '@/lib/run-when-idle';

const OpenPanelRuntime = lazy(() => import('./openpanel-runtime'));

export function OpenPanelProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => runWhenIdle(() => setReady(true)), []);

  return (
    <>
      {ready ? (
        <Suspense fallback={null}>
          <OpenPanelRuntime />
        </Suspense>
      ) : null}
      {children}
    </>
  );
}
