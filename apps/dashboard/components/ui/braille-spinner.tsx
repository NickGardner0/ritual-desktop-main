"use client";

import { cn } from "@/lib/utils";
import spinners, { type BrailleSpinnerName } from "unicode-animations";
import { useEffect, useMemo, useState } from "react";

interface BrailleSpinnerProps {
  name?: BrailleSpinnerName;
  className?: string;
  intervalMs?: number;
  "aria-label"?: string;
}

export function BrailleSpinner({
  name = "braille",
  className,
  intervalMs,
  "aria-label": ariaLabel = "Loading",
}: BrailleSpinnerProps) {
  const spinner = useMemo(() => spinners[name] ?? spinners.braille, [name]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % spinner.frames.length);
    }, Math.max(20, intervalMs ?? spinner.interval));

    return () => window.clearInterval(id);
  }, [intervalMs, spinner]);

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn(
        "inline-grid select-none place-items-center leading-none font-mono text-base scale-110 origin-center",
        className,
      )}
    >
      {spinner.frames[frameIndex]}
    </span>
  );
}
