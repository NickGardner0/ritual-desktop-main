"use client";

import { cn } from "@/lib/utils";

import { startTransition, useState, useRef, useCallback, useEffect } from "react";
import { MainMenu } from "./main-menu";
import { SidebarAccountMenu } from "./sidebar-account-menu";
import { useSidebarMode } from "@/contexts/SidebarModeContext";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { openDesktopSettingsWindow, type DesktopSettingsView } from '@/lib/tauri-utils';
import { SidebarShell, ToolbarButton } from "@/components/ui/ritual-system";
import { DesktopUpdateControl } from '@/components/desktop-update-control';
import { CreateMenu } from '@/components/create-menu';

const COLLAPSED_WIDTH = 76;
const EXPANDED_WIDTH = 240;

const CodiconArrowLeft = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M13.5 8.00023H3.70701L7.85301 3.85423C8.04801 3.65923 8.04801 3.34223 7.85301 3.14723C7.65801 2.95223 7.34101 2.95223 7.14601 3.14723L2.14601 8.14723C1.95101 8.34223 1.95101 8.65923 2.14601 8.85423L7.14601 13.8542C7.24401 13.9522 7.37201 14.0002 7.50001 14.0002C7.62801 14.0002 7.75601 13.9512 7.85401 13.8542C8.04901 13.6592 8.04901 13.3422 7.85401 13.1472L3.70801 9.00123H13.501C13.777 9.00123 14.001 8.77723 14.001 8.50123C14.001 8.22523 13.777 8.00123 13.501 8.00123L13.5 8.00023Z" />
  </svg>
);

const CodiconArrowRight = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M13.854 8.14576L8.854 3.14576C8.659 2.95076 8.342 2.95076 8.147 3.14576C7.952 3.34076 7.952 3.65776 8.147 3.85276L12.293 7.99876H2.5C2.224 7.99876 2 8.22276 2 8.49876C2 8.77476 2.224 8.99876 2.5 8.99876H12.293L8.147 13.1448C7.952 13.3398 7.952 13.6568 8.147 13.8518C8.245 13.9498 8.373 13.9978 8.501 13.9978C8.629 13.9978 8.757 13.9488 8.855 13.8518L13.855 8.85176C14.05 8.65676 14.05 8.33976 13.855 8.14476L13.854 8.14576Z" />
  </svg>
);

function isDesktopSettingsView(value: string | null): value is DesktopSettingsView {
  return value === 'account'
    || value === 'sounds'
    || value === 'privacy'
    || value === 'computer-tracking'
    || value === 'place-tagging'
    || value === 'apple-health';
}

export function Sidebar() {
  const { mode, setMode } = useSidebarMode();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsHovered(true), 50);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsHovered(false), 100);
  }, []);

  const isExpanded =
    mode === "expanded" ? true : mode === "hover" ? isHovered || isAccountMenuOpen : false;

  const hoverProps =
    mode === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : {};

  const width = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const navTopPadding = isExpanded ? 74 : 112;
  const sidebarToggleLabel = isExpanded ? "Collapse sidebar" : "Expand sidebar";

  const handleChromeToggle = () => {
    setMode(isExpanded ? "compact" : "expanded");
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--ritual-sidebar-current-width', `${width}px`);

    return () => {
      document.documentElement.style.setProperty('--ritual-sidebar-current-width', `${COLLAPSED_WIDTH}px`);
    };
  }, [width]);

  useEffect(() => {
    const view = searchParams.get('openSettings');
    if (!isDesktopSettingsView(view)) return;

    void openDesktopSettingsWindow(view).catch((error) => {
      console.error('Failed to open native settings window:', error);
    });
    startTransition(() => setIsHovered(false));

    const params = new URLSearchParams(searchParams.toString());
    params.delete('openSettings');
    const qs = params.toString();
    router.replace(qs ? `${pathname || ''}?${qs}` : pathname || '/');
  }, [searchParams, pathname, router]);

  const handleSettingsClick = async () => {
    setIsHovered(false);
    try {
      await openDesktopSettingsWindow('account');
    } catch (error) {
      console.error('Failed to open native settings window:', error);
    }
  };

  return (
    <SidebarShell
      style={{
        width,
        transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      {...hoverProps}
    >
      <div
        aria-hidden
        data-tauri-drag-region
        className="tauri-drag-region absolute left-2 right-2 top-0 z-0 h-12"
      />
      <div
        aria-hidden
        data-tauri-drag-region
        className="tauri-drag-region absolute left-2 right-2 top-12 z-0 h-[30px]"
      />
      <div
        className={cn(
          "no-drag absolute z-20 flex items-center",
          isExpanded ? "left-[81px] top-[2px]" : "left-[18px] top-[70px]",
        )}
      >
        <ToolbarButton
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            handleChromeToggle();
          }}
          className="app-toolbar-icon-button"
          aria-label={sidebarToggleLabel}
          title={sidebarToggleLabel}
        >
          <PanelLeft className="h-[18px] w-[18px] stroke-[2.05]" />
        </ToolbarButton>
      </div>
      {isExpanded ? (
        <div className="no-drag absolute right-[42px] top-[2px] z-20 flex items-center gap-0.5">
          <ToolbarButton
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (window.history.length > 1) {
                router.back();
              }
            }}
            className="app-toolbar-icon-button app-toolbar-nav-button"
            aria-label="Go back"
            title="Go back"
          >
            <CodiconArrowLeft className="h-4 w-[18px]" />
          </ToolbarButton>
          <ToolbarButton
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              router.forward();
            }}
            className="app-toolbar-icon-button app-toolbar-nav-button"
            aria-label="Go forward"
            title="Go forward"
          >
            <CodiconArrowRight className="h-4 w-[18px]" />
          </ToolbarButton>
        </div>
      ) : null}
      {isExpanded ? (
        <div className="no-drag absolute right-[6px] top-[2px] z-30 flex items-center">
          <CreateMenu align="start" side="right" triggerClassName="app-toolbar-icon-button ml-0" />
        </div>
      ) : null}

      <div className="no-drag flex min-h-0 w-full flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ paddingTop: navTopPadding }}>
        <MainMenu
          isExpanded={isExpanded}
        />
      </div>

      <div className="no-drag flex w-full flex-col items-stretch px-[15px]">
        <SidebarAccountMenu
          isExpanded={isExpanded}
          onOpenChange={setIsAccountMenuOpen}
          onOpenSettings={handleSettingsClick}
        />
        <DesktopUpdateControl isExpanded={isExpanded} />
      </div>
    </SidebarShell>
  );
}
