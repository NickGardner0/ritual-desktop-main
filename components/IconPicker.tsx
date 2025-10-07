'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import * as Lucide from 'lucide-react';
import { icons as lucideIconsMap } from 'lucide-react'; // stable kebab-case index
import { ChevronDown } from 'lucide-react';
import * as MuiIcons from '@mui/icons-material';

// Material UI icons successfully integrated! 🎨

type IconPickerProps = {
  value: string;                    // kebab-case, e.g. "target"
  onChange: (next: string) => void; // kebab-case
  anchorClassName?: string;
  portalRef?: React.RefObject<HTMLDivElement>;
  withinCardRef?: React.RefObject<HTMLDivElement>;
  minMenuHeight?: number;
  desiredMenuWidth?: number;
};


const kebabToPascal = (k: string) => k.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
const humanize = (k: string) => k.replace(/-/g, ' ');

// Convert Material UI icon names to kebab-case and create combined icon list
const muiIconsToKebab = (name: string) => {
  return name
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');
};

// Get all Material UI icon names and convert to kebab-case
const getMuiIconNames = () => {
  const allKeys = Object.keys(MuiIcons);
  
  // Filter out variants and keep only base icons (no Outlined, Rounded, Sharp, TwoTone suffixes)
  const filteredKeys = allKeys.filter(name => 
    name !== 'default' && 
    name !== '__esModule' &&
    (MuiIcons as any)[name] && // Just check if it exists (React components are objects, not functions)
    !name.endsWith('Outlined') &&
    !name.endsWith('Rounded') &&
    !name.endsWith('Sharp') &&
    !name.endsWith('TwoTone')
  );
  
  const kebabNames = filteredKeys.map(muiIconsToKebab);
  return kebabNames.sort();
};

// Generate combined icon list at module level (no hooks)
const generateAllIcons = () => {
  const lucideIcons = Object.keys(lucideIconsMap).map(name => ({ name, type: 'lucide' as const }));
  const muiIcons = getMuiIconNames().map(name => ({ name, type: 'mui' as const }));
  
  // Combine and sort by name
  const combined = [...lucideIcons, ...muiIcons].sort((a, b) => a.name.localeCompare(b.name));
  
  console.log('🎨 Total icons available:', {
    lucide: lucideIcons.length,
    materialUI: muiIcons.length,
    total: combined.length
  });
  
  return combined;
};

// Generate the icon list once at module level
const ALL_ICON_NAMES = generateAllIcons();

export default function IconPicker({ 
  value, 
  onChange, 
  anchorClassName,
  portalRef,
  withinCardRef,
  minMenuHeight = 260,
  desiredMenuWidth = 384
}: IconPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = React.useState({ left: 0, top: 0, width: 420, maxH: 400 });

  // Floating positioning hook (same as in modal)
  function useFloatingWithinCard(
    open: boolean,
    anchorRef: React.RefObject<HTMLElement>,
    cardRef: React.RefObject<HTMLElement>,
    desiredWidth = 320,
    minHeight = 200
  ) {
    const [style, setStyle] = React.useState<React.CSSProperties>({});

    React.useLayoutEffect(() => {
      if (!open || !anchorRef.current || !cardRef.current) return;

      const a = anchorRef.current.getBoundingClientRect();
      const c = cardRef.current.getBoundingClientRect();

      const margin = 8;
      const width = Math.max(desiredWidth, a.width);
      const spaceBelow = c.bottom - a.bottom - margin;
      const spaceAbove = a.top - c.top - margin;
      const openUp = spaceBelow < minHeight && spaceAbove > spaceBelow;

      const maxHeight = Math.max(
        minHeight,
        Math.floor((openUp ? spaceAbove : spaceBelow))
      );

      const left = Math.min(
        Math.max(a.left - c.left, margin),
        c.width - width - margin
      );

      const top = openUp
        ? a.top - c.top - Math.min(maxHeight, 420) // open upward
        : a.bottom - c.top + 4;                   // open downward

      setStyle({
        position: 'absolute',
        left,
        top,
        width,
        maxHeight: Math.min(maxHeight, 320), // cap for exactly 7 rows
        overflowY: 'auto',
        pointerEvents: 'auto',
        borderRadius: 0, // square borders
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
        background: 'white',
        border: '1px solid #e5e7eb',
      });
    }, [open, anchorRef, cardRef, desiredWidth, minHeight]);

    return style;
  }

  const floatingStyle = useFloatingWithinCard(
    open && !!portalRef && !!withinCardRef,
    anchorRef,
    withinCardRef!,
    desiredMenuWidth,
    minMenuHeight
  );

  // close on outside click / ESC
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!open) return;
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // debounced search
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim().toLowerCase().replace(/\s+/g, '-')), 120);
    return () => clearTimeout(id);
  }, [search]);

  const list = React.useMemo(() => {
    let base: typeof ALL_ICON_NAMES;
    if (debounced) {
      // First try to find icons that start with the search term
      const startsWithSearch = ALL_ICON_NAMES.filter(icon => icon.name.startsWith(debounced));
      // If we have results that start with the term, use those, otherwise fall back to contains
      base = startsWithSearch.length > 0 ? startsWithSearch : ALL_ICON_NAMES.filter(icon => icon.name.includes(debounced));
    } else {
      base = ALL_ICON_NAMES; // Show all icons by default
    }
    console.log('🎨 Icon search results:', { searchTerm: debounced, totalIcons: ALL_ICON_NAMES.length, filteredCount: base.length });
    return base; // Show all results, no limit
  }, [debounced]);

  const IconNode = (name: string, type?: 'lucide' | 'mui') => {
    // Determine icon type if not provided
    if (!type) {
      const iconData = ALL_ICON_NAMES.find(icon => icon.name === name);
      type = iconData?.type || 'lucide';
    }

    if (type === 'mui') {
      // Convert kebab-case back to PascalCase for Material UI
      const pascalName = kebabToPascal(name);
      const MuiComp = (MuiIcons as any)[pascalName];
      return MuiComp ? <MuiComp sx={{ fontSize: 16 }} className="text-gray-600" /> : <Lucide.Target className="w-4 h-4 text-gray-600" />;
    } else {
      // Lucide icons
      const LucideComp = (Lucide as any)[kebabToPascal(name)];
      return LucideComp ? <LucideComp className="w-4 h-4 text-gray-600" /> : <Lucide.Target className="w-4 h-4 text-gray-600" />;
    }
  };

  const openMenu = () => {
    const btn = anchorRef.current;
    if (!btn) return setOpen(true);
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, gap = 8;
    
    // Find the modal container to constrain dropdown within it
    const modal = document.querySelector('[class*="max-w-"][class*="max-h-"]');
    const modalRect = modal?.getBoundingClientRect();
    
    // Make dropdown width match button width for cleaner look
    const width = Math.max(r.width, 400);
    let top = r.bottom + gap;
    
    // Start with a good default height
    let maxH = 320; // Default height for exactly 7 rows
    
    // Try to respect modal boundaries but don't go below minimum
    if (modalRect) {
      const availableSpace = modalRect.bottom - top - 40;
      if (availableSpace > 250) {
        maxH = Math.min(320, availableSpace);
      }
    } else {
      // Use viewport constraints
      const availableSpace = vh - top - 40;
      maxH = Math.min(320, availableSpace);
    }
    
    // If not enough space below, show above
    if (maxH < 250 && r.top > 300) { 
      top = r.top - 320 - gap; 
      maxH = 320; 
    }
    
    // Center the dropdown relative to the button
    let left = r.left + (r.width - width) / 2;
    left = Math.max(20, Math.min(left, vw - width - 20)); // Keep within viewport
    
    setMenuPos({ left, top, width, maxH });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={anchorRef}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(); }}
        className={anchorClassName ?? 'flex items-center justify-between w-full px-4 py-3 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none'}
      >
        <span className="flex items-center gap-2">
          {IconNode(value)}
          <span className="capitalize">{humanize(value)}</span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}` } />
      </button>

      {open && typeof window !== 'undefined' && (
        portalRef?.current ? createPortal(
          <div
            ref={menuRef}
            style={floatingStyle}
            className="dropdown overflow-hidden"
          >
            {/* Header */}
            <div className="p-3 border-b border-gray-200">
              <div className="relative">
                <input
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 focus:outline-none focus:border-gray-300 bg-white placeholder-gray-400"
                  placeholder="Search icons..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Lucide.Search className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto bg-white flex-1">
              {list.length ? (
                <div className="py-2">
                  {list.map((icon) => (
                    <button
                      key={`${icon.type}-${icon.name}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(icon.name); setOpen(false); setSearch(''); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${value === icon.name ? 'bg-gray-100' : ''}` }
                    >
                      <div className="w-4 h-4 text-gray-600 flex-shrink-0">
                        {IconNode(icon.name, icon.type)}
                      </div>
                      <span className="text-sm text-gray-900 capitalize">{humanize(icon.name)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 bg-gray-100 grid place-items-center mb-4">
                    <Lucide.Search className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-1">No icons found</p>
                  <p className="text-xs text-gray-500">Try a different search term</p>
                </div>
              )}
            </div>
          </div>,
          portalRef.current
        ) : createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100000] bg-white border border-gray-200 shadow-2xl overflow-hidden"
            style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width, maxHeight: menuPos.maxH }}
          >
            {/* Header */}
            <div className="p-3 border-b border-gray-200">
              <div className="relative">
                <input
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 focus:outline-none focus:border-gray-300 bg-white placeholder-gray-400"
                  placeholder="Search icons..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Lucide.Search className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* List */}
            <div 
              className="overflow-y-auto bg-white" 
              style={{ 
                maxHeight: Math.max(200, menuPos.maxH - 80)
              }}
            >
              {list.length ? (
                <div className="py-2">
                  {list.map((icon) => (
                    <button
                      key={`${icon.type}-${icon.name}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(icon.name); setOpen(false); setSearch(''); }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${value === icon.name ? 'bg-gray-100' : ''}` }
                    >
                      <div className="w-4 h-4 text-gray-600 flex-shrink-0">
                        {IconNode(icon.name, icon.type)}
                      </div>
                      <span className="text-sm text-gray-900 capitalize">{humanize(icon.name)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 bg-gray-100 grid place-items-center mb-4">
                    <Lucide.Search className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-1">No icons found</p>
                  <p className="text-xs text-gray-500">Try a different search term</p>
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      )}
    </>
  );
}
