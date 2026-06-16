import React from 'react';

export function useFloatingWithinCard(
    open: boolean,
    anchorRef: React.RefObject<HTMLElement | null>,
    cardRef: React.RefObject<HTMLElement | null>,
    desiredWidth = 320,
    minHeight = 200,
    maxDropdownHeight = 320
  ) {
    const [style, setStyle] = React.useState<React.CSSProperties>({});

    React.useLayoutEffect(() => {
      if (!open || !anchorRef.current || !cardRef.current) return;

      const anchorRect = anchorRef.current.getBoundingClientRect();
      const cardRect = cardRef.current.getBoundingClientRect();

      const margin = 8;
      const width = Math.max(desiredWidth, anchorRect.width);

      const spaceBelow = cardRect.bottom - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - cardRect.top - margin;
      const openUp = spaceBelow < minHeight && spaceAbove > spaceBelow;

      const maxHeight = Math.min(
        maxDropdownHeight,
        Math.floor(openUp ? spaceAbove - 8 : spaceBelow - 8)
      );

      const left = Math.min(
        Math.max(anchorRect.left - cardRect.left, margin),
        cardRect.width - width - margin
      );

      const top = openUp
        ? anchorRect.top - cardRect.top - maxHeight - 4
        : anchorRect.bottom - cardRect.top + 4;

      setStyle({
        position: 'absolute',
        left,
        top,
        width,
        maxHeight,
        overflowY: 'auto',
        pointerEvents: 'auto',
        borderRadius: 2,
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
        background: 'white',
        border: '1px solid #e5e7eb',
      });
    }, [open, anchorRef, cardRef, desiredWidth, minHeight, maxDropdownHeight]);

    return style;
  }
