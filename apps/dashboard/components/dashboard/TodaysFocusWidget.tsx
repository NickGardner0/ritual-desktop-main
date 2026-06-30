'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';

import { apiJsonWithAuth } from '@/lib/api/client';
import {
  readLocalVaultTaskRoutineWriteOutboxItems,
  readLocalVaultTasks,
} from '@/lib/privacy/task-vault-adapter';
import { mergeTasksWithOutbox } from '@/lib/tasks/local-first-writes';
import { buildSeedTasks, sortTasksForDisplay } from '@/lib/tasks/seed-data';
import type { Task, TaskListResponse } from '@/lib/tasks/types';

function isTodayTask(task: Task): boolean {
  if (task.status !== 'open') return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const scheduled = task.scheduled_for ? new Date(task.scheduled_for).getTime() : null;
  const due = task.due_at ? new Date(task.due_at).getTime() : null;
  return Boolean((scheduled && scheduled < tomorrowStart) || (due && due < tomorrowStart));
}

export function TodaysFocusWidget() {
  const { getToken } = useAuth();
  const { user } = useUser();

  const tasksQuery = useQuery({
    queryKey: ['tasks', user?.id, 'today', 'focus'],
    queryFn: async () => {
      let backendItems: Task[] | null = null;
      try {
        const response = await apiJsonWithAuth<TaskListResponse>('/api/tasks?view=today&limit=20', getToken, {
          userId: user?.id,
        });
        backendItems = response.items;
      } catch {
        backendItems = null;
      }

      const [vaultItems, outboxItems] = user?.id
        ? await Promise.all([
            backendItems ? Promise.resolve(null) : readLocalVaultTasks(user.id),
            readLocalVaultTaskRoutineWriteOutboxItems(user.id),
          ])
        : [null, null] as const;

      const merged = mergeTasksWithOutbox(backendItems || vaultItems || [], outboxItems);
      const todayTasks = merged.filter(isTodayTask);
      if (todayTasks.length) return sortTasksForDisplay(todayTasks);
      return sortTasksForDisplay(buildSeedTasks(user?.id || 'visual-seed').filter(isTodayTask));
    },
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });

  const focusTasks = useMemo(
    () => (tasksQuery.data || []).slice(0, 3),
    [tasksQuery.data],
  );

  if (focusTasks.length === 0) return null;

  return (
    <div className="border-b border-border pb-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Today&apos;s Focus</h3>
        <Link
          href="/tasks?view=today"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
        >
          View tasks
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {focusTasks.map((task) => (
          <Link
            key={task.id}
            href="/tasks?view=today"
            className="ritual-snappy-row flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <span className="font-medium truncate flex-1">{task.title}</span>
            {task.project || task.category ? (
              <span className="shrink-0 text-xs text-muted-foreground truncate max-w-[120px]">
                {task.project || task.category}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
