/**
 * Tasks Page - Kanban board for ritual tracking
 */

import { Suspense } from 'react';
import { TasksClient } from './tasks-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tasks | Ritual',
  description: 'Track your daily rituals and habits',
};

function TasksLoading() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-52 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-1 gap-4 p-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="min-w-[280px] flex-1 animate-pulse rounded border border-border bg-muted/20 p-4" />
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      <Suspense fallback={<TasksLoading />}>
        <TasksClient />
      </Suspense>
    </div>
  );
}
