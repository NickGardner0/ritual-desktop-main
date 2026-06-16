import { buildCard } from './card';
import { DetailPanel } from './detail-panel';
import { PanelAction } from './panel-action';
import { usePlaidIntegration } from './use-plaid-integration';

export const id = 'plaid';
export const detailKey = 'plaid';
export const title = 'Plaid';
export const keywords = ['bank', 'banking', 'spending', 'finance', 'financial'];

export { buildCard, buildCard as Card, DetailPanel, PanelAction, usePlaidIntegration, usePlaidIntegration as useIntegration };
