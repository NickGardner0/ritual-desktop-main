'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from '@/components/theme-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { QueryProvider } from '@/components/providers';
import { HabitsProvider } from '@/contexts/HabitsContext';
import { OpenPanelProvider } from '@/components/openpanel-provider';
import { PlatformDetector } from '@/components/platform-detector';
import { TransparencyProbe } from '@/components/transparency-probe';
import { DesktopAuthDeepLinkBridge } from '@/components/desktop-auth-deep-link-bridge';
import { DesktopAssetRecoveryBridge } from '@/components/desktop-asset-recovery-bridge';
import { ChromeAppearanceProvider } from '@/contexts/ChromeAppearanceContext';
import { DesktopCapabilitiesProvider, getDesktopCapabilities, useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { desktopFrontendReady } from '@/lib/desktop-runtime';
import { showMainWindow } from '@/lib/tauri-utils';

/**
 * Root Providers Wrapper
 * 
 * This client component wraps all providers that need to be at the root level.
 * Separated from layout.tsx to allow the layout to remain a Server Component.
 */
export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <DesktopCapabilitiesProvider>
      <RootProvidersInner>{children}</RootProvidersInner>
    </DesktopCapabilitiesProvider>
  );
}

function RootProvidersInner({ children }: { children: ReactNode }) {
  const { isDesktop } = useDesktopCapabilities();
  const pathname = usePathname();
  const isDesktopBootstrap = pathname === '/desktop/bootstrap';
  const isDesktopShell = typeof window !== 'undefined' && isDesktop;
  const isAuxiliaryDesktopWindow = () => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('ritual_sidebar_window') === '1' || params.get('ritual_settings_window') === '1';
  };
  const [isTransparencyProbe] = useState(() => {
    if (typeof window === 'undefined') return false;
    const queryValue = new URLSearchParams(window.location.search).get('ritual_transparency_probe');
    const storageValue = window.sessionStorage.getItem('ritual_transparency_probe');
    return queryValue === '1' || storageValue === '1';
  });
  const [isMainGlassEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (isAuxiliaryDesktopWindow()) return false;
    const queryValue = new URLSearchParams(window.location.search).get('ritual_main_glass');
    const storageValue = window.sessionStorage.getItem('ritual_main_glass');
    return getDesktopCapabilities().isDesktop || queryValue === '1' || storageValue === '1';
  });
  const [isGlassChromeEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (isAuxiliaryDesktopWindow()) return false;
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get('ritual_glass_chrome');
    const storageValue = window.sessionStorage.getItem('ritual_glass_chrome');
    if (queryValue === '0') return false;
    if (getDesktopCapabilities().isDesktop) return true;
    if (queryValue === '1' || storageValue === '1') return true;
    return params.get('ritual_main_glass') === '1' || window.sessionStorage.getItem('ritual_main_glass') === '1';
  });
  const [isSidebarCaptureMode, setIsSidebarCaptureMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const queryValue = new URLSearchParams(window.location.search).get('ritual_capture_sidebar');
    if (queryValue === '1') return true;
    return false;
  });

  // Show the Tauri window once React has mounted and content is ready
  // This prevents the "tiny window flash" issue on macOS
  useEffect(() => {
    if (!isDesktopShell) {
      return;
    }

    if (isAuxiliaryDesktopWindow()) {
      return;
    }

    if (isDesktopBootstrap) {
      return;
    }

    // Small delay to ensure DOM is painted
    const timer = setTimeout(() => {
      showMainWindow();
    }, 50);
    return () => clearTimeout(timer);
  }, [isDesktopShell, isDesktopBootstrap, pathname]);

  useEffect(() => {
    if (!isDesktopShell || isDesktopBootstrap) {
      return;
    }

    if (isAuxiliaryDesktopWindow()) {
      return;
    }

    void desktopFrontendReady();
  }, [isDesktopBootstrap, isDesktopShell]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isGlassChromeEnabled) {
      window.sessionStorage.setItem('ritual_glass_chrome', '1');
      document.documentElement.dataset.glassChrome = '1';
    } else {
      window.sessionStorage.removeItem('ritual_glass_chrome');
      delete document.documentElement.dataset.glassChrome;
    }
  }, [isGlassChromeEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const setWindowActive = () => {
      document.documentElement.dataset.windowActive = document.hasFocus() ? '1' : '0';
    };

    setWindowActive();
    window.addEventListener('focus', setWindowActive);
    window.addEventListener('blur', setWindowActive);
    return () => {
      window.removeEventListener('focus', setWindowActive);
      window.removeEventListener('blur', setWindowActive);
      delete document.documentElement.dataset.windowActive;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isSidebarCaptureMode) {
      document.documentElement.dataset.sidebarCapture = '1';
    } else {
      window.localStorage.removeItem('ritual_capture_sidebar');
      delete document.documentElement.dataset.sidebarCapture;
    }
  }, [isSidebarCaptureMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.altKey && event.shiftKey && event.code === 'KeyB') {
        event.preventDefault();
        setIsSidebarCaptureMode((enabled) => !enabled);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const content = (
    <ChromeAppearanceProvider>
      <OpenPanelProvider>
        <QueryProvider>
          <HabitsProvider>
            <DesktopAssetRecoveryBridge />
            <DesktopAuthDeepLinkBridge />
            {children}
          </HabitsProvider>
        </QueryProvider>
      </OpenPanelProvider>
    </ChromeAppearanceProvider>
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
          localization={{
            formFieldHintText__optional: '',
          }}
          appearance={{
            userProfile: {
              elements: {
                modalBackdrop: '!fixed !inset-0 bg-black/20 backdrop-blur-[2px]',
                modalContent: '!fixed !left-1/2 !top-1/2 !z-[130] !w-[min(720px,calc(100vw-2rem))] !max-w-[720px] !-translate-x-1/2 !-translate-y-1/2 !rounded-sm !border !border-gray-200 !bg-white !shadow-xl !overflow-hidden',
                rootBox: '!w-full !max-w-[720px] mx-auto',
                card: '!shadow-none !rounded-none !border-0',
                navbar: 'hidden',
                navbarMobileMenuRow: 'hidden',
                pageScrollBox: '!max-h-[min(560px,calc(100vh-5rem))]',
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
