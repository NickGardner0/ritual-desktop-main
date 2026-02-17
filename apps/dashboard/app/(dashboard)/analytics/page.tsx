/**
 * Analytics Page - Redirect to Dashboard with Metrics view
 * 
 * Analytics is now integrated into the Index/Dashboard page.
 * This page redirects to /dashboard?view=metrics for backwards compatibility.
 */

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Analytics | Ritual',
  description: 'View insights and trends for your habits',
};

export default function AnalyticsPage() {
  // Redirect to dashboard with metrics view
  redirect('/dashboard?view=metrics');
}
