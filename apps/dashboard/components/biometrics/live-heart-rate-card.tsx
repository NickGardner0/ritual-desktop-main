"use client";

import { formatDistanceToNowStrict } from "date-fns";
import type { HeartRateRangeResponse, LiveBiometrics } from "@/lib/types/biometrics";
import { HeartRateMiniSparkline } from "./heart-rate-mini-sparkline";
import { HeartRateSourceBadge } from "./heart-rate-source-badge";

type LiveHeartRateCardProps = {
  live: LiveBiometrics;
  range?: HeartRateRangeResponse | null;
  title?: string;
};

export function LiveHeartRateCard({
  live,
  range,
  title = "Live Heart Rate",
}: LiveHeartRateCardProps) {
  const subtitle = live.latest_sample_at
    ? formatDistanceToNowStrict(new Date(live.latest_sample_at), { addSuffix: true })
    : "No recent synced samples";

  return (
    <section className="rounded-[28px] border border-[#27251E]/10 bg-[linear-gradient(180deg,#FFFDF8_0%,#F5F0E6_100%)] p-5 shadow-[0_18px_40px_rgba(39,37,30,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#6E685B]">{title}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[34px] font-semibold leading-none tracking-[-0.04em] text-[#111827]">
              {live.current_bpm ?? "--"}
            </span>
            <span className="text-sm text-[#6E685B]">bpm</span>
          </div>
          <p className="mt-2 text-sm text-[#5B5649]">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <HeartRateSourceBadge sourceType={live.current_source_type} />
          <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${
            live.is_stale ? "bg-[#FFF4D6] text-[#9A6B00]" : "bg-[#E8F7EE] text-[#167C3B]"
          }`}>
            {live.is_stale ? "Stale" : "Receiving"}
          </span>
        </div>
      </div>

      <div className="mt-5">
        <HeartRateMiniSparkline
          points={range?.points ?? []}
          className="h-[52px] w-full"
        />
      </div>

      <div className="mt-4 flex items-center justify-between text-[12px] text-[#6E685B]">
        <span>Recent synced trend</span>
        <span>{range?.points?.length ?? 0} points</span>
      </div>
    </section>
  );
}

