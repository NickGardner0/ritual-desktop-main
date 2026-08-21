/**
 * Prefetch habits on hover so Index and Metrics navigation feels instant.
 */

'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useUser, useAuth } from '@clerk/nextjs';
import { habitKeys } from './use-habits-query';
import { QUERY_POLICY } from '@/lib/query-policies';
import { apiOperationWithAuth } from '@/lib/api/client';

export function usePrefetchHabits() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();

  const prefetchHabits = async () => {
    if (!user) return;

    await queryClient.prefetchQuery({
      queryKey: habitKeys.list(user.id),
      queryFn: async () => {
        return apiOperationWithAuth(
          'get_habits_api_habits_get',
          getToken,
          {},
          user.id,
        );
      },
      staleTime: QUERY_POLICY.staticResource.staleTime,
    });
  };

  return {
    onMouseEnter: prefetchHabits,
    onFocus: prefetchHabits,
  };
}
