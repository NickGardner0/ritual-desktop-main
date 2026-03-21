"use client";

import { subMinutes } from "date-fns";
import { useLiveBiometrics } from "@/hooks/useLiveBiometrics";
import { useHeartRateRange } from "@/hooks/useHeartRateRange";
import { LiveHeartRateCard } from "./live-heart-rate-card";

type LiveHeartRatePanelProps = {
  minutes?: number;
  title?: string;
};

export function LiveHeartRatePanel({
  minutes = 30,
  title,
}: LiveHeartRatePanelProps) {
  const liveQuery = useLiveBiometrics({ refetchIntervalMs: 5000 });
  const end = new Date();
  const start = subMinutes(end, minutes);
  const rangeQuery = useHeartRateRange(
    {
      start: start.toISOString(),
      end: end.toISOString(),
      resolution: "1m",
    },
    true,
  );

  return (
    <LiveHeartRateCard
      live={liveQuery.data}
      range={rangeQuery.data}
      title={title}
    />
  );
}

