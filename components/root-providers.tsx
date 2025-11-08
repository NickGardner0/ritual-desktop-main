'use client';

import { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { QueryProvider } from '@/components/providers';
import { HabitsProvider } from '@/contexts/HabitsContext';

/**
 * Root Providers Wrapper
 * 
 * This client component wraps all providers that need to be at the root level.
 * Separated from layout.tsx to allow the layout to remain a Server Component.
 */
export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ClerkProvider
        // Prevent infinite redirect loops by handling errors gracefully
        afterSignOutUrl="/"
        signInUrl="/auth"
        signUpUrl="/auth"
      >
        <QueryProvider>
          <HabitsProvider>
            {children}
          </HabitsProvider>
        </QueryProvider>
      </ClerkProvider>
    </ThemeProvider>
  );
}

