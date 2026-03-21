"use client";

import { useEffect } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getLiveBiometrics } from "@/lib/api/biometrics";
import { liveBiometricsStore, useLiveBiometricsStore } from "@/lib/stores/live-biometrics-store";

type UseLiveBiometricsOptions = {
  refetchIntervalMs?: number;
};

export function useLiveBiometrics(options: UseLiveBiometricsOptions = {}) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const storeSnapshot = useLiveBiometricsStore();
  const refetchIntervalMs = options.refetchIntervalMs ?? 5000;

  const query = useQuery({
    queryKey: ["live-biometrics", user?.id],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error("Missing auth token");
      }
      return getLiveBiometrics(token);
    },
    enabled: !!user?.id,
    staleTime: 1000,
    refetchInterval: refetchIntervalMs,
  });

  useEffect(() => {
    if (query.data) {
      liveBiometricsStore.setSnapshot(query.data);
    }
  }, [query.data]);

  useEffect(() => {
    if (!user?.id) {
      liveBiometricsStore.reset();
    }
  }, [user?.id]);

  return {
    ...query,
    data: query.data ?? storeSnapshot,
  };
}

