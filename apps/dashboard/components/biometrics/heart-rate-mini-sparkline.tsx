"use client";

import type { HeartRateRollup1mPoint, HeartRateSamplePoint } from "@/lib/types/biometrics";

type Point = HeartRateRollup1mPoint | HeartRateSamplePoint;

type HeartRateMiniSparklineProps = {
  points: Point[];
  className?: string;
};

export function HeartRateMiniSparkline({ points, className }: HeartRateMiniSparklineProps) {
  if (!points.length) {
    return <div className={className} />;
  }

  const values = points
    .map((point) => ("bpm_avg" in point ? point.bpm_avg : point.bpm_display))
    .filter((value): value is number => Number.isFinite(value));

  if (!values.length) {
    return <div className={className} />;
  }

  const width = 180;
  const height = 52;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  const coordinates = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (((value - min) / range) * (height - 8)) - 4;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="#111827"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coordinates}
      />
    </svg>
  );
}

