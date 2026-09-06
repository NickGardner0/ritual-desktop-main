import React from 'react';

/** Positions a portaled menu under an anchor using viewport-fixed coords. */
export function useFloatingWithinCard(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  _cardRef: React.RefObject<HTMLElement | null>,
  desiredWidth?: number,
  minHeight = 160,
  maxDropdownHeight = 280,
) {
  const [style, setStyle] = React.useState<React.CSSProperties>({});

  React.useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      const margin = 8;
      const width = Math.max(desiredWidth ?? 0, anchorRect.width);

      const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - margin;
      const openUp = spaceBelow < minHeight && spaceAbove > spaceBelow;

      const maxHeight = Math.max(
        120,
        Math.min(maxDropdownHeight, Math.floor(openUp ? spaceAbove - 8 : spaceBelow - 8)),
      );

      let left = anchorRect.left;
      if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - width - margin);
      }

      const top = openUp
        ? Math.max(margin, anchorRect.top - maxHeight - 4)
        : anchorRect.bottom + 4;

      setStyle({
        position: 'fixed',
        left,
        top,
        width,
        maxHeight,
        overflowY: 'auto',
        pointerEvents: 'auto',
        zIndex: 10000,
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(28,25,18,0.14), 0 2px 8px rgba(28,25,18,0.06)',
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid rgba(39,37,30,0.08)',
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, desiredWidth, minHeight, maxDropdownHeight]);

  return style;
}
