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
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-10 w-72 animate-pulse rounded-sm bg-muted" />
      </div>
      <div className="flex flex-1 gap-4 p-5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="min-w-[260px] flex-1 animate-pulse rounded-sm border border-border bg-muted/20 p-4" />
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
