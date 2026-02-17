'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Target, icons as lucideIconsMap } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import materialIconNames from '@/data/material-icon-names.json';
import {
  getCachedMaterialIconComponent,
  loadMaterialIconComponent,
  type MaterialIconComponent,
  stripMaterialVariant,
} from '@/lib/material-icons';

type IconPickerProps = {
  value: string;
  onChange: (next: string) => void;
  anchorClassName?: string;
  portalRef?: React.RefObject<HTMLDivElement | null>;
  withinCardRef?: React.RefObject<HTMLDivElement | null>;
  minMenuHeight?: number;
  desiredMenuWidth?: number;
};

type IconProvider = 'lucide' | 'mui';

type IconOption = {
  id: string;
  provider: IconProvider;
  name: string;
  label: string;
  searchText: string;
  searchFlat: string;
};

const MUI_PREFIX = 'mui:';
const LUCIDE_PREFIX = 'lucide:';

const normalize = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const toFlat = (value: string) => normalize(value).replace(/\s+/g, '');

const pascalToWords = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .trim();

const kebabToPascal = (value: string) =>
  value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const materialNameSet = new Set<string>(materialIconNames.map((name) => stripMaterialVariant(name)));

type ParsedIcon = {
  provider: IconProvider;
  name: string;
};

const parseStoredIcon = (raw: string): ParsedIcon | null => {
  if (!raw) return null;

  if (raw.startsWith(MUI_PREFIX)) {
    const name = stripMaterialVariant(raw.slice(MUI_PREFIX.length));
    return { provider: 'mui', name };
  }

  if (raw.startsWith(LUCIDE_PREFIX)) {
    const name = raw.slice(LUCIDE_PREFIX.length);
    return { provider: 'lucide', name: name.includes('-') ? kebabToPascal(name) : name };
  }

  if (raw.includes('-')) {
    return { provider: 'lucide', name: kebabToPascal(raw) };
  }

  if (raw in lucideIconsMap) {
    return { provider: 'lucide', name: raw };
  }

  const materialBase = stripMaterialVariant(raw);
  if (materialNameSet.has(materialBase)) {
    return { provider: 'mui', name: materialBase };
  }

  return { provider: 'lucide', name: raw };
};

const lucideIconEntries: IconOption[] = Object.keys(lucideIconsMap)
  .sort((a, b) => a.localeCompare(b))
  .map((name) => {
    const label = pascalToWords(name);
    return {
      id: `lucide:${name}`,
      provider: 'lucide',
      name,
      label,
      searchText: normalize(`${name} ${label} lucide`),
      searchFlat: toFlat(`${name} ${label} lucide`),
    };
  });

const materialIconEntries: IconOption[] = materialIconNames
  .map((name) => stripMaterialVariant(name))
  .filter((name, idx, list) => list.indexOf(name) === idx)
  .sort((a, b) => a.localeCompare(b))
  .map((name) => {
    const label = pascalToWords(name);
    return {
      id: `mui:${name}`,
      provider: 'mui',
      name,
      label,
      searchText: normalize(`${name} ${label} material mui`),
      searchFlat: toFlat(`${name} ${label} material mui`),
    };
  });

const ALL_ICON_OPTIONS: IconOption[] = [...lucideIconEntries, ...materialIconEntries];

const lucideIconComponents = lucideIconsMap as Record<string, React.ComponentType<LucideProps>>;

function MaterialSvgIcon({ name, className }: { name: string; className: string }) {
  const normalized = React.useMemo(() => stripMaterialVariant(name), [name]);
  const [IconComponent, setIconComponent] = React.useState<MaterialIconComponent | null>(() =>
    getCachedMaterialIconComponent(normalized),
  );

  React.useEffect(() => {
    if (IconComponent) return;

    let mounted = true;
    void loadMaterialIconComponent(normalized).then((loaded) => {
      if (mounted) {
        setIconComponent(() => loaded);
      }
    });

    return () => {
      mounted = false;
    };
  }, [IconComponent, normalized]);

  if (!IconComponent) {
    return <Target className={className} />;
  }

  return <IconComponent className={className} fontSize="inherit" />;
}

export default function IconPicker({
  value,
  onChange,
  anchorClassName,
  portalRef,
  withinCardRef,
  minMenuHeight = 260,
  desiredMenuWidth = 384,
}: IconPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = React.useState({ left: 0, top: 0, width: 420, maxH: 400 });

  function useFloatingWithinCard(
    isOpen: boolean,
    buttonRef: React.RefObject<HTMLElement | null>,
    cardRef: React.RefObject<HTMLElement | null> | undefined,
    desiredWidth = 320,
    minHeight = 200,
  ) {
    const [style, setStyle] = React.useState<React.CSSProperties>({});

    React.useLayoutEffect(() => {
      if (!isOpen || !buttonRef.current) return;

      const anchorRect = buttonRef.current.getBoundingClientRect();
      const cardRect = cardRef?.current?.getBoundingClientRect();

      if (cardRect) {
        const margin = 8;
        const width = Math.max(desiredWidth, anchorRect.width);
        const spaceBelow = cardRect.bottom - anchorRect.bottom - margin;
        const spaceAbove = anchorRect.top - cardRect.top - margin;
        const openUp = spaceBelow < minHeight && spaceAbove > spaceBelow;

        const maxHeight = Math.max(minHeight, Math.floor(openUp ? spaceAbove : spaceBelow));

        const left = Math.min(
          Math.max(anchorRect.left - cardRect.left, margin),
          cardRect.width - width - margin,
        );

        const top = openUp
          ? anchorRect.top - cardRect.top - Math.min(maxHeight, 420)
          : anchorRect.bottom - cardRect.top + 4;

        setStyle({
          position: 'absolute',
          left,
          top,
          width,
          maxHeight: Math.min(maxHeight, 320),
          pointerEvents: 'auto',
        });
      }
    }, [isOpen, buttonRef, cardRef, desiredWidth, minHeight]);

    return style;
  }

  const floatingStyle = useFloatingWithinCard(
    open,
    anchorRef,
    withinCardRef,
    desiredMenuWidth,
    minMenuHeight,
  );

  React.useEffect(() => {
    if (!open) return;

    const onDocClick = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      if (menuRef.current?.contains(targetNode)) return;
      if (anchorRef.current?.contains(targetNode)) return;
      setOpen(false);
      setSearch('');
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 120);
    return () => clearTimeout(id);
  }, [search]);

  const normalizedQuery = React.useMemo(() => normalize(debounced), [debounced]);
  const flatQuery = React.useMemo(() => toFlat(debounced), [debounced]);

  const list = React.useMemo(() => {
    if (!normalizedQuery) return ALL_ICON_OPTIONS;

    const startsWithMatches = ALL_ICON_OPTIONS.filter(
      (icon) => icon.searchText.startsWith(normalizedQuery) || icon.searchFlat.startsWith(flatQuery),
    );

    if (startsWithMatches.length > 0) return startsWithMatches;

    return ALL_ICON_OPTIONS.filter(
      (icon) => icon.searchText.includes(normalizedQuery) || icon.searchFlat.includes(flatQuery),
    );
  }, [flatQuery, normalizedQuery]);

  const selectedParsed = React.useMemo(() => parseStoredIcon(value), [value]);

  const selectedOption = React.useMemo(() => {
    if (!selectedParsed) return null;
    const selectedId = `${selectedParsed.provider}:${selectedParsed.name}`;
    return ALL_ICON_OPTIONS.find((icon) => icon.id === selectedId) ?? null;
  }, [selectedParsed]);

  const renderIcon = (icon: IconOption | ParsedIcon | null) => {
    if (!icon) return <Target className="h-4 w-4 text-gray-600" />;

    if (icon.provider === 'mui') {
      return <MaterialSvgIcon name={icon.name} className="h-4 w-4 text-gray-600" />;
    }

    const IconComponent = lucideIconComponents[icon.name];
    if (IconComponent) {
      return <IconComponent className="h-4 w-4 text-gray-600" />;
    }

    return <Target className="h-4 w-4 text-gray-600" />;
  };

  const getDisplayLabel = () => {
    if (selectedOption) return selectedOption.label;
    if (selectedParsed) return pascalToWords(selectedParsed.name);
    return 'Select';
  };

  const getStoredValue = (icon: IconOption) => {
    if (icon.provider === 'mui') return `${MUI_PREFIX}${icon.name}`;
    return icon.name;
  };

  const openMenu = () => {
    const button = anchorRef.current;
    if (!button) {
      setOpen(true);
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 8;

    const modal = document.querySelector('[class*="max-w-"][class*="max-h-"]');
    const modalRect = modal?.getBoundingClientRect();

    const width = Math.max(rect.width, 400);
    let top = rect.bottom + gap;
    let maxH = 320;

    if (modalRect) {
      const availableSpace = modalRect.bottom - top - 40;
      if (availableSpace > 250) {
        maxH = Math.min(320, availableSpace);
      }
    } else {
      const availableSpace = viewportHeight - top - 40;
      maxH = Math.min(320, availableSpace);
    }

    if (maxH < 250 && rect.top > 300) {
      top = rect.top - 320 - gap;
      maxH = 320;
    }

    let left = rect.left + (rect.width - width) / 2;
    left = Math.max(20, Math.min(left, viewportWidth - width - 20));

    setMenuPos({ left, top, width, maxH });
    setOpen(true);
  };

  const menu = (
    <div
      ref={menuRef}
      style={
        portalRef?.current
          ? floatingStyle
          : { left: menuPos.left, top: menuPos.top, width: menuPos.width, maxHeight: menuPos.maxH }
      }
      className={
        portalRef?.current
          ? 'flex flex-col overflow-hidden border border-gray-300 bg-white shadow-lg'
          : 'fixed z-[100000] overflow-hidden border border-gray-300 bg-white shadow-2xl'
      }
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex-shrink-0 border-b border-gray-300 p-3">
        <div className="relative">
          <input
            className="w-full border border-gray-300 bg-white py-2 pl-9 pr-4 text-sm placeholder-gray-400 focus:border-gray-400 focus:outline-none"
            placeholder="Search icons..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Search className="h-4 w-4" />
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto bg-white"
        style={{
          maxHeight: portalRef?.current ? '260px' : Math.max(200, menuPos.maxH - 80),
        }}
      >
        {list.length ? (
          <div className="py-2">
            {list.map((icon) => {
              const storedValue = getStoredValue(icon);
              const isSelected = selectedOption ? selectedOption.id === icon.id : value === storedValue;

              return (
                <button
                  key={icon.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(storedValue);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={`w-full px-3 py-2 text-left transition-colors hover:bg-gray-50 ${
                    isSelected ? 'bg-gray-100' : ''
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-gray-600">{renderIcon(icon)}</span>
                    <span className="text-sm text-gray-900">{icon.label}</span>
                    <span className="ml-auto text-[11px] uppercase tracking-wide text-gray-400">
                      {icon.provider === 'mui' ? 'Material' : 'Lucide'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 grid h-16 w-16 place-items-center bg-gray-100">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <p className="mb-1 text-sm font-medium text-gray-900">No icons found</p>
            <p className="text-xs text-gray-500">Try a different search term</p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        {search.trim()
          ? `Showing ${list.length} of ${ALL_ICON_OPTIONS.length} icons`
          : `${lucideIconEntries.length} Lucide + ${materialIconEntries.length} Material icons`}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={
          anchorClassName ??
          'flex w-full items-center justify-between border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none'
        }
      >
        <span className="flex items-center gap-2">
          {value ? renderIcon(selectedOption ?? selectedParsed) : null}
          <span className={value ? '' : 'text-gray-500'}>{getDisplayLabel()}</span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        typeof window !== 'undefined' &&
        (portalRef?.current ? createPortal(menu, portalRef.current) : createPortal(menu, document.body))}
    </>
  );
}
