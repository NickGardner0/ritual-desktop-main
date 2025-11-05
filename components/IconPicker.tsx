'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { icons as lucideIconsMap } from 'lucide-react';
import { ChevronDown, Search, Target } from 'lucide-react';

// Original IconPicker design without Material UI bloat 🎨

type IconPickerProps = {
  value: string;
  onChange: (next: string) => void;
  anchorClassName?: string;
  portalRef?: React.RefObject<HTMLDivElement>;
  withinCardRef?: React.RefObject<HTMLDivElement>;
  minMenuHeight?: number;
  desiredMenuWidth?: number;
};

const kebabToPascal = (k: string) => k.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
const humanize = (k: string) => k.replace(/-/g, ' ');

// All Lucide icons available - sorted alphabetically
const allIconNames = Object.keys(lucideIconsMap).sort();

// Log total count for debugging
console.log('🎨 Total Lucide icons available:', allIconNames.length);

export default function IconPicker({
  value,
  onChange,
  anchorClassName,
  portalRef,
  withinCardRef,
  minMenuHeight = 260,
  desiredMenuWidth = 384,
}: IconPickerProps) {
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  // Filter icons based on search (real-time, no debounce needed for simple filtering)
  const filteredIcons = React.useMemo(() => {
    if (!search.trim()) return allIconNames;
    
    const searchLower = search.trim().toLowerCase();
    console.log('🔍 Searching for:', searchLower);
    
    // Prioritize icons that start with search term
    const startsWithSearch = allIconNames.filter(name => 
      name.toLowerCase().startsWith(searchLower)
    );
    
    const containsSearch = startsWithSearch.length === 0 
      ? allIconNames.filter(name => name.toLowerCase().includes(searchLower))
      : [];
    
    const results = startsWithSearch.length > 0 ? startsWithSearch : containsSearch;
    console.log('📊 Search results:', results.length);
    
    return results;
  }, [search]);

  // Floating positioning hook
  function useFloatingWithinCard(
    open: boolean,
    anchorRef: React.RefObject<HTMLElement>,
    cardRef: React.RefObject<HTMLElement> | undefined,
    desiredWidth = 320,
    minHeight = 200
  ) {
    const [style, setStyle] = React.useState<React.CSSProperties>({});

    React.useLayoutEffect(() => {
      if (!open || !anchorRef.current) return;

      const a = anchorRef.current.getBoundingClientRect();
      const c = cardRef?.current?.getBoundingClientRect();

      if (c) {
        const margin = 8;
        const width = Math.max(desiredWidth, a.width);
        const spaceBelow = c.bottom - a.bottom - margin;
        const maxHeight = Math.max(minHeight, Math.floor(spaceBelow));

        const left = Math.min(
          Math.max(a.left - c.left, margin),
          c.width - width - margin
        );

        const top = a.bottom - c.top + 4;

        setStyle({
          position: 'absolute',
          left,
          top,
          width,
          maxHeight: Math.min(maxHeight, 320),
          pointerEvents: 'auto',
        });
      }
    }, [open, anchorRef, cardRef, desiredWidth, minHeight]);

    return style;
  }

  const floatingStyle = useFloatingWithinCard(
    open,
    anchorRef,
    withinCardRef,
    desiredMenuWidth,
    minMenuHeight
  );

  // Close menu on click outside or ESC
  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch('');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelect = (iconName: string) => {
    onChange(iconName);
    setOpen(false);
    setSearch('');
  };

  // Dynamic icon component
  const IconNode = ({ name }: { name: string }) => {
    const IconComponent = (lucideIconsMap as any)[kebabToPascal(name)] || Target;
    return <IconComponent className="w-4 h-4 text-gray-600" />;
  };

  // Get current icon
  const CurrentIcon = value ? (lucideIconsMap as any)[kebabToPascal(value)] : null;

  const menu = open && (
    <div
      ref={menuRef}
      style={portalRef?.current ? floatingStyle : undefined}
      className={portalRef?.current ? "flex flex-col bg-white border border-gray-200 shadow-lg" : "fixed z-[100000] bg-white border border-gray-200 shadow-2xl flex flex-col"}
    >
      {/* Header - Fixed */}
      <div className="p-3 border-b border-gray-200 flex-shrink-0">
        <div className="relative">
          <input
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 focus:outline-none focus:border-gray-300 bg-white placeholder-gray-400"
            placeholder="Search icons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Search className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* List - Scrollable */}
      <div 
        className="flex-1 overflow-y-auto bg-white" 
        style={{ 
          maxHeight: portalRef?.current ? '260px' : '400px'
        }}
      >
        {filteredIcons.length > 0 ? (
          <div className="py-2">
            {filteredIcons.map((iconName) => (
              <button
                key={iconName}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelect(iconName);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                  value === iconName ? 'bg-gray-100' : ''
                }`}
              >
                <div className="w-4 h-4 text-gray-600 flex-shrink-0">
                  <IconNode name={iconName} />
                </div>
                <span className="text-sm text-gray-900 capitalize">{humanize(iconName)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 bg-gray-100 grid place-items-center mb-4">
              <Search className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900 mb-1">No icons found</p>
            <p className="text-xs text-gray-500">Try a different search term</p>
          </div>
        )}
      </div>

      {/* Footer with icon count - Fixed */}
      <div className="px-3 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-600 flex-shrink-0">
        {search.trim() 
          ? `Showing ${filteredIcons.length} of ${allIconNames.length} icons`
          : `${allIconNames.length} icons available`
        }
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        className={anchorClassName ?? 'flex items-center justify-between w-full px-4 py-3 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none'}
      >
        <span className="flex items-center gap-2">
          {value && CurrentIcon && <CurrentIcon className="w-4 h-4 text-gray-600" />}
          <span className={value ? "capitalize" : "text-gray-500"}>
            {value ? humanize(value) : 'Select'}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Render in portal if provided, otherwise directly */}
      {portalRef?.current
        ? createPortal(menu, portalRef.current)
        : menu}
    </>
  );
}
