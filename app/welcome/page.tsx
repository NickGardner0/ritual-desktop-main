/**
 * Welcome Page - Server Component
 * 
 * This page uses useSearchParams() in the client component,
 * which requires a Suspense boundary to handle dynamic rendering.
 */

import { Suspense } from 'react';
import { WelcomeClient } from './welcome-client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Welcome | Ritual',
  description: 'Get started with Ritual - your habit tracking companion',
};

// Loading state while welcome client initializes
function WelcomeLoading() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<WelcomeLoading />}>
      <WelcomeClient />
    </Suspense>
  );
}
