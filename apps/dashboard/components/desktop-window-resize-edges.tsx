'use client';

import { startWindowResizeDragging, type WindowResizeDirection } from '@/lib/native-gateway';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';

const EDGES: Array<{
  direction: WindowResizeDirection;
  className: string;
  label: string;
}> = [
  {
    direction: 'North',
    className: 'left-20 right-2 top-0 h-1.5 cursor-n-resize',
    label: 'Resize window from top',
  },
  {
    direction: 'South',
    className: 'bottom-0 left-2 right-2 h-1.5 cursor-s-resize',
    label: 'Resize window from bottom',
  },
  {
    direction: 'East',
    className: 'top-8 right-0 bottom-2 w-1.5 cursor-e-resize',
    label: 'Resize window from right',
  },
  {
    direction: 'West',
    className: 'bottom-2 left-0 top-10 w-1.5 cursor-w-resize',
    label: 'Resize window from left',
  },
  {
    direction: 'NorthEast',
    className: 'right-0 top-0 h-3 w-3 cursor-ne-resize',
    label: 'Resize window from top right',
  },
  {
    direction: 'SouthEast',
    className: 'bottom-0 right-0 h-3 w-3 cursor-se-resize',
    label: 'Resize window from bottom right',
  },
  {
    direction: 'SouthWest',
    className: 'bottom-0 left-0 h-3 w-3 cursor-sw-resize',
    label: 'Resize window from bottom left',
  },
];

export function DesktopWindowResizeEdges() {
  const { isDesktop } = useDesktopCapabilities();
  if (!isDesktop) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden>
      {EDGES.map((edge) => (
        <div
          key={edge.direction}
          role="separator"
          aria-label={edge.label}
          data-tauri-drag-region="false"
          className={`pointer-events-auto absolute no-drag ${edge.className}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            void startWindowResizeDragging(edge.direction);
          }}
        />
      ))}
    </div>
  );
}
