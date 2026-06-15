import { buildCard } from './card';
import { DetailPanel } from './detail-panel';
import { PanelAction } from './panel-action';
import { useIphoneTimeIntegration } from './use-iphone-time-integration';

export const id = 'apple-screen-time';
export const detailKey = 'screentime';
export const title = 'Apple Screen Time';
export const keywords = ['screen time', 'digital habits', 'iphone', 'ipad', 'biome', 'app usage'];

export { buildCard, buildCard as Card, DetailPanel, PanelAction, useIphoneTimeIntegration, useIphoneTimeIntegration as useIntegration };
