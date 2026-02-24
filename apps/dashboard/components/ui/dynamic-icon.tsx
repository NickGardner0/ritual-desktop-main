'use client';

import * as React from 'react';
import { LayoutDashboard } from 'lucide-react';
import MaterialSymbolIcon from '@/components/ui/material-symbol-icon';
import LucideSpriteIcon from '@/components/ui/lucide-sprite-icon';
import { parseStoredIcon } from '@/lib/icon-utils';

interface DynamicIconProps {
  name: string;
  className?: string;
  fallback?: React.ReactNode;
}

export function DynamicIcon({ name, className = 'w-4 h-4', fallback }: DynamicIconProps) {
  const parsed = React.useMemo(() => parseStoredIcon(name), [name]);
  if (!parsed) {
    return fallback ? <>{fallback}</> : <LayoutDashboard className={className} />;
  }

  if (parsed.provider === 'emoji') {
    return <span className="text-base leading-none">{parsed.name}</span>;
  }

  if (parsed.provider === 'mui') {
    return <MaterialSymbolIcon name={parsed.name} className={className} />;
  }

  return <LucideSpriteIcon name={parsed.name} className={className} />;
}

export default DynamicIcon;
