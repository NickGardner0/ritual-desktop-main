'use client';

import { ReactNode, useEffect, useState } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { QueryProvider } from '@/components/providers';
import { HabitsProvider } from '@/contexts/HabitsContext';
import { OpenPanelProvider } from '@/components/openpanel-provider';
import { PlatformDetector } from '@/components/platform-detector';
import { TransparencyProbe } from '@/components/transparency-probe';
import { MemoryCloudUploader } from '@/components/memory-cloud-uploader';
import { showMainWindow } from '@/lib/tauri-utils';
import {
  ensureAutoSemanticBackfillOnLaunch,
  ensureEmbeddingPipelineReadyOnLaunch,
} from '@/lib/screen-search';

/**
 * Root Providers Wrapper
 * 
 * This client component wraps all providers that need to be at the root level.
 * Separated from layout.tsx to allow the layout to remain a Server Component.
 */
export function RootProviders({ children }: { children: ReactNode }) {
  const [isTransparencyProbe] = useState(() => {
    if (typeof window === 'undefined') return false;
    const queryValue = new URLSearchParams(window.location.search).get('ritual_transparency_probe');
    const storageValue = window.sessionStorage.getItem('ritual_transparency_probe');
    return queryValue === '1' || storageValue === '1';
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

    // Small delay to ensure DOM is painted
    const timer = setTimeout(() => {
      showMainWindow();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isTransparencyProbe) {
      window.sessionStorage.setItem('ritual_transparency_probe', '1');
      document.documentElement.dataset.transparencyProbe = '1';
      console.log('🧪 Transparency probe UI enabled');
    } else {
      window.sessionStorage.removeItem('ritual_transparency_probe');
      delete document.documentElement.dataset.transparencyProbe;
    }
  }, [isTransparencyProbe]);

  useEffect(() => {
    ensureEmbeddingPipelineReadyOnLaunch().catch((error) => {
      console.warn('Embedding pipeline bootstrap failed:', error);
    });

    ensureAutoSemanticBackfillOnLaunch().catch((error) => {
      console.warn('Automatic semantic backfill bootstrap failed:', error);
    });
  }, []);

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
      ) : (
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInForceRedirectUrl="/auth/sso-callback"
          signUpForceRedirectUrl="/auth/sso-callback"
          afterSignOutUrl="/"
        >
          <OpenPanelProvider>
          <QueryProvider>
            <HabitsProvider>
              <MemoryCloudUploader />
              {children}
            </HabitsProvider>
          </QueryProvider>
          </OpenPanelProvider>
        </ClerkProvider>
      )}
    </ThemeProvider>
  );
}
