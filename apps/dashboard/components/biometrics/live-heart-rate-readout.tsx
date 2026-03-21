"use client";

import { useLiveBiometrics } from "@/hooks/useLiveBiometrics";

export function LiveHeartRateReadout() {
  const { data, isLoading } = useLiveBiometrics({ refetchIntervalMs: 3000 });

  if (isLoading) {
    return null;
  }

  if (!data.current_bpm || data.is_stale) {
    return null;
  }

  return (
    <div className="flex justify-center" aria-live="polite">
      <span className="text-[24px] font-medium tracking-[-0.04em] text-[#7A1F1F] tabular-nums">
        {data.current_bpm} BPM
      </span>
    </div>
  );
}
