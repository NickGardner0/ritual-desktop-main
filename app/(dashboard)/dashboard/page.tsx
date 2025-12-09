/**
 * Dashboard Page - Server Component
 * 
 * This is the page shell that:
 * - Defines metadata for SEO
 * - Wraps the client component in Suspense for streaming
 * - Provides the loading skeleton during initial load
 * 
 * The actual interactive dashboard is in dashboard-client.tsx
 */

import { Suspense } from 'react';
import { DashboardClient } from './dashboard-client';
import DashboardLoading from './loading';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard | Ritual',
  description: 'Track and manage your daily habits',
};

export default function DashboardPage() {
    return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardClient />
      </Suspense>
    );
  }
