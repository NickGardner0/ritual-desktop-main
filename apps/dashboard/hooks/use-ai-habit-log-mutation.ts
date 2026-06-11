'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  applyCanonicalOverviewSnapshot,
  applyOptimisticOverviewStatDelta,
  invalidateAfterHabitWrite,
} from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import { submitCurrentLocationPing } from '@/lib/location-ping';

type HabitUpdateHandler = ((habitData: any) => void) | undefined;

type TrackLoggedHabit = (payload: {
  habitId: string;
  habitName: string;
  value?: number;
  unit?: string;
  source: 'ai_chat';
}) => void;

type GetToken = () => Promise<string | null>;

type DirectLogParams = {
  inputText: string;
  parsed: {
    amount: number | null;
    duration: number | null;
    unit: string;
  };
  matchedHabit: {
    id: string;
    name: string;
    unit_type?: string | null;
  };
  displayValue: {
    value: number;
    unitLabel: string;
  };
};

type LogResult = {
  index: number;
  success: boolean;
  habit_id?: string;
  habit_name?: string;
  value?: number;
  unit?: string;
  date?: string;
  error?: string;
};

type Clarification = {
  index: number;
  habit_hint: string;
  value: number | null;
  unit: string | null;
  date: string;
  alternatives: Array<{ id: string; name: string; confidence: number }>;
  reason: string;
};

type LoggingResult = {
  success: boolean;
  message: string;
  logged: LogResult[];
  clarifications: Clarification[];
  refreshNeeded?: boolean;
  affectedHabitIds?: string[];
  affectedDates?: string[];
  overview_snapshot?: {
    habits?: unknown[];
    overviewStats?: DashboardSnapshot['overviewStats'];
    meta?: { generatedAt?: number };
  };
};

type ClarificationParams = {
  clarification: Clarification;
  habitId: string;
  habitName: string;
};

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useAiHabitLogMutation({
  userId,
  getToken,
  onHabitUpdate,
  trackHabitLogged,
}: {
  userId?: string | null;
  getToken: GetToken;
  onHabitUpdate?: HabitUpdateHandler;
  trackHabitLogged: TrackLoggedHabit;
}) {
  const queryClient = useQueryClient();

  const applyPostWriteSnapshot = (snapshot?: LoggingResult['overview_snapshot']) => {
    if (!userId || !snapshot?.overviewStats) return;
    applyCanonicalOverviewSnapshot(queryClient, userId, snapshot);
  };

  const refreshReadModelsInBackground = () => {
    if (!userId) return;
    markReadConsistencyRequired(userId);
    void invalidateAfterHabitWrite(queryClient, userId).catch((error) => {
      console.warn('Post-log read-model refresh failed:', error);
    });
  };

  const directLogMutation = useMutation({
    onMutate: ({ matchedHabit, displayValue }: DirectLogParams) => {
      onHabitUpdate?.({
        success: true,
        optimisticUpdate: true,
        playSound: true,
        affectedHabitIds: [matchedHabit.id],
      });

      if (!userId) return undefined;
      return {
        rollback: applyOptimisticOverviewStatDelta(queryClient, userId, {
          habitId: matchedHabit.id,
          habitName: matchedHabit.name,
          unit: displayValue.unitLabel,
          delta: displayValue.value,
          date: getLocalDateString(),
        }),
      };
    },
    mutationFn: async ({ inputText, parsed, matchedHabit, displayValue }: DirectLogParams) => {
      const sessionToken = await getToken();
      await submitCurrentLocationPing({
        authToken: sessionToken,
        reason: 'ai_habit_chat_direct_log',
      });
      const clientEventId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const response = await fetch('/api/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          items: [
            {
              habit_id: matchedHabit.id,
              date: getLocalDateString(),
              amount: parsed.amount ?? null,
              duration: parsed.duration != null ? Math.round(parsed.duration * 60) : null,
              unit: matchedHabit.unit_type || parsed.unit || 'Count',
              source: 'ai_log_v2_fast',
              notes: inputText,
            },
          ],
          client_event_id: clientEventId,
        }),
      });

      const result = await response.json().catch(() => null);
      const firstResult = result?.results?.[0];
      if (!response.ok || !result?.success || !firstResult?.success) {
        throw new Error(result?.error || result?.message || 'Direct log failed');
      }

      return {
        matchedHabit,
        displayValue,
        result,
      };
    },
    onSuccess: async ({ matchedHabit, displayValue, result }) => {
      applyPostWriteSnapshot(result?.overview_snapshot);
      trackHabitLogged({
        habitId: matchedHabit.id,
        habitName: matchedHabit.name,
        value: displayValue.value,
        unit: displayValue.unitLabel,
        source: 'ai_chat',
      });

      onHabitUpdate?.({
        success: true,
        refreshNeeded: true,
        playSound: false,
        canonicalRefreshHandled: true,
        affectedHabitIds: [matchedHabit.id],
        message: `Logged ${matchedHabit.name}`,
      });

      refreshReadModelsInBackground();
    },
    onError: (_error, _variables, context) => {
      context?.rollback?.();
    },
  });

  const aiFallbackMutation = useMutation({
    mutationFn: async (inputText: string): Promise<LoggingResult> => {
      if (!userId) {
        throw new Error('User not authenticated');
      }

      const sessionToken = await getToken();
      await submitCurrentLocationPing({
        authToken: sessionToken,
        reason: 'ai_habit_chat_fallback_log',
      });
      const clientEventId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const response = await fetch('/api/chat/habits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: inputText }],
          userId,
          clientEventId,
        }),
      });

      return response.json();
    },
    onSuccess: async (result) => {
      const successfulLogs = result.logged?.filter((entry) => entry.success) ?? [];
      applyPostWriteSnapshot(result.overview_snapshot);

      successfulLogs.forEach((log) => {
        if (log.habit_id && log.habit_name) {
          trackHabitLogged({
            habitId: log.habit_id,
            habitName: log.habit_name,
            value: log.value,
            unit: log.unit || undefined,
            source: 'ai_chat',
          });
        }
      });

      if (successfulLogs.length > 0 && result.refreshNeeded) {
        onHabitUpdate?.({
          success: true,
          refreshNeeded: true,
          playSound: true,
          canonicalRefreshHandled: true,
          affectedHabitIds: result.affectedHabitIds,
          message: result.message,
        });
      }

      if (successfulLogs.length > 0) {
        refreshReadModelsInBackground();
      }
    },
  });

  const clarificationMutation = useMutation({
    onMutate: () => {
      onHabitUpdate?.({
        success: true,
        optimisticUpdate: true,
        playSound: true,
      });
    },
    mutationFn: async ({ clarification, habitId, habitName }: ClarificationParams) => {
      const sessionToken = await getToken();
      const response = await fetch('/api/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          items: [{
            habit_id: habitId,
            date: clarification.date,
            amount: clarification.value,
            unit: clarification.unit,
            source: 'ai_log_v2',
            notes: `Logged via clarification: ${clarification.habit_hint}`,
          }],
          client_event_id: `clarify-${Date.now()}`,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || result?.message || 'Clarification log failed');
      }

      return {
        habitId,
        habitName,
        clarification,
        result,
      };
    },
    onSuccess: async ({ habitId, habitName, clarification, result }) => {
      applyPostWriteSnapshot(result?.overview_snapshot);
      onHabitUpdate?.({
        success: true,
        refreshNeeded: true,
        playSound: false,
        canonicalRefreshHandled: true,
        affectedHabitIds: [habitId],
      });

      trackHabitLogged({
        habitId,
        habitName,
        value: clarification.value ?? undefined,
        unit: clarification.unit || undefined,
        source: 'ai_chat',
      });

      refreshReadModelsInBackground();
    },
  });

  return {
    submitDirectLog: directLogMutation.mutateAsync,
    submitAiFallback: aiFallbackMutation.mutateAsync,
    submitClarification: clarificationMutation.mutateAsync,
    isAiSubmitting: aiFallbackMutation.isPending,
    isClarificationSubmitting: clarificationMutation.isPending,
  };
}
