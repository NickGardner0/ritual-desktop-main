'use client';

import { useEffect } from 'react';
import { PanelRightClose } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRightDockUi } from '@/contexts/RightDockContext';
import { cn } from '@/lib/utils';

export function RightDockHideButton({ className }: { className?: string }) {
  const { isOpen, close } = useRightDockUi();

  useEffect(() => {
    if (!isOpen || !close) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Cursor: ⌥⌘B — hide/show secondary side panel
      if (event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  if (!isOpen || !close) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={close}
            aria-label="Hide panel"
            className={cn(
              'no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6b6a66] transition-colors hover:bg-black/[0.04] hover:text-[#2f302d] focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300',
              className,
            )}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className="flex items-center gap-3 rounded-md border border-black/[0.08] bg-white px-2.5 py-1.5 text-[12.5px] font-normal text-[#27251E] shadow-[0_8px_24px_rgba(28,25,18,0.12)]"
        >
          <span>Hide Panel</span>
          <span className="text-[11px] tracking-wide text-[rgba(39,37,30,0.45)]">⌥⌘B</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
