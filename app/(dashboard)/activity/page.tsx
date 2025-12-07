import { Suspense } from 'react';
import { ActivityClient } from './activity-client';
import { ActivityLoading } from './loading';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Activity | Ritual',
  description: 'Browse and filter all your habit logs',
};

export default function ActivityPage() {
  return (
    <div className="flex-1 overflow-hidden">
      <Suspense fallback={<ActivityLoading />}>
        <ActivityClient />
      </Suspense>
    </div>
  );
}

