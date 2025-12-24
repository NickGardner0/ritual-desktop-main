'use client';

import { ReactNode, useEffect } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { QueryProvider } from '@/components/providers';
import { HabitsProvider } from '@/contexts/HabitsContext';
import { OpenPanelProvider } from '@/components/openpanel-provider';
import { showMainWindow } from '@/lib/tauri-utils';

/**
 * Root Providers Wrapper
 * 
 * This client component wraps all providers that need to be at the root level.
 * Separated from layout.tsx to allow the layout to remain a Server Component.
 */
export function RootProviders({ children }: { children: ReactNode }) {
  // Show the Tauri window once React has mounted and content is ready
  // This prevents the "tiny window flash" issue on macOS
  useEffect(() => {
    // Small delay to ensure DOM is painted
    const timer = setTimeout(() => {
      showMainWindow();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      forcedTheme="light"
      disableTransitionOnChange
    >
      <ClerkProvider
        signInUrl="/auth"
        signUpUrl="/auth"
        afterSignOutUrl="/welcome"
      >
        <OpenPanelProvider>
        <QueryProvider>
          <HabitsProvider>
            {children}
          </HabitsProvider>
        </QueryProvider>
        </OpenPanelProvider>
      </ClerkProvider>
    </ThemeProvider>
  );
}

