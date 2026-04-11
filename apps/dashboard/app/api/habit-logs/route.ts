import { createProxyHandler } from '@/lib/server/proxy-helper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = createProxyHandler('/api/habit-logs', { tag: 'habit-logs' });
