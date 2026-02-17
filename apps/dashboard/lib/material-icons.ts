import type React from 'react';
import { MATERIAL_ICON_LOADERS } from '@/lib/material-icon-loaders';

const MATERIAL_VARIANT_SUFFIX = /(Outlined|Rounded|Sharp|TwoTone)$/;

export type MaterialIconComponent = React.ComponentType<{
  className?: string;
  fontSize?: 'inherit' | 'small' | 'medium' | 'large';
}>;

const materialComponentCache = new Map<string, MaterialIconComponent | null>();
const materialPromiseCache = new Map<string, Promise<MaterialIconComponent | null>>();

export const stripMaterialVariant = (name: string): string =>
  name.replace(MATERIAL_VARIANT_SUFFIX, '');

export const getCachedMaterialIconComponent = (name: string): MaterialIconComponent | null => {
  const normalized = stripMaterialVariant(name);
  return materialComponentCache.get(normalized) ?? null;
};

export const loadMaterialIconComponent = async (name: string): Promise<MaterialIconComponent | null> => {
  const normalized = stripMaterialVariant(name);

  if (materialComponentCache.has(normalized)) {
    return materialComponentCache.get(normalized) ?? null;
  }

  if (materialPromiseCache.has(normalized)) {
    return materialPromiseCache.get(normalized) ?? null;
  }

  const loader = MATERIAL_ICON_LOADERS[normalized];
  if (!loader) {
    materialComponentCache.set(normalized, null);
    return null;
  }

  const loadPromise = loader()
    .then((module) => {
      const icon = (module.default ?? null) as MaterialIconComponent | null;
      materialComponentCache.set(normalized, icon);
      materialPromiseCache.delete(normalized);
      return icon;
    })
    .catch(() => {
      materialComponentCache.set(normalized, null);
      materialPromiseCache.delete(normalized);
      return null;
    });

  materialPromiseCache.set(normalized, loadPromise);
  return loadPromise;
};
