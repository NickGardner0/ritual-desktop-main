import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RoutinesClient } from './routines-client';

export const metadata: Metadata = {
  title: 'Routines | Ritual',
  description: 'Recurring task and AI workflow routines.',
};

function RoutinesLoading() {
  return (
    <div className="h-full overflow-auto bg-white px-8 py-6">
      <div className="mb-8 flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded-[10px] bg-[#f1f1f0]" />
        <div className="h-12 w-12 animate-pulse rounded-full bg-[#f1f1f0]" />
      </div>
      <div className="mx-auto max-w-[860px] space-y-5">
        <div className="h-[300px] animate-pulse rounded-[16px] border border-[#ececec] bg-[#fafafa]" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-[176px] animate-pulse rounded-[16px] border border-[#ececec] bg-[#fafafa]" />
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
