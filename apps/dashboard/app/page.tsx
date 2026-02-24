/**
 * Home Page - Server Component
 * 
 * This page uses useSearchParams() in the client component,
 * which requires a Suspense boundary to handle dynamic rendering.
 * 
 * The home page now includes the full welcome flow for new users,
 * and a simple sign-in page for returning users.
 */

import { Suspense } from 'react';
import { HomeClient } from './home-client';
import type { Metadata } from 'next';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

export const metadata: Metadata = {
  title: 'Ritual',
  description: 'Your habit tracking companion',
};

// Loading state while home client initializes
function HomeLoading() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center space-y-4">
        <BrailleSpinner className="mx-auto text-2xl text-gray-900" />
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeClient />
    </Suspense>
  );
}
