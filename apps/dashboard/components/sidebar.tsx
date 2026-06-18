"use client";

import { cn } from "@/lib/utils";

import { startTransition, useState, useRef, useCallback, useEffect } from "react";
import { MainMenu } from "./main-menu";
import { useSidebarMode } from "@/contexts/SidebarModeContext";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Settings } from "lucide-react";
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { openDesktopSettingsWindow, type DesktopSettingsView } from '@/lib/tauri-utils';
import { NavRowSurface, SidebarShell } from "@/components/ui/ritual-system";

const SettingsModal = dynamic(
  () => import("./settings-modal").then(m => ({ default: m.SettingsModal })),
  { ssr: false }
);

const COLLAPSED_WIDTH = 76;
const EXPANDED_WIDTH = 202;

export function Sidebar() {
  const { isDesktop } = useDesktopCapabilities();
  const { mode } = useSidebarMode();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<DesktopSettingsView | undefined>(undefined);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsHovered(true), 50);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setIsHovered(false), 100);
  }, []);

  // Determine visual expansion state based on mode
  const isExpanded =
    mode === "expanded" ? true : mode === "hover" ? isHovered : false;

  // Only attach hover handlers in hover mode
  const hoverProps =
    mode === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : {};

  const width = isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const navTopPadding = mode === "expanded" ? 54 : 58;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--ritual-sidebar-current-width', `${width}px`);

    return () => {
      document.documentElement.style.setProperty('--ritual-sidebar-current-width', `${COLLAPSED_WIDTH}px`);
    };
  }, [width]);

  // Open Settings modal from URL param (e.g. /integrations?openSettings=computer-tracking)
  useEffect(() => {
    const view = searchParams.get('openSettings');
    if (
      view === 'account' ||
      view === 'computer-tracking' ||
      view === 'place-tagging' ||
      view === 'apple-health'
    ) {
      if (isDesktop) {
        void openDesktopSettingsWindow(view).catch((error) => {
          console.error('Failed to open native settings window:', error);
          startTransition(() => {
            setSettingsInitialView(view);
            setShowSettingsModal(true);
          });
        });
        startTransition(() => setIsHovered(false));
      } else {
        startTransition(() => {
          setSettingsInitialView(view);
          setShowSettingsModal(true);
        });
      }
      const params = new URLSearchParams(searchParams.toString());
      params.delete('openSettings');
      const qs = params.toString();
      router.replace(qs ? `${pathname || ''}?${qs}` : pathname || '/');
    }
  }, [searchParams, pathname, router]);

  const handleSettingsClick = async () => {
    if (isDesktop) {
      setIsHovered(false);
      try {
        await openDesktopSettingsWindow('account');
      } catch (error) {
        console.error('Failed to open native settings window:', error);
        setSettingsInitialView('account');
        setShowSettingsModal(true);
      }
      return;
    }
    setShowSettingsModal(true);
  };

  return (
    <SidebarShell
      style={{
        width,
        transition: "width 200ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      {...hoverProps}
    >
      {/* Main Navigation — top padding starts below the global titlebar row. */}
      <div className="flex flex-col w-full flex-1" style={{ paddingTop: navTopPadding }}>
        <MainMenu
          isExpanded={isExpanded}
        />
      </div>

      {/* Bottom: Settings */}
      <div className="flex w-full flex-col items-stretch px-[15px]">
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

      {showSettingsModal && (
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => {
            setShowSettingsModal(false);
            setSettingsInitialView(undefined);
            setIsHovered(false);
          }}
          onOpen={() => setIsHovered(false)}
          initialView={settingsInitialView}
        />
      )}
    </SidebarShell>
  );
}
