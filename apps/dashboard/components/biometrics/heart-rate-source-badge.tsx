"use client";

import { cn } from "@/lib/utils";
import type { BiometricsSourceType } from "@/lib/types/biometrics";

const SOURCE_LABELS: Record<BiometricsSourceType, string> = {
  whoop_ble_ios: "From iPhone",
  whoop_ble_mac: "From Mac",
};

type HeartRateSourceBadgeProps = {
  sourceType: BiometricsSourceType | null | undefined;
  className?: string;
};

export function HeartRateSourceBadge({ sourceType, className }: HeartRateSourceBadgeProps) {
  const label = sourceType ? SOURCE_LABELS[sourceType] : "No source";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[#27251E]/10 bg-[#F6F3EC] px-2.5 py-1 text-[11px] font-medium tracking-[-0.01em] text-[#5B5649]",
        className,
      )}
    >
      {label}
    </span>
  );
}

