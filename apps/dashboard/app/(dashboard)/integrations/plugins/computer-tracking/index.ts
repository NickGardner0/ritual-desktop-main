import { buildCard } from './card';
import { DetailPanel } from './detail-panel';
import { PanelAction } from './panel-action';
import { useComputerTrackingConnect } from './use-computer-tracking-connect';

export const id = 'computer';
export const detailKey = 'computer';
export const title = 'Computer Use';
export const keywords = ['computer tracking', 'desktop', 'watcher', 'apps', 'websites'];

export {
  buildCard,
  buildCard as Card,
  DetailPanel,
  PanelAction,
  useComputerTrackingConnect,
  useComputerTrackingConnect as useIntegration,
};
