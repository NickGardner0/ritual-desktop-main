import { createProxyHandler } from '@/lib/server/proxy-helper';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = createProxyHandler('/api/dashboard/overview-snapshot', {
  tag: 'dashboard-overview-snapshot',
});
