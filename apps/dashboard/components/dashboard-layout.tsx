"use client";

import { useState, useEffect, Suspense } from 'react';
import { useAI } from '@/contexts/AIContext';
import { useFont } from '@/contexts/FontContext';
import { DashboardSearchHandler } from '@/components/dashboard-search-handler';
import { TeamDropdown } from '@/components/team-dropdown';
import { isTauri } from '@/lib/tauri-utils';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react';
import { useSidebarMode } from '@/contexts/SidebarModeContext';

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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!detachedSidebarMode || !isTauri()) return;
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
  const [shouldOpenWhoopModal, setShouldOpenWhoopModal] = useState(false);
  const [detachedSidebarMode, setDetachedSidebarMode] = useState(false);
  const [detachedSidebarWidth, setDetachedSidebarWidth] = useState(76);
  const { isFullScreenChat } = useAI();
  const pathname = usePathname();
  const router = useRouter();
  const { mode, setMode } = useSidebarMode();
  const isChatRoute = pathname === '/chat';
  const { fontClass } = useFont();
  const shouldMountSearchHandler = pathname === '/dashboard';

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
    if (!detachedSidebarMode || !isTauri()) return;

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

  const shouldHideAppSidebar = isFullScreenChat || isChatRoute;
  const shouldShowTitlebarSidebarControls = !shouldHideAppSidebar && !detachedSidebarMode;

  const handleChromeToggle = () => {
    setMode(mode === 'expanded' ? 'compact' : 'expanded');
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (detachedSidebarMode || shouldHideAppSidebar) {
      document.documentElement.style.setProperty('--ritual-sidebar-current-width', '0px');
    }
  }, [detachedSidebarMode, shouldHideAppSidebar]);

  return (
    <div className={`app-container flex h-screen overflow-x-hidden max-w-full w-full border-0 ${fontClass}`}>
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
      
      <div className="app-window-shell flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* Native window chrome. Keep this row focused on window/navigation controls. */}
        {!isFullScreenChat && (
          <>
            <header
              data-tauri-drag-region
              className="dashboard-top-chrome titlebar-region tauri-drag-region relative flex h-9 items-center overflow-hidden bg-transparent px-2"
            >
              <div
                data-tauri-drag-region
                aria-hidden="true"
                className="titlebar-glass-layer pointer-events-none absolute inset-0"
              />
              {isChatRoute && (
                <div
                  data-tauri-drag-region
                  className="chat-header-sidebar-strip absolute inset-y-0 left-0 w-[272px] border-r border-[rgba(15,23,42,0.028)] bg-transparent"
                />
              )}
              <div data-tauri-drag-region className="dashboard-top-chrome-row relative flex h-full w-full translate-y-[-1px] items-center gap-2">
                <div
                  data-tauri-drag-region
                  className={`${shouldShowTitlebarSidebarControls ? 'titlebar-sidebar-lane' : 'w-0'} relative flex h-full shrink-0 items-center`}
                >
                  {shouldShowTitlebarSidebarControls ? (
                    <div className="no-drag flex h-full items-center pl-[82px]">
                      <button
                        type="button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleChromeToggle();
                        }}
                        className="titlebar-icon-button mr-[22px] flex h-7 w-8 items-center justify-center rounded-sm text-[rgba(17,24,39,0.46)] transition-colors hover:bg-[rgba(255,255,255,0.48)] hover:text-[rgba(17,24,39,0.78)]"
                        aria-label={mode === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'}
                        title={mode === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'}
                      >
                        <PanelLeft className="h-[16px] w-[16px] stroke-[2.05]" />
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (window.history.length > 1) {
                              router.back();
                            }
                          }}
                          className="titlebar-icon-button flex h-7 w-8 items-center justify-center rounded-sm text-[rgba(17,24,39,0.42)] transition-colors hover:bg-[rgba(255,255,255,0.48)] hover:text-[rgba(17,24,39,0.76)]"
                          aria-label="Go back"
                          title="Go back"
                        >
                          <ChevronLeft className="h-4 w-4 stroke-[2.05]" />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            router.forward();
                          }}
                          className="titlebar-icon-button flex h-7 w-8 items-center justify-center rounded-sm text-[rgba(17,24,39,0.42)] transition-colors hover:bg-[rgba(255,255,255,0.48)] hover:text-[rgba(17,24,39,0.76)]"
                          aria-label="Go forward"
                          title="Go forward"
                        >
                          <ChevronRight className="h-4 w-4 stroke-[2.05]" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div
                  data-tauri-drag-region
                  className="flex h-full min-w-0 flex-1 items-center justify-end"
                >
                  <div className="no-drag flex items-center gap-1">
                    <TeamDropdown isExpanded={false} placement="header" />
                  </div>
                </div>
              </div>
            </header>

          </>
        )}

        <div className="app-body flex min-h-0 flex-1 overflow-hidden">
          {/* Clean Midday-style Sidebar - Hidden in Full-Screen Chat */}
          {!shouldHideAppSidebar && !detachedSidebarMode && <Sidebar />}

          {/* Main Content Area */}
          <div className="content-shell flex min-w-0 flex-1 flex-col overflow-hidden border-0">
            {!isFullScreenChat && (
              <div className="dashboard-app-toolbar app-toolbar-region relative flex h-14 shrink-0 items-start bg-[var(--content-bg)] px-6 pt-3">
                <div className="dashboard-app-toolbar-row grid h-8 w-full min-w-0 grid-cols-[minmax(160px,1fr)_auto_minmax(160px,1fr)] items-center gap-2">
                  <div className="flex min-w-0 items-center gap-1">
                    {!isChatRoute && (
                      <CommandPalette
                        className="titlebar-control titlebar-search-control flex h-8 w-auto min-w-[112px] items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-medium leading-none text-[rgba(17,24,39,0.68)] focus-visible:outline-none focus-visible:ring-0"
                        initialOpen={shouldOpenWhoopModal}
                        density="tight"
                      />
                    )}
                    <div id="header-left-slot" className="flex items-center gap-1" />
                  </div>

                  <div
                    id="header-center-slot"
                    className="flex min-w-0 items-center justify-center"
                  />

                  <div className="flex min-w-0 items-center justify-end gap-1">
                    <div
                      id="header-right-slot"
                      className="flex min-w-0 items-center gap-1"
                    />
                  </div>
                </div>
              </div>
            )}
            {/* Main Content */}
            <main className={`content-opaque flex flex-col flex-1 overflow-auto border-0 bg-[var(--content-bg)]`}>
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
