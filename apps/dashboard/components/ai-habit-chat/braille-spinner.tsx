"use client"

import { useEffect, useMemo, useState } from 'react';
import spinners, { type BrailleSpinnerName } from 'unicode-animations';

import { cn } from '@/lib/utils';

interface BrailleSpinnerProps {
  name?: BrailleSpinnerName;
  className?: string;
}

export function BrailleSpinner({ name = 'braille', className }: BrailleSpinnerProps) {
  const spinner = useMemo(() => spinners[name] ?? spinners.braille, [name]);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % spinner.frames.length);
    }, spinner.interval);
    return () => window.clearInterval(timer);
  }, [spinner]);

  return (
    <span
      className={cn(
        "font-mono leading-none tracking-[-0.02em] text-base scale-110 origin-center text-[#1f2937]",
        className
      )}
      aria-hidden="true"
    >
      {spinner.frames[frame]}
    </span>
  );
}
