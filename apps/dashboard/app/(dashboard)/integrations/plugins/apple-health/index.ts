import { buildCard } from './card';
import { DetailPanel } from './detail-panel';
import { useAppleHealthExport } from './use-apple-health-export';

export const id = 'apple-watch';
export const detailKey = 'applewatch';
export const title = 'Apple Watch';
export const keywords = ['apple health', 'watch', 'steps', 'heart rate', 'sleep', 'workout'];

export { buildCard, buildCard as Card, DetailPanel, useAppleHealthExport, useAppleHealthExport as useIntegration };
