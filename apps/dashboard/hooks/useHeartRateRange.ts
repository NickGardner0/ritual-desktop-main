"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { apiOperationWithAuth } from "@/lib/api/client";

type HeartRateRangeParams = {
  start: string;
  end: string;
  resolution?: "raw" | "1m";
  sourceType?: string;
};

export function useHeartRateRange(params: HeartRateRangeParams, enabled = true) {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ["heart-rate-range", user?.id, params.start, params.end, params.resolution, params.sourceType],
    queryFn: () =>
      apiOperationWithAuth(
        "get_heart_rate_range_api_v1_biometrics_heart_rate_range_get",
        getToken,
        {
          query: {
            start: params.start,
            end: params.end,
            resolution: params.resolution ?? "1m",
            source_type: params.sourceType,
          },
        },
        user?.id,
      ),
    enabled: !!user?.id && enabled,
    staleTime: 15_000,
  });
}
