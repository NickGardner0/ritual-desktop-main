'use client';

import React, { useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Reserve space at bottom for AI chat component (~140px) */
const BOTTOM_RESERVED = 140;

const TOOLTIP_HEIGHT_ESTIMATE = 200;

interface StatsTooltipProps {
  open: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

/**
 * Stats tooltip rendered via portal. Positions below trigger by default,
 * flips above when there's insufficient space (e.g. near AI chat at bottom).
 */
export function StatsTooltip({ open, triggerRef, children }: StatsTooltipProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef?.current || typeof document === 'undefined') return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - BOTTOM_RESERVED;
      const spaceAbove = rect.top;

      // Flip above if not enough space below (would overlap AI chat)
      const showAbove = spaceBelow < TOOLTIP_HEIGHT_ESTIMATE && spaceAbove >= spaceBelow;

      const GAP = 8;
      let top: number;

      if (showAbove) {
        top = rect.top - TOOLTIP_HEIGHT_ESTIMATE - GAP;
      } else {
        top = rect.bottom + GAP;
      }

      // Clamp to viewport - don't let tooltip go off top or bottom
      const maxTop = viewportHeight - TOOLTIP_HEIGHT_ESTIMATE - 8;
      top = Math.min(Math.max(8, top), maxTop);

      // Align right edge of tooltip with right edge of trigger
      const left = Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248));

      setPosition({ top, left });
    };

    updatePosition();

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(triggerRef.current);

    const scrollHandler = () => {
      // Recalc on scroll (e.g. if parent scrolls)
      updatePosition();
    };
    window.addEventListener('scroll', scrollHandler, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', scrollHandler, true);
    };
  }, [open, triggerRef]);

  if (!open || !position) return null;

  const tooltip = (
    <div
      ref={contentRef}
      className="fixed p-4 bg-white border border-gray-300 shadow-lg z-[999] min-w-[240px]"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {children}
    </div>
  );

  return createPortal(tooltip, document.body);
}
