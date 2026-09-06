import type { IntegrationCardItem } from './types';
import type { IntegrationCardRuntimeContext, IntegrationPlugin } from './types';
import * as appleHealth from './apple-health';
import * as computerTracking from './computer-tracking';
import * as iphoneTime from './iphone-time';
import * as plaid from './plaid';
import * as tesla from './tesla';
import * as whoop from './whoop';
import { PRESENTATION_DESCRIPTORS } from './presentation-descriptors';

export const INTEGRATION_PLUGINS = [
  computerTracking,
  iphoneTime,
  appleHealth,
  whoop,
  PRESENTATION_DESCRIPTORS[0],
  PRESENTATION_DESCRIPTORS[1],
  plaid,
  tesla,
  ...PRESENTATION_DESCRIPTORS.slice(2),
] satisfies readonly IntegrationPlugin[];

export const PLUGIN_BY_ID = Object.fromEntries(
  INTEGRATION_PLUGINS.map((plugin) => [plugin.id, plugin]),
) as Record<string, IntegrationPlugin>;

export const PLUGIN_BY_DETAIL_KEY = Object.fromEntries(
  INTEGRATION_PLUGINS.map((plugin) => [plugin.detailKey, plugin]),
) as Record<string, IntegrationPlugin>;

export function getIntegrationPluginByDetailKey(key: string): IntegrationPlugin | undefined {
  return PLUGIN_BY_DETAIL_KEY[key];
}

export function buildRegisteredIntegrationCards(ctx: IntegrationCardRuntimeContext): IntegrationCardItem[] {
  return INTEGRATION_PLUGINS.map((plugin) => plugin.buildCard(ctx)).filter(
    (card): card is IntegrationCardItem => card !== null,
  );
}

export const EXPECTED_PLUGIN_IDS = INTEGRATION_PLUGINS.map((plugin) => plugin.id);

export const EXPECTED_PLUGIN_DETAIL_KEYS = INTEGRATION_PLUGINS.map((plugin) => plugin.detailKey);
