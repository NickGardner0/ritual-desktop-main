'use client';

import React from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { apiFetchWithAuth } from '@/lib/api/client';

export function TasksClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  const { data: habits = [] } = useQuery({
    queryKey: ['habits', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const res = await apiFetchWithAuth('/api/habits', getToken);
      if (!res.ok) throw new Error('Failed to fetch habits');
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const habitsForKanban = habits.map((h: { id: string; name: string; icon?: string; unit_type?: string }) => ({
    id: h.id,
    name: h.name,
    icon: h.icon,
    unit_type: h.unit_type,
  }));

  const handleLogMetric = async (habitId: string, value: number, date?: string) => {
    const token = await getToken();
    if (!token) return;
    const day = date ?? format(new Date(), 'yyyy-MM-dd');
    await apiFetchWithAuth(`/api/habits/${habitId}/logs`, getToken, {
      method: 'POST',
      body: JSON.stringify({
        habit_id: habitId,
        date: day,
        amount: value,
        status: 'completed',
        completed_at: new Date().toISOString(),
      }),
    });
    await queryClient.invalidateQueries({
      queryKey: ['habit-logs-calendar', user?.id],
    });
    await queryClient.invalidateQueries({
      queryKey: ['habits', user?.id],
    });
  };

  return (
    <KanbanBoard
      habits={habitsForKanban}
      onLogMetric={handleLogMetric}
      fullPage
      showSearch={false}
    />
  );
}
