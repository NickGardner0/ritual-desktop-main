import type { IntegrationCardItem } from './types';
import type { IntegrationCardRuntimeContext, IntegrationPlugin } from './types';
import * as appleHealth from './apple-health';
import * as computerTracking from './computer-tracking';
import * as iphoneTime from './iphone-time';
import * as plaid from './plaid';
import * as tesla from './tesla';
import * as whoop from './whoop';

export const INTEGRATION_PLUGINS: IntegrationPlugin[] = [
  computerTracking as IntegrationPlugin,
  iphoneTime as IntegrationPlugin,
  appleHealth as IntegrationPlugin,
  whoop as unknown as IntegrationPlugin,
  plaid as IntegrationPlugin,
  tesla as IntegrationPlugin,
];

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

export const EXPECTED_PLUGIN_IDS = [
  'computer',
  'apple-screen-time',
  'apple-watch',
  'whoop',
  'plaid',
  'tesla',
] as const;

export const EXPECTED_PLUGIN_DETAIL_KEYS = [
  'computer',
  'screentime',
  'applewatch',
  'whoop',
  'plaid',
  'tesla',
] as const;
