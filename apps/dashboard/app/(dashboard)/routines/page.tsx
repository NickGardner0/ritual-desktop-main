import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RoutinesClient } from './routines-client';

export const metadata: Metadata = {
  title: 'Routines | Ritual',
  description: 'Recurring task and AI workflow routines.',
};

function RoutinesLoading() {
  return (
    <div className="h-full overflow-auto bg-white">
      <div className="mx-auto max-w-[980px] px-8 pb-16 pt-16">
        <div className="mb-7 flex items-center justify-between">
          <div className="h-7 w-28 animate-pulse rounded-[8px] bg-neutral-100" />
          <div className="h-10 w-32 animate-pulse rounded-[10px] bg-neutral-100" />
        </div>
        <div className="mb-10 h-[288px] animate-pulse rounded-[14px] border border-dashed border-neutral-200 bg-white" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-[176px] animate-pulse rounded-[14px] border border-neutral-200 bg-white" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RoutinesPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-white">
      <Suspense fallback={<RoutinesLoading />}>
        <RoutinesClient />
      </Suspense>
    </div>
  );
}
