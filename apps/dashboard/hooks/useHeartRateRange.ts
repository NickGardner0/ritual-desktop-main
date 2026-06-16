"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getHeartRateRange } from "@/lib/api/biometrics";
import type { HeartRateRangeParams } from "@/lib/types/biometrics";

export function useHeartRateRange(params: HeartRateRangeParams, enabled = true) {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ["heart-rate-range", user?.id, params.start, params.end, params.resolution, params.sourceType],
    queryFn: async () => {
      return getHeartRateRange(getToken, params);
    },
    enabled: !!user?.id && enabled,
    staleTime: 15_000,
  });
}
