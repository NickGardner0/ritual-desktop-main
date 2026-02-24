'use client';

import * as React from 'react';
import { toMaterialSymbolLigature } from '@/lib/icon-utils';

type MaterialSymbolIconProps = {
  name: string;
  className?: string;
  filled?: boolean;
};

export function MaterialSymbolIcon({
  name,
  className = 'h-4 w-4 text-gray-600',
  filled = false,
}: MaterialSymbolIconProps) {
  const ligature = React.useMemo(() => toMaterialSymbolLigature(name), [name]);

  return (
    <span className={`inline-flex items-center justify-center overflow-hidden ${className}`} aria-hidden>
      <span
        className="material-symbols-rounded text-[1em] leading-none"
        style={{
          fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        }}
      >
        {ligature || 'dashboard'}
      </span>
    </span>
  );
}

export default MaterialSymbolIcon;
