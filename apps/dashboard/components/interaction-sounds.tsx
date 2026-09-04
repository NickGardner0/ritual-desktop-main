'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { runWhenIdle } from '@/lib/run-when-idle';

const InteractionSoundsRuntime = lazy(() => import('./interaction-sounds-runtime'));

export function InteractionSounds() {
  const [ready, setReady] = useState(false);

  useEffect(() => runWhenIdle(() => setReady(true)), []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <InteractionSoundsRuntime />
    </Suspense>
  );
}
