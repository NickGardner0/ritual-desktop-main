'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from '@/components/theme-provider';
import { ClerkProvider, useUser } from '@clerk/nextjs';
import { QueryProvider } from '@/components/providers';
import { HabitsProvider } from '@/contexts/HabitsContext';
import { OpenPanelProvider } from '@/components/openpanel-provider';
import { PlatformDetector } from '@/components/platform-detector';
import { TransparencyProbe } from '@/components/transparency-probe';
import { MemoryCloudUploader } from '@/components/memory-cloud-uploader';
import { DesktopUpdater } from '@/components/desktop-updater';
import { isTauri, showMainWindow } from '@/lib/tauri-utils';

function WatcherConfigReconciler() {
  const { isLoaded, user } = useUser();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauri() || !isLoaded || !user?.id) return;
    if (lastUserIdRef.current === user.id) return;
    lastUserIdRef.current = user.id;

    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const updated = await invoke<boolean>('reconcile_watcher_config_user_cmd', {
          userId: user.id,
        });
        if (updated) {
          console.log(`✅ Reconciled watcher config to current user ${user.id}`);
        }
      } catch (error) {
        console.error('Failed to reconcile watcher config user:', error);
      }
    })();
  }, [isLoaded, user?.id]);

  return null;
}

/**
 * Root Providers Wrapper
 * 
 * This client component wraps all providers that need to be at the root level.
 * Separated from layout.tsx to allow the layout to remain a Server Component.
 */
export function RootProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isDesktopBootstrap = pathname === '/desktop/bootstrap';
  const [isTransparencyProbe] = useState(() => {
    if (typeof window === 'undefined') return false;
    const queryValue = new URLSearchParams(window.location.search).get('ritual_transparency_probe');
    const storageValue = window.sessionStorage.getItem('ritual_transparency_probe');
    return queryValue === '1' || storageValue === '1';
  });
  const [isMainGlassEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    const queryValue = new URLSearchParams(window.location.search).get('ritual_main_glass');
    const storageValue = window.sessionStorage.getItem('ritual_main_glass');
    return isTauri() || queryValue === '1' || storageValue === '1';
  });

  // Show the Tauri window once React has mounted and content is ready
  // This prevents the "tiny window flash" issue on macOS
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('ritual_sidebar_window') === '1') {
        return;
      }
    }

    if (isDesktopBootstrap) {
      return;
    }

    // Small delay to ensure DOM is painted
    const timer = setTimeout(() => {
      showMainWindow();
    }, 50);
    return () => clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isTransparencyProbe) {
      window.sessionStorage.setItem('ritual_transparency_probe', '1');
      document.documentElement.dataset.transparencyProbe = '1';
      if (process.env.NODE_ENV !== 'production') {
        console.log('🧪 Transparency probe UI enabled');
      }
    } else {
      window.sessionStorage.removeItem('ritual_transparency_probe');
      delete document.documentElement.dataset.transparencyProbe;
    }
  }, [isTransparencyProbe]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isMainGlassEnabled) {
      window.sessionStorage.setItem('ritual_main_glass', '1');
      document.documentElement.dataset.mainGlass = '1';
    } else {
      window.sessionStorage.removeItem('ritual_main_glass');
      delete document.documentElement.dataset.mainGlass;
    }
  }, [isMainGlassEnabled]);

  const content = (
    <OpenPanelProvider>
      <QueryProvider>
        <HabitsProvider>
          <DesktopUpdater />
          <MemoryCloudUploader />
          <WatcherConfigReconciler />
          {children}
        </HabitsProvider>
      </QueryProvider>
    </OpenPanelProvider>
  );

  return (
    <ThemeProvider
      attribute="class"
      forcedTheme="light"
      disableTransitionOnChange
    >
      {/* Detect OS and set data-platform attr for macOS vibrancy CSS */}
      <PlatformDetector />
      {isTransparencyProbe ? (
        <TransparencyProbe />
      ) : isDesktopBootstrap ? (
        children
      ) : (
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInForceRedirectUrl="/auth/sso-callback"
          signUpForceRedirectUrl="/auth/sso-callback"
          afterSignOutUrl="/"
          appearance={{
            userProfile: {
              elements: {
                modalBackdrop: 'bg-transparent',
                modalContent: 'shadow-lg border border-gray-200 rounded-sm',
                rootBox: 'max-w-[420px]',
                card: 'shadow-none rounded-sm',
                navbar: 'hidden',
                pageScrollBox: 'max-h-[400px]',
              },
            },
          }}
        >
          {content}
        </ClerkProvider>
      )}
    </ThemeProvider>
  );
}
