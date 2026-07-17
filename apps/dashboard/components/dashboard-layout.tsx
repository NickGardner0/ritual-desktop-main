"use client";

import { useState, useEffect, Suspense, useCallback } from 'react';
import { useAI } from '@/contexts/AIContext';
import { useFont } from '@/contexts/FontContext';
import { RightDockTargetProvider } from '@/contexts/RightDockContext';
import { DashboardSearchHandler } from '@/components/dashboard-search-handler';
import { PinnedSummaryPopover } from '@/components/pinned-summary-popover';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSidebarMode } from '@/contexts/SidebarModeContext';
import { ContentSurface } from '@/components/ui/ritual-system';

const Sidebar = dynamic(
  () => import('@/components/sidebar').then(m => ({ default: m.Sidebar })),
  { ssr: false }
);

const CommandPalette = dynamic(
  () => import('@/components/habit-selector'),
  { ssr: false }
);

/** Syncs route to detached sidebar - uses useSearchParams so must be in Suspense */
function SidebarRouteSync({ detachedSidebarMode }: { detachedSidebarMode: boolean }) {
  const { isDesktop } = useDesktopCapabilities();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!detachedSidebarMode || !isDesktop) return;
    (async () => {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const route = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`;
      const sidebarWindow = await WebviewWindow.getByLabel('sidebar');
      await sidebarWindow?.emit('sidebar:route', route);
    })();
  }, [detachedSidebarMode, pathname, searchParams]);

  return null;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { isDesktop } = useDesktopCapabilities();
  const [shouldOpenWhoopModal, setShouldOpenWhoopModal] = useState(false);
  const [detachedSidebarMode, setDetachedSidebarMode] = useState(false);
  const [detachedSidebarWidth, setDetachedSidebarWidth] = useState(76);
  const { isFullScreenChat } = useAI();
  const pathname = usePathname();
  const { mode } = useSidebarMode();
  const isChatRoute = pathname === '/chat';
  const { fontClass } = useFont();
  const shouldMountSearchHandler = pathname === '/dashboard';
  const [rightDockEl, setRightDockEl] = useState<HTMLElement | null>(null);
  const rightDockRef = useCallback((node: HTMLDivElement | null) => {
    setRightDockEl(node);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('ritual_detached_sidebar') === '1';
    const enabled = fromQuery;

    if (enabled) {
      window.sessionStorage.setItem('ritual_detached_sidebar', '1');
      setDetachedSidebarMode(true);
    } else {
      window.sessionStorage.removeItem('ritual_detached_sidebar');
      setDetachedSidebarMode(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'development') return;

    // Hide Next.js dev indicator launcher (floating "N") in local dev.
    void fetch('/__nextjs_disable_dev_indicator', { method: 'POST' }).catch(() => {
      // Ignore when endpoint is unavailable (older/newer Next internals).
    });
  }, []);

  useEffect(() => {
    if (!detachedSidebarMode || !isDesktop) return;

    let unlisten: (() => void) | null = null;
    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

      try {
        const state = await invoke<{ width?: number }>('sidebar_get_main_state');
        if (typeof state?.width === 'number') {
          setDetachedSidebarWidth(Math.max(76, Math.min(240, state.width)));
        }
      } catch (error) {
        console.error('Failed to get detached sidebar state:', error);
      }

      unlisten = await listen<number>('sidebar:width', (event) => {
        if (typeof event.payload === 'number') {
          setDetachedSidebarWidth(Math.max(76, Math.min(240, event.payload)));
        }
      });

      const route = `${window.location.pathname}${window.location.search}`;
      const sidebarWindow = await WebviewWindow.getByLabel('sidebar');
      await sidebarWindow?.emit('sidebar:route', route);
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [detachedSidebarMode]);

  const shouldHideAppSidebarForRoute = isFullScreenChat || isChatRoute;
  const shouldHideAppSidebarForMode = mode === 'hidden';
  const shouldHideAppSidebar = shouldHideAppSidebarForRoute || shouldHideAppSidebarForMode;
  const contentTouchesWindowChrome = detachedSidebarMode || shouldHideAppSidebar;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (detachedSidebarMode || shouldHideAppSidebar) {
      document.documentElement.style.setProperty('--ritual-sidebar-current-width', '0px');
    }
  }, [detachedSidebarMode, shouldHideAppSidebar]);

  return (
    <div className={`app-container integrated-window-chrome flex h-screen overflow-x-hidden max-w-full w-full border-0 ${fontClass}`}>
      {/* Sync route to detached sidebar (useSearchParams requires Suspense) */}
      <Suspense fallback={null}>
        <SidebarRouteSync detachedSidebarMode={detachedSidebarMode} />
      </Suspense>
      {/* Handle URL search parameters (wrapped in Suspense for prerendering) */}
      {shouldMountSearchHandler ? (
        <Suspense fallback={null}>
          <DashboardSearchHandler 
            onOpenWhoopModal={() => setShouldOpenWhoopModal(true)} 
          />
        </Suspense>
      ) : null}
      
      <div className={`app-window-shell relative flex h-full min-w-0 flex-1 flex-col overflow-hidden ${!shouldHideAppSidebar && !detachedSidebarMode ? 'has-shell-sidebar-divider' : ''}`}>
        <div className="app-body flex min-h-0 flex-1 overflow-hidden">
          {/* Clean Midday-style Sidebar - Hidden in Full-Screen Chat */}
          {!shouldHideAppSidebar && !detachedSidebarMode && <Sidebar />}

          {/* Main content column + full-height right dock (Cursor-style) */}
          <RightDockTargetProvider target={rightDockEl}>
            <div className="content-shell flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden border-0">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {!isFullScreenChat && (
                  <div
                    data-tauri-drag-region
                    className={`dashboard-app-toolbar app-toolbar-region tauri-drag-region relative flex h-12 shrink-0 items-center bg-[var(--content-bg)] ${contentTouchesWindowChrome ? 'pl-[84px] pr-3' : 'px-4'}`}
                  >
                    <div
                      data-tauri-drag-region
                      className="dashboard-app-toolbar-row grid h-7 w-full min-w-0 grid-cols-[minmax(140px,1fr)_auto_minmax(140px,1fr)] items-center gap-2"
                    >
                      <div data-tauri-drag-region className="flex min-w-0 items-center">
                        {!isChatRoute && (
                          <CommandPalette
                            className="app-toolbar-control no-drag flex h-7 w-auto min-w-[108px] items-center gap-1.5 rounded-[7px] border border-black/[0.08] bg-transparent px-2.5 py-0 text-[13px] font-normal leading-none text-[#6b6a66] shadow-none hover:bg-black/[0.04] hover:text-[#2f302d] focus:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-0"
                            initialOpen={shouldOpenWhoopModal}
                            density="tight"
                          />
                        )}
                        <div id="header-left-slot" className="no-drag ml-1 flex items-center gap-0.5" />
                      </div>

                      <div
                        id="header-center-slot"
                        className="no-drag flex min-w-0 items-center justify-center"
                      />

                      <div data-tauri-drag-region className="flex min-w-0 items-center justify-end">
                        <div className="no-drag flex h-7 items-center gap-0.5">
                          <PinnedSummaryPopover />
                          <div
                            id="header-right-slot"
                            className="no-drag flex h-7 min-w-0 items-center gap-0.5"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {/* Main Content */}
                <ContentSurface className="content-opaque flex flex-col flex-1 overflow-auto border-0">
                  {children}
                </ContentSurface>
              </div>

              <div
                ref={rightDockRef}
                id="ritual-right-dock"
                className="flex h-full shrink-0 items-stretch"
              />
            </div>
          </RightDockTargetProvider>
        </div>
      </div>
    </div>
  );
}
