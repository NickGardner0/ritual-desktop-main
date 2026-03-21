"use client";

type HeartRateCalendarOverlayProps = {
  averageBpm?: number | null;
  minBpm?: number | null;
  maxBpm?: number | null;
  sampleCount?: number;
};

export function HeartRateCalendarOverlay({
  averageBpm,
  minBpm,
  maxBpm,
  sampleCount = 0,
}: HeartRateCalendarOverlayProps) {
  if (!sampleCount || averageBpm == null) {
    return null;
  }

  return (
    <div className="mt-2 rounded-md border border-[#27251E]/8 bg-[#FFF9EF] px-2 py-1.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[#8A7B5D]">
        <span>HR</span>
        <span>{sampleCount}</span>
      </div>
      <div className="mt-1 text-[12px] font-medium text-[#27251E]">
        Avg {Math.round(averageBpm)}
      </div>
      <div className="text-[10px] text-[#6E685B]">
        {minBpm ?? "--"} to {maxBpm ?? "--"} bpm
      </div>
    </div>
  );
}

