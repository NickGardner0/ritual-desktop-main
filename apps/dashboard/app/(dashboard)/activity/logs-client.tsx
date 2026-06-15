'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import { LogsClientInner } from './logs-client.inner';

export type {
  BuiltInFilterPresetId,
  FilterState,
  HabitLog,
  SavedFilterView,
  TableDensity,
} from '@/components/habit-logs/types';

export function LogsClient() {
  const { getToken } = useAuth();
  const { user } = useUser();

  return (
    <LogsClientInner
      key={user?.id ?? 'anonymous'}
      userId={user?.id ?? null}
      getToken={getToken}
    />
  );
}
