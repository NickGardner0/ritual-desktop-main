import { Suspense } from 'react';
import { LogsClient } from './logs-client';
import { ActivityLoading } from './loading';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Logs | Ritual',
  description: 'Browse and filter all your habit logs',
};

export default function LogsPage() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <Suspense fallback={<ActivityLoading />}>
        <LogsClient />
      </Suspense>
    </div>
  );
}
