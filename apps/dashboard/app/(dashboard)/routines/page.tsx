import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RoutinesClient } from './routines-client';

export const metadata: Metadata = {
  title: 'Routines | Ritual',
  description: 'Recurring task and AI workflow routines.',
};

function RoutinesLoading() {
  return (
    <div className="h-full overflow-auto bg-[var(--content-bg)] px-8 py-8">
      <div className="mx-auto mb-7 flex max-w-[1160px] items-center justify-between">
        <div className="h-7 w-28 animate-pulse rounded-[8px] bg-[#f0efeb]" />
        <div className="h-9 w-32 animate-pulse rounded-[8px] bg-[#f0efeb]" />
      </div>
      <div className="mx-auto max-w-[1160px] space-y-5">
        <div className="h-[270px] animate-pulse rounded-[14px] border border-dashed border-[#e8e0d2] bg-[#fffefa]" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-[206px] animate-pulse rounded-[14px] border border-[#ece7dd] bg-[#fffefa]" />
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
