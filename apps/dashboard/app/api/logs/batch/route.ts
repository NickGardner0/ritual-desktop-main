import { createProxyHandler } from '@/lib/server/proxy-helper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = createProxyHandler('/api/logs/batch', { tag: 'logs-batch' });
