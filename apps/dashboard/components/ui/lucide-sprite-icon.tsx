'use client';

import * as React from 'react';
import { toLucideKebab } from '@/lib/icon-utils';
import lucideIconNames from '@/data/lucide-icon-names.json';

type LucideSpriteIconProps = {
  name: string;
  className?: string;
};

const lucideNameSet = new Set<string>(lucideIconNames as string[]);

export function LucideSpriteIcon({ name, className = 'h-4 w-4 text-gray-600' }: LucideSpriteIconProps) {
  const symbolId = React.useMemo(() => toLucideKebab(name), [name]);
  const resolvedId = React.useMemo(() => {
    if (lucideNameSet.has(symbolId)) {
      return symbolId;
    }
    return 'layout-dashboard';
  }, [symbolId]);

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <use href={`/icons/lucide-sprite.svg#${resolvedId}`} />
    </svg>
  );
}

export default LucideSpriteIcon;
