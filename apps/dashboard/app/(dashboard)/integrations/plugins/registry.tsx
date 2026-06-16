'use client';

import type { ReactNode } from 'react';
import type { IntegrationRuntimeContext } from './types';
import {
  getIntegrationPluginByDetailKey,
  INTEGRATION_PLUGINS,
  PLUGIN_BY_DETAIL_KEY,
  PLUGIN_BY_ID,
  buildRegisteredIntegrationCards,
} from './registry';

export {
  INTEGRATION_PLUGINS,
  PLUGIN_BY_DETAIL_KEY,
  PLUGIN_BY_ID,
  buildRegisteredIntegrationCards,
  getIntegrationPluginByDetailKey,
};

export function renderRegisteredIntegrationDetailPanel(
  selectedIntegration: string | null,
  ctx: IntegrationRuntimeContext,
): ReactNode | null {
  if (!selectedIntegration) {
    return null;
  }

  const plugin = getIntegrationPluginByDetailKey(selectedIntegration);
  if (!plugin) {
    return null;
  }

  const RegisteredDetailPanel = plugin.DetailPanel;
  return <RegisteredDetailPanel ctx={ctx} />;
}
