'use client';

import * as React from 'react';
import { LayoutDashboard } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import {
  getCachedMaterialIconComponent,
  loadMaterialIconComponent,
  type MaterialIconComponent,
  stripMaterialVariant,
} from '@/lib/material-icons';

const MUI_PREFIX = 'mui:';
const LUCIDE_PREFIX = 'lucide:';

type IconProvider = 'lucide' | 'mui';

type ParsedIcon = {
  provider: IconProvider;
  name: string;
};

type LucideIconComponent = React.ComponentType<LucideProps>;

const lucideImporters = dynamicIconImports as Record<
  string,
  () => Promise<{ default: LucideIconComponent }>
>;

const lucideIconCache = new Map<string, LucideIconComponent>();

const toKebabCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();


const parseIconName = (raw: string): ParsedIcon | null => {
  if (!raw) return null;

  if (raw.startsWith(MUI_PREFIX)) {
    return { provider: 'mui', name: stripMaterialVariant(raw.slice(MUI_PREFIX.length)) };
  }

  if (raw.startsWith(LUCIDE_PREFIX)) {
    return { provider: 'lucide', name: raw.slice(LUCIDE_PREFIX.length) };
  }

  if (/(Outlined|Rounded|Sharp|TwoTone)$/.test(raw)) {
    return { provider: 'mui', name: stripMaterialVariant(raw) };
  }

  return { provider: 'lucide', name: raw };
};

interface DynamicIconProps {
  name: string;
  className?: string;
  fallback?: React.ReactNode;
}

export function DynamicIcon({ name, className = 'w-4 h-4', fallback }: DynamicIconProps) {
  const parsed = React.useMemo(() => parseIconName(name), [name]);
  const [LucideComponent, setLucideComponent] = React.useState<LucideIconComponent | null>(null);
  const [MaterialComponent, setMaterialComponent] = React.useState<MaterialIconComponent | null>(() =>
    parsed?.provider === 'mui' ? getCachedMaterialIconComponent(parsed.name) : null,
  );

  React.useEffect(() => {
    if (parsed?.provider !== 'mui') {
      setMaterialComponent(null);
      return;
    }

    const cached = getCachedMaterialIconComponent(parsed.name);
    if (cached) {
      setMaterialComponent(() => cached);
      return;
    }

    let mounted = true;
    void loadMaterialIconComponent(parsed.name).then((loaded) => {
      if (mounted) {
        setMaterialComponent(() => loaded);
      }
    });

    return () => {
      mounted = false;
    };
  }, [parsed]);

  React.useEffect(() => {
    if (!parsed || parsed.provider !== 'lucide') {
      setLucideComponent(null);
      return;
    }

    const lucideName = toKebabCase(parsed.name);
    const cached = lucideIconCache.get(lucideName);
    if (cached) {
      setLucideComponent(() => cached);
      return;
    }

    const importer = lucideImporters[lucideName];
    if (!importer) {
      setLucideComponent(null);
      return;
    }

    let cancelled = false;

    importer()
      .then((module) => {
        if (cancelled) return;
        const Icon = module.default;
        lucideIconCache.set(lucideName, Icon);
        setLucideComponent(() => Icon);
      })
      .catch(() => {
        if (!cancelled) {
          setLucideComponent(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [parsed]);

  if (parsed?.provider === 'mui') {
    if (!MaterialComponent) {
      if (fallback) {
        return <>{fallback}</>;
      }
      return <LayoutDashboard className={className} />;
    }

    return <MaterialComponent className={className} fontSize="inherit" />;
  }

  if (LucideComponent) {
    return <LucideComponent className={className} />;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return <LayoutDashboard className={className} />;
}

export default DynamicIcon;
