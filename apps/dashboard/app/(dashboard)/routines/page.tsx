import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RoutinesClient } from './routines-client';

export const metadata: Metadata = {
  title: 'Routines | Ritual',
  description: 'Recurring task and AI workflow routines.',
};

function RoutinesLoading() {
  return (
    <div className="h-full overflow-auto bg-surface-content px-8 py-6">
      <div className="mb-8 flex items-center justify-between">
        <div className="h-7 w-32 animate-pulse rounded-row bg-surface-panel" />
        <div className="h-9 w-32 animate-pulse rounded-md bg-surface-panel" />
      </div>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-64 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-surface-panel" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-44 animate-pulse rounded-lg border border-[var(--border-subtle)] bg-surface-panel" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RoutinesPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-surface-content">
      <Suspense fallback={<RoutinesLoading />}>
        <RoutinesClient />
      </Suspense>
    </div>
  );
}
