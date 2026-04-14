'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  applyOptimisticHabitLogUpdate,
  invalidateHabitData,
  ritualQueryKeys,
  rollbackOptimisticHabitLogUpdate,
} from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';

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

  const directLogMutation = useMutation({
    onMutate: async ({ inputText, parsed, matchedHabit }) => {
      const queryUserId = userId ?? 'anonymous';
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ritualQueryKeys.habitLogsList(queryUserId) }),
        queryClient.cancelQueries({ queryKey: ritualQueryKeys.habitsList(queryUserId) }),
      ]);

      return applyOptimisticHabitLogUpdate(queryClient, queryUserId, {
        id: `temp-${Date.now()}`,
        habit_id: matchedHabit.id,
        amount: parsed.amount ?? undefined,
        duration: parsed.duration != null ? Math.round(parsed.duration * 60) : undefined,
        unit: matchedHabit.unit_type || parsed.unit || 'Count',
        date: getLocalDateString(),
        status: 'completed',
        notes: inputText,
      });
    },
    mutationFn: async ({ inputText, parsed, matchedHabit, displayValue }: DirectLogParams) => {
      const sessionToken = await getToken();
      const clientEventId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const response = await fetch('/api/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: sessionToken ? `Bearer ${sessionToken}` : '',
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
      };
    },
    onError: (_error, _variables, context) => {
      rollbackOptimisticHabitLogUpdate(queryClient, userId ?? 'anonymous', context);
    },
    onSuccess: async ({ matchedHabit, displayValue }) => {
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
        affectedHabitIds: [matchedHabit.id],
        message: `Logged ${matchedHabit.name}`,
      });

      markReadConsistencyRequired(userId);
      await invalidateHabitData(queryClient, userId);
    },
  });

  const aiFallbackMutation = useMutation({
    mutationFn: async (inputText: string): Promise<LoggingResult> => {
      if (!userId) {
        throw new Error('User not authenticated');
      }

      const sessionToken = await getToken();
      const clientEventId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const response = await fetch('/api/chat/habits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: sessionToken ? `Bearer ${sessionToken}` : '',
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
          playSound: false,
          affectedHabitIds: result.affectedHabitIds,
          message: result.message,
        });
      }

      if (successfulLogs.length > 0) {
        markReadConsistencyRequired(userId);
        await invalidateHabitData(queryClient, userId);
      }
    },
  });

  const clarificationMutation = useMutation({
    onMutate: async ({ clarification, habitId }) => {
      const queryUserId = userId ?? 'anonymous';
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ritualQueryKeys.habitLogsList(queryUserId) }),
        queryClient.cancelQueries({ queryKey: ritualQueryKeys.habitsList(queryUserId) }),
      ]);

      return applyOptimisticHabitLogUpdate(queryClient, queryUserId, {
        id: `temp-clarify-${Date.now()}`,
        habit_id: habitId,
        amount: clarification.value ?? undefined,
        unit: clarification.unit ?? undefined,
        date: clarification.date,
        status: 'completed',
        notes: `Logged via clarification: ${clarification.habit_hint}`,
      });
    },
    mutationFn: async ({ clarification, habitId, habitName }: ClarificationParams) => {
      const sessionToken = await getToken();
      const response = await fetch('/api/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: sessionToken ? `Bearer ${sessionToken}` : '',
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
      };
    },
    onError: (_error, _variables, context) => {
      rollbackOptimisticHabitLogUpdate(queryClient, userId ?? 'anonymous', context);
    },
    onSuccess: async ({ habitId, habitName, clarification }) => {
      onHabitUpdate?.({
        success: true,
        refreshNeeded: true,
        playSound: true,
        affectedHabitIds: [habitId],
      });

      trackHabitLogged({
        habitId,
        habitName,
        value: clarification.value ?? undefined,
        unit: clarification.unit || undefined,
        source: 'ai_chat',
      });

      markReadConsistencyRequired(userId);
      await invalidateHabitData(queryClient, userId);
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
