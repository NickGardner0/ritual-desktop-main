'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import * as Lucide from 'lucide-react';
import { icons as lucideIconsMap } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

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

// Generate Lucide icon list
const generateAllIcons = () => {
  const lucideIcons = Object.keys(lucideIconsMap).map(name => ({ name, type: 'lucide' as const }));
  
  console.log('🎨 Total icons available:', {
    lucide: lucideIcons.length,
    total: lucideIcons.length
  });
  
  return lucideIcons.sort((a, b) => a.name.localeCompare(b.name));
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
          ? a.top - c.top - Math.min(maxHeight, 420)
          : a.bottom - c.top + 4;

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

  // close on outside click / ESC
  React.useEffect(() => {
    if (!open) return;

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
      setSearch('');
    };

    const onKey = (e: KeyboardEvent) => { 
      if (e.key === 'Escape') {
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

  // debounced search
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim().toLowerCase().replace(/\s+/g, '-')), 120);
    return () => clearTimeout(id);
  }, [search]);

  const list = React.useMemo(() => {
    let base: typeof ALL_ICON_NAMES;
    if (debounced) {
      const startsWithSearch = ALL_ICON_NAMES.filter(icon => icon.name.startsWith(debounced));
      base = startsWithSearch.length > 0 ? startsWithSearch : ALL_ICON_NAMES.filter(icon => icon.name.includes(debounced));
    } else {
      base = ALL_ICON_NAMES;
    }
    return base;
  }, [debounced]);

  const IconNode = (name: string) => {
    const LucideComp = (Lucide as any)[kebabToPascal(name)];
    return LucideComp ? <LucideComp className="w-4 h-4 text-gray-600" /> : <Lucide.Target className="w-4 h-4 text-gray-600" />;
  };

  const openMenu = () => {
    const btn = anchorRef.current;
    if (!btn) return setOpen(true);
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, gap = 8;
    
    const modal = document.querySelector('[class*="max-w-"][class*="max-h-"]');
    const modalRect = modal?.getBoundingClientRect();
    
    const width = Math.max(r.width, 400);
    let top = r.bottom + gap;
    let maxH = 320;
    
    if (modalRect) {
      const availableSpace = modalRect.bottom - top - 40;
      if (availableSpace > 250) {
        maxH = Math.min(320, availableSpace);
      }
    } else {
      const availableSpace = vh - top - 40;
      maxH = Math.min(320, availableSpace);
    }
    
    if (maxH < 250 && r.top > 300) { 
      top = r.top - 320 - gap; 
      maxH = 320; 
    }
    
    let left = r.left + (r.width - width) / 2;
    left = Math.max(20, Math.min(left, vw - width - 20));
    
    setMenuPos({ left, top, width, maxH });
    setOpen(true);
  };

  const menu = (
    <div
      ref={menuRef}
      style={portalRef?.current ? floatingStyle : { left: menuPos.left, top: menuPos.top, width: menuPos.width, maxHeight: menuPos.maxH }}
      className={portalRef?.current ? "flex flex-col bg-white border border-gray-200 shadow-lg overflow-hidden" : "fixed z-[100000] bg-white border border-gray-200 shadow-2xl overflow-hidden"}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
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
            <Lucide.Search className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* List */}
      <div 
        className="overflow-y-auto bg-white flex-1" 
        style={{ 
          maxHeight: portalRef?.current ? '260px' : Math.max(200, menuPos.maxH - 80)
        }}
      >
        {list.length ? (
          <div className="py-2">
            {list.map((icon) => (
              <button
                key={icon.name}
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  onChange(icon.name); 
                  setOpen(false); 
                  setSearch(''); 
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${value === icon.name ? 'bg-gray-100' : ''}` }
              >
                <div className="w-4 h-4 text-gray-600 flex-shrink-0">
                  {IconNode(icon.name)}
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

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-600 flex-shrink-0">
        {search.trim() 
          ? `Showing ${list.length} of ${ALL_ICON_NAMES.length} icons`
          : `${ALL_ICON_NAMES.length} Lucide icons`
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
          openMenu(); 
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={anchorClassName ?? 'flex items-center justify-between w-full px-4 py-3 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none'}
      >
        <span className="flex items-center gap-2">
          {value && IconNode(value)}
          <span className={value ? "capitalize" : "text-gray-500"}>
            {value ? humanize(value) : 'Select'}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && typeof window !== 'undefined' && (
        portalRef?.current ? createPortal(menu, portalRef.current) : createPortal(menu, document.body)
      )}
    </>
  );
}

