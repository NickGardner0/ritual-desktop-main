import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RoutinesClient } from './routines-client';

export const metadata: Metadata = {
  title: 'Routines | Ritual',
  description: 'Recurring task and AI workflow routines.',
};

function RoutinesLoading() {
  return (
    <div className="grid h-full grid-cols-[minmax(260px,320px)_minmax(400px,1fr)] bg-[var(--content-bg)]">
      <div className="border-r border-[var(--border-subtle)] p-6">
        <div className="h-8 w-36 animate-pulse rounded-sm bg-[#f3f3f2]" />
        <div className="mt-4 h-7 w-full animate-pulse rounded-sm bg-[#f3f3f2]" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-9 animate-pulse rounded-[6px] bg-[#f3f3f2]" />
          ))}
        </div>
      </div>
      <div className="p-6">
        <div className="h-8 w-64 animate-pulse rounded-sm bg-[#f3f3f2]" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="h-10 animate-pulse rounded-[6px] bg-[#f3f3f2]" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RoutinesPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-[var(--content-bg)]">
      <Suspense fallback={<RoutinesLoading />}>
        <RoutinesClient />
      </Suspense>
    </div>
  );
}
