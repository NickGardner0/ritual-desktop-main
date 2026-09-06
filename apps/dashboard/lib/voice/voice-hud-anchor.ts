'use client';

import type { VoiceHudAnchorRect } from './voice-session-contract';

function finiteWindowNumber(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getVoiceHudAnchorRect(element: Element | null | undefined): VoiceHudAnchorRect | undefined {
  if (typeof window === 'undefined') return undefined;
  if (!element) return undefined;

  const htmlElement = element instanceof HTMLElement ? element : null;
  const anchorElement =
    htmlElement?.closest<HTMLElement>('[data-voice-hud-anchor]') ??
    htmlElement?.closest<HTMLElement>('form') ??
    htmlElement;

  if (!anchorElement) return undefined;

  const rect = anchorElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;

  const screenX = finiteWindowNumber(window.screenX, finiteWindowNumber(window.screenLeft));
  const screenY = finiteWindowNumber(window.screenY, finiteWindowNumber(window.screenTop));

  return {
    x: screenX + rect.left,
    y: screenY + rect.top,
    width: rect.width,
    height: rect.height,
  };
}
