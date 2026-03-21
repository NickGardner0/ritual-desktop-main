"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";
import { useLiveBiometrics } from "@/hooks/useLiveBiometrics";
import { HeartRateSourceBadge } from "./heart-rate-source-badge";

type LiveHeartRatePillProps = {
  className?: string;
};

export function LiveHeartRatePill({ className }: LiveHeartRatePillProps) {
  const { data, isLoading } = useLiveBiometrics({ refetchIntervalMs: 5000 });

  const lastSeen = data.latest_sample_at
    ? formatDistanceToNowStrict(new Date(data.latest_sample_at), { addSuffix: true })
    : "No live sample yet";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-full border border-[#27251E]/10 bg-white/95 px-3.5 py-2 shadow-[0_10px_24px_rgba(39,37,30,0.08)]",
        className,
      )}
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full",
          data.is_stale ? "bg-[#D6A117]" : "bg-[#1DB954]",
        )}
      />
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-[0.18em] text-[#6E685B]">Live HR</span>
        <span className="text-sm font-semibold text-[#111827]">
          {isLoading ? "Loading..." : data.current_bpm ? `${data.current_bpm} bpm` : "No signal"}
        </span>
      </div>
      <HeartRateSourceBadge sourceType={data.current_source_type} />
      <span className="text-[11px] text-[#6E685B]">{lastSeen}</span>
    </div>
  );
}

