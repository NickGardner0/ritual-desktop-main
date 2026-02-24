/**
 * Dashboard/Index Page - Server Component
 * 
 * Unified page with Overview/Metrics toggle (Midday-style).
 * This is the primary destination combining:
 * - Overview: Habit list with totals and stats
 * - Metrics: Spark cards, charts, and computer activity
 * 
 * URL params:
 * - ?view=overview - Shows the habit list (default)
 * - ?view=metrics - Shows the charts and spark cards
 */

import type { Metadata } from 'next';
import { ClientDashboard } from './client-dashboard';

export const metadata: Metadata = {
  title: 'Dashboard | Ritual',
  description: 'Track and manage your daily habits',
};

export default function DashboardPage() {
  return (
    <div className="flex-1 overflow-auto bg-white relative">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 pt-7 pb-72">
        <ClientDashboard />
      </div>
    </div>
  );
}
