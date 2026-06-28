import { buildCard } from './card';
import { DetailPanel } from './detail-panel';
import { PanelAction } from './panel-action';
import { useWhoopIntegration } from './use-whoop-integration';

export const id = 'whoop';
export const detailKey = 'whoop';
export const title = 'Whoop';
export const keywords = ['sleep', 'recovery', 'strain', 'wearable'];

export { buildCard, buildCard as Card, DetailPanel, PanelAction, useWhoopIntegration, useWhoopIntegration as useIntegration };
