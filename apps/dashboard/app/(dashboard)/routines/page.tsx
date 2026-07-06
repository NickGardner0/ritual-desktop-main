import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RoutinesClient } from './routines-client';

export const metadata: Metadata = {
  title: 'Routines | Ritual',
  description: 'Recurring task and AI workflow routines.',
};

function RoutinesLoading() {
  return (
    <div className="flex h-full flex-col bg-[var(--content-bg)]">
      <div className="mx-auto w-full max-w-[720px] px-6 pt-5 lg:px-8">
        <div className="h-7 w-32 animate-pulse rounded-sm bg-[#f3f3f2]" />
        <div className="mt-3 h-7 w-full animate-pulse rounded-sm bg-[#f3f3f2]" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-9 animate-pulse rounded-sm bg-[#f3f3f2]" />
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
