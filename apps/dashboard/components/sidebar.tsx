"use client";

import { cn } from "@/lib/utils";

import { startTransition, useState, useRef, useCallback, useEffect } from "react";
import { MainMenu } from "./main-menu";
import { useSidebarMode } from "@/contexts/SidebarModeContext";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import { openDesktopSettingsWindow, type DesktopSettingsView } from '@/lib/tauri-utils';
import { NavRowSurface, SidebarShell } from "@/components/ui/ritual-system";

const COLLAPSED_WIDTH = 76;
const EXPANDED_WIDTH = 202;

function isDesktopSettingsView(value: string | null): value is DesktopSettingsView {
  return value === 'account'
    || value === 'privacy'
    || value === 'computer-tracking'
    || value === 'place-tagging'
    || value === 'apple-health';
}

export function Sidebar() {
  const { mode } = useSidebarMode();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
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
    mode === "expanded" ? true : mode === "hover" ? isHovered : false;

  const hoverProps =
    mode === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : {};

  const width = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const navTopPadding = mode === "expanded" ? 74 : 78;

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
      data-tauri-drag-region
      className="tauri-drag-region"
      style={{
        width,
        transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      {...hoverProps}
    >
      <div className="no-drag flex flex-col w-full flex-1" style={{ paddingTop: navTopPadding }}>
        <MainMenu
          isExpanded={isExpanded}
        />
      </div>

      <div className="no-drag flex w-full flex-col items-stretch px-[15px]">
        <button
          type="button"
          onClick={handleSettingsClick}
          className={cn("group/settings-row relative h-[var(--sidebar-row-height)]", isExpanded ? "w-full" : "w-[40px]")}
          aria-label="Settings"
          title="Settings"
        >
          <NavRowSurface active={false} expanded={isExpanded} className={isExpanded ? "!ml-0 !mr-0 !w-full" : "!ml-0"} />
          <span
            className={cn(
              "ritual-nav-icon absolute top-1/2 left-0 flex h-[var(--sidebar-icon-box)] w-[var(--sidebar-icon-box)] -translate-y-1/2 items-center justify-center",
            )}
            data-collapsed={!isExpanded ? "true" : undefined}
          >
            <Settings className="relative -translate-y-px h-[18px] w-[18px]" strokeWidth={2.1} />
          </span>
          {isExpanded && (
            <span className="ritual-nav-label absolute top-1/2 left-[40px] right-[4px] flex h-[var(--sidebar-row-height)] -translate-y-1/2 items-center text-sm leading-none">
              Settings
            </span>
          )}
        </button>
      </div>
    </SidebarShell>
  );
}
