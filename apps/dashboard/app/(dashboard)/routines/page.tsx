import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RoutinesClient } from './routines-client';

export const metadata: Metadata = {
  title: 'Routines | Ritual',
  description: 'Recurring task and AI workflow routines.',
};

function RoutinesLoading() {
  return (
    <div className="grid h-full grid-cols-[minmax(260px,420px)_minmax(360px,1fr)] bg-[#f7f8f5]">
      <div className="border-r border-[rgba(15,23,42,0.08)] p-6">
        <div className="h-10 w-44 animate-pulse rounded-sm bg-white" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-sm bg-white" />
          ))}
        </div>
      </div>
      <div className="p-6">
        <div className="h-[640px] animate-pulse rounded-sm bg-white" />
      </div>
    </div>
  );
}

export default function RoutinesPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-[#f7f8f5]">
      <Suspense fallback={<RoutinesLoading />}>
        <RoutinesClient />
      </Suspense>
    </div>
  );
}
